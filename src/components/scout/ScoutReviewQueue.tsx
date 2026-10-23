import React, { useState, useEffect } from 'react';
import { ErrorBanner } from '../ErrorBanner';
import { reportSupabaseError } from '../supabaseErrors';
import { useNavigate } from 'react-router-dom';
import {
  supabase, liveQuery, toColumns, handleSupabaseError, OperationType,
} from '../../lib/supabase';
import { ApiError, approveScoutIntake } from '../../lib/api';
import { accessToken } from '../../lib/session';
import type { TablesUpdate } from '../../lib/database.types';
import { ScoutIntake, ScoutBucket, Engagement, EngagementStage, EngagementStatus } from '../../types';
import { deriveCurrentStage } from '../../lib/lifecycle';
import { scoutIntakeFromRow } from '../../lib/scoutIntake';
import { getOnboardingKitName } from '../../agents/scout/routing';
import { demoAssessments, demoReviewedIntakes } from '../../lib/demoStore';
import { DEMO_INTAKES, DEMO_USER } from '../demo/demoData';
import { AnimatePresence } from 'motion/react';
import {
  ClipboardList, CheckCircle2, Pencil, HelpCircle, XCircle, ArrowRight, MessageSquareText,
  Building2, DraftingCompass, CalendarRange, RotateCcw,
} from 'lucide-react';
import { Badge, IntakeHeader, IntakeBody } from './IntakeCard';
import { decisionErrorMessage, relativeTime } from './review';
import { ReviewModal } from './ReviewModal';

interface ScoutReviewQueueProps {
  isDemo?: boolean;
}

/**
 * The decisions a reviewer can make. Approve and "edit intake card" both run the
 * Scout-approve command (the intake enters the pipeline); "needs more info" parks it;
 * decline closes it; reopen (declined tab) runs Scout-approve with `reopen` (0010) so the
 * pipeline keeps one door. None of them edits the applicant's answers or Scout's output —
 * the database locks those after submission, by design.
 */
type ModalMode = 'edit' | 'info' | 'decline' | 'reopen';

/** One screen, four tabs: the two open states and the two decided outcomes. */
export type ScoutTab = 'pending' | 'needs_info' | 'approved' | 'declined';

const TABS: { key: ScoutTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'needs_info', label: 'Needs info' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
];

const TIER_MEANING: Record<ScoutIntake['hitlTier'], string> = {
  L2: 'Scout is confident and they look ready',
  L3: 'Needs your judgement',
};

const STAGE_LABEL: Record<EngagementStage, string> = {
  initial_meeting: 'Initial Meeting',
  budget_check: 'Budget Check',
  data_ethics_committee: 'Data Ethics Committee',
  scoping: 'Scoping',
  hackathon_ready: 'Hackathon Ready',
  membership: 'Membership',
};

const STATUS_LABEL: Record<EngagementStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-slate-50 text-slate-500 border-slate-200' },
  in_progress: { label: 'In progress', className: 'bg-blue-50 text-blue-600 border-blue-100' },
  completed: { label: 'Completed', className: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
};

interface BusinessRef { id: string; scoutIntakeId: string | null }

const tabOf = (i: ScoutIntake): ScoutTab => {
  if (i.reviewStatus !== 'reviewed') return i.reviewStatus;
  return i.reviewAction === 'redirected' ? 'declined' : 'approved';
};

const EMPTY_COPY: Record<ScoutTab, string> = {
  pending: 'No applications waiting for a decision.',
  needs_info: 'No applications waiting on the applicant.',
  approved: 'No approved applications yet.',
  declined: 'No declined applications.',
};

const BTN = 'py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 flex items-center justify-center gap-1.5';

export default function ScoutReviewQueue({ isDemo }: ScoutReviewQueueProps) {
  const navigate = useNavigate();
  const [intakes, setIntakes] = useState<ScoutIntake[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRef[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [assessedIds, setAssessedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ScoutTab>('pending');
  const [modal, setModal] = useState<{ mode: ModalMode; target: ScoutIntake } | null>(null);
  const [modalBucket, setModalBucket] = useState<ScoutBucket | ''>('');
  const [modalNotes, setModalNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) {
      // Restore any decisions made earlier this demo session (module store
      // survives navigation; component state doesn't).
      setIntakes(DEMO_INTAKES.map(i => demoReviewedIntakes.get(i.id) ?? i));
      setAssessedIds(new Set(demoAssessments.keys()));
      setLoading(false);
      return;
    }

    const fail = (table: string, what: string) => (err: unknown) => {
      setLoading(false);
      setError(reportSupabaseError(err, OperationType.LIST, table, what));
    };

    // All admin-scoped at the database (scout_intakes_select_admin, businesses_select_admin,
    // engagements_select_admin): a non-admin sees empty lists, not errors.
    const unsubs = [
      liveQuery<Record<string, unknown>>(
        'scout_intakes',
        () => supabase.from('scout_intakes').select('*'),
        (rows) => { setIntakes(rows.map(scoutIntakeFromRow)); setLoading(false); },
        fail('scout_intakes', 'Could not load the intake queue. The list below may be empty or stale.'),
        ['submittedAt', 'reviewedAt'],
      ),
      liveQuery<BusinessRef>(
        'businesses',
        () => supabase.from('businesses').select('id, scout_intake_id'),
        setBusinesses,
        fail('businesses', 'Could not load partner links. Engagement stages may be missing.'),
      ),
      liveQuery<Engagement>(
        'engagements',
        () => supabase.from('engagements').select('*'),
        setEngagements,
        fail('engagements', 'Could not load engagements. Stages may be missing.'),
        ['updatedAt'],
      ),
      liveQuery<{ id: string }>(
        'architect_assessments',
        () => supabase.from('architect_assessments').select('id'),
        (rows) => setAssessedIds(new Set(rows.map(r => r.id))),
        fail('architect_assessments', 'Could not load assessment status. "Assessed" badges may be missing.'),
      ),
    ];
    return () => unsubs.forEach(u => u());
  }, [isDemo]);

  const count = (t: ScoutTab) => intakes.filter(i => tabOf(i) === t).length;

  // Pending: L2 first — Scout is confident and the org is ready, so those are one-click
  // confirmations — then L3, each group newest first. Every other tab: most recently
  // reviewed first.
  const visible = intakes
    .filter(i => tabOf(i) === tab)
    .sort((a, b) =>
      (tab === 'pending' && a.hitlTier !== b.hitlTier ? (a.hitlTier === 'L2' ? -1 : 1) : 0)
      || (tab === 'pending'
        ? (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0)
        : (b.reviewedAt?.seconds || 0) - (a.reviewedAt?.seconds || 0)));

  /** Where an approved application's engagement stands, from its business's stage rows. */
  const progress = (intake: ScoutIntake) => {
    const business = businesses.find(b => b.scoutIntakeId === intake.id);
    if (!business) return null;
    const current = deriveCurrentStage(engagements.filter(e => e.businessId === business.id));
    return { businessId: business.id, current };
  };

  const replaceLocal = (updated: ScoutIntake) => {
    demoReviewedIntakes.set(updated.id, updated);
    setIntakes(prev => prev.map(i => i.id === updated.id ? updated : i));
  };

  /** Approve (or reopen), with Scout's bucket or the reviewer's: the intake enters the pipeline. */
  const approve = async (intake: ScoutIntake, finalBucket: ScoutBucket, reviewNotes?: string, reopen = false) => {
    if (isDemo) {
      replaceLocal({
        ...intake,
        reviewStatus: 'reviewed',
        reviewAction: finalBucket === intake.bucket ? 'approved' : 'edited',
        finalBucket,
        onboardingKit: getOnboardingKitName(finalBucket),
        reviewedBy: DEMO_USER.uid,
        reviewedByEmail: DEMO_USER.email,
        reviewNotes: reviewNotes || undefined,
        reviewedAt: { seconds: Date.now() / 1000 },
      });
      return;
    }
    // The Scout-approve command (lifecycle §4 row 1): one call reviews the intake, creates
    // its business and opens `initial_meeting`. The row itself is updated server-side by
    // approve_scout_intake(); liveQuery moves it to the Approved tab.
    const token = await accessToken(supabase.auth);
    if (!token) throw new ApiError('unauthorized', null);
    await approveScoutIntake(
      {
        intakeId: intake.id,
        // Per click, so a retry of a failed request replays rather than refuses.
        idempotencyKey: `${reopen ? 'reopen' : 'review'}-${crypto.randomUUID()}`,
        finalBucket,
        ...(reopen ? { reopen: true } : {}),
        ...(reviewNotes ? { reviewNotes } : {}),
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  };

  /**
   * Park or decline: both are a direct admin update of the review fields (0001_core's
   * review-only trigger; `needs_info` from 0010). Neither opens an engagement — a declined
   * intake can only enter the pipeline by being reopened from the Declined tab.
   */
  const updateReview = async (intake: ScoutIntake, patch: Partial<ScoutIntake> & Record<string, unknown>) => {
    if (isDemo) {
      replaceLocal({
        ...intake,
        ...patch,
        reviewedBy: DEMO_USER.uid,
        reviewedByEmail: DEMO_USER.email,
        reviewedAt: { seconds: Date.now() / 1000 },
      } as ScoutIntake);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const row = {
      ...patch,
      reviewedBy: user?.id,
      // `?? undefined` rather than the raw value: Supabase types email as `string | null`,
      // while ScoutIntake declares `string | undefined`.
      reviewedByEmail: user?.email ?? undefined,
      // reviewed_at has no column default (0001_core), so it is sent explicitly.
      reviewedAt: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('scout_intakes')
      .update(toColumns<TablesUpdate<'scout_intakes'>>(row))
      .eq('id', intake.id);
    if (error) handleSupabaseError(error, OperationType.UPDATE, `scout_intakes/${intake.id}`);
  };

  const run = async (intake: ScoutIntake, action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'client_error';
      const requestId = err instanceof ApiError ? err.requestId : null;
      console.error(`ScoutReviewQueue: review decision for ${intake.id} failed — not saved (${code})`, err);
      setError(decisionErrorMessage(code) + (requestId ? ` Reference: ${requestId}.` : ''));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = (intake: ScoutIntake) => {
    if (!intake.bucket) return;
    void run(intake, () => approve(intake, intake.bucket as ScoutBucket));
  };

  const openModal = (mode: ModalMode, intake: ScoutIntake) => {
    setModal({ mode, target: intake });
    setModalBucket(mode === 'reopen' ? (intake.bucket ?? intake.finalBucket ?? '') : (intake.bucket ?? ''));
    setModalNotes('');
  };

  const closeModal = () => setModal(null);

  const confirmModal = async () => {
    if (!modal) return;
    const { mode, target } = modal;
    const notes = modalNotes.trim();
    await run(target, async () => {
      if (mode === 'edit') {
        if (!modalBucket) return;
        await approve(target, modalBucket, notes || undefined);
      } else if (mode === 'reopen') {
        if (!modalBucket) return;
        await approve(target, modalBucket, notes || undefined, true);
        setTab('approved');
      } else if (mode === 'info') {
        await updateReview(target, { reviewStatus: 'needs_info', reviewNotes: notes });
      } else {
        if (!modalBucket) return;
        await updateReview(target, {
          reviewStatus: 'reviewed',
          reviewAction: 'redirected',
          finalBucket: modalBucket,
          onboardingKit: getOnboardingKitName(modalBucket),
          reviewNotes: notes,
        });
      }
    });
    closeModal();
  };

  const open = tab === 'pending' || tab === 'needs_info';

  return (
    <div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10">
        <div>
          <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight">
            Scout <span className="italic">Intake Review</span>
          </h2>
          <p className="text-sm text-slate-500 mt-2 max-w-xl">
            Scout recommends a bucket; you decide. Approving opens the engagement and hands the partner to Architect.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 bg-slate-100 p-1 rounded-xl">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                tab === key ? 'bg-white text-dssg-blue shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {label} ({count(key)})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-16 text-center shadow-sm">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <ClipboardList size={40} className="text-slate-300" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900">Nothing here</h3>
          <p className="text-slate-500 mt-2">{EMPTY_COPY[tab]}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {visible.map(intake => {
            const p = tab === 'approved' ? progress(intake) : null;
            return (
              <div key={intake.id} className="bento-card p-6 flex flex-col gap-6">
                <IntakeHeader
                  intake={intake}
                  right={
                    tab === 'pending' ? (
                      <>
                        <Badge label={intake.hitlTier} className={intake.hitlTier === 'L2' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-purple-50 text-purple-600 border-purple-100'} />
                        <span className="text-[10px] font-medium text-slate-400">{TIER_MEANING[intake.hitlTier]}</span>
                      </>
                    ) : tab === 'needs_info' ? (
                      <>
                        <Badge label="Waiting on applicant" className="bg-amber-50 text-amber-600 border-amber-100" />
                        <span className="text-[10px] font-medium text-slate-400">
                          asked by {intake.reviewedByEmail}{intake.reviewedAt?.seconds ? ` · ${relativeTime(intake.reviewedAt.seconds)}` : ''}
                        </span>
                      </>
                    ) : tab === 'approved' ? (
                      <>
                        {p?.current ? (
                          <div className="flex flex-wrap gap-2 justify-end">
                            <Badge label={STAGE_LABEL[p.current.stage]} className="bg-dssg-blue text-white border-dssg-blue" />
                            <Badge label={STATUS_LABEL[p.current.row.status].label} className={STATUS_LABEL[p.current.row.status].className} />
                          </div>
                        ) : (
                          <Badge label={p ? 'No stage yet' : 'Not in pipeline'} className="bg-slate-50 text-slate-500 border-slate-200" />
                        )}
                        <span className="text-[10px] font-medium text-slate-400">
                          {intake.reviewAction === 'edited' ? 'approved into a different bucket' : 'approved'} by {intake.reviewedByEmail}
                          {intake.reviewedAt?.seconds ? ` · ${relativeTime(intake.reviewedAt.seconds)}` : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <Badge label="Declined" className="bg-rose-50 text-rose-600 border-rose-100" />
                        <span className="text-[10px] font-medium text-slate-400">
                          by {intake.reviewedByEmail}{intake.reviewedAt?.seconds ? ` · ${relativeTime(intake.reviewedAt.seconds)}` : ''}
                        </span>
                      </>
                    )
                  }
                />

                {tab === 'needs_info' && intake.reviewNotes && (
                  <div className="flex items-start gap-2 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
                    <MessageSquareText size={14} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-600">What we asked for</p>
                      <p className="text-xs text-slate-700 leading-relaxed">{intake.reviewNotes}</p>
                    </div>
                  </div>
                )}

                {!open && (
                  <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${tab === 'declined' ? 'bg-rose-50/60 border-rose-100' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">
                        {tab === 'declined' ? 'Why not now' : 'Decision'} · {intake.finalBucket}
                      </p>
                      {tab === 'approved' && intake.finalBucket !== intake.bucket && (
                        <p className="text-[11px] text-slate-500 mt-0.5">Scout had suggested {intake.bucket ?? 'no bucket'}.</p>
                      )}
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">{intake.onboardingKit ?? (intake.finalBucket ? getOnboardingKitName(intake.finalBucket) : '')}</p>
                      {intake.reviewNotes
                        ? <p className="text-xs text-slate-700 italic mt-1">“{intake.reviewNotes}”</p>
                        : <p className="text-xs text-slate-400 mt-1">No notes.</p>}
                    </div>
                  </div>
                )}

                <IntakeBody intake={intake} />

                {open ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-4 border-t border-slate-100">
                    <button
                      onClick={() => handleApprove(intake)}
                      disabled={!intake.bucket || saving}
                      className={`${BTN} bg-emerald-500 text-white hover:bg-emerald-600`}
                      title={intake.bucket ? `Accept Scout's card as is — ${intake.bucket}; opens the first engagement stage` : 'Scout could not pick a bucket — use "Edit intake card" to choose one'}
                    >
                      <CheckCircle2 size={14} /> Approve
                    </button>
                    <button
                      onClick={() => openModal('edit', intake)}
                      disabled={saving}
                      className={`${BTN} bg-slate-100 text-slate-600 hover:bg-slate-200`}
                      title="Change the bucket on Scout's card, then approve; the override is recorded"
                    >
                      <Pencil size={14} /> Edit intake card
                    </button>
                    <button
                      onClick={() => openModal('info', intake)}
                      disabled={saving}
                      className={`${BTN} bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700`}
                      title="Park this application until the applicant sends what is missing; it stays out of the pipeline"
                    >
                      <HelpCircle size={14} /> {tab === 'needs_info' ? 'Ask again' : 'Needs more info'}
                    </button>
                    <button
                      onClick={() => openModal('decline', intake)}
                      disabled={saving}
                      className={`${BTN} bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-700`}
                      title="Close this application without opening an engagement; it can be reopened from the Declined tab"
                    >
                      <XCircle size={14} /> Decline
                    </button>
                  </div>
                ) : tab === 'approved' ? (
                  <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-slate-100">
                    {p && (
                      <button
                        onClick={() => navigate(`/business/${p.businessId}`)}
                        className={`${BTN} flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200`}
                      >
                        <Building2 size={14} /> Open partner
                      </button>
                    )}
                    {assessedIds.has(intake.id) ? (
                      <button
                        onClick={() => navigate(`/architect/plan/${intake.id}`)}
                        className={`${BTN} flex-1 bg-dssg-blue text-white hover:bg-dssg-blue-light`}
                      >
                        <CalendarRange size={14} /> View 90-Day Plan
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/architect/assess/${intake.id}`)}
                        className={`${BTN} flex-1 bg-slate-100 text-dssg-blue hover:bg-blue-50`}
                      >
                        <DraftingCompass size={14} /> Architect Assessment <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex pt-4 border-t border-slate-100">
                    <button
                      onClick={() => openModal('reopen', intake)}
                      disabled={saving}
                      className={`${BTN} flex-1 bg-slate-100 text-dssg-blue hover:bg-blue-50`}
                      title="Reverse the decline: approve into the pipeline under your name"
                    >
                      <RotateCcw size={14} /> Reopen &amp; approve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {modal?.mode === 'edit' && (
          <ReviewModal
            title="Edit intake card"
            intro="Change the bucket Scout put on the card, then approve. The application enters the pipeline under your bucket; Scout's recommendation stays on record so overrides can be measured."
            bucket={{ label: 'Bucket', value: modalBucket, onChange: setModalBucket }}
            notes={{ label: 'Why a different bucket?', value: modalNotes, onChange: setModalNotes, required: false }}
            confirmLabel="Approve with this bucket"
            busy={saving}
            onConfirm={confirmModal}
            onClose={closeModal}
          />
        )}
        {modal?.mode === 'info' && (
          <ReviewModal
            title="Needs more info"
            intro="The application waits on the applicant and stays out of the pipeline. Nothing is sent automatically — reach out with what you write here."
            notes={{ label: 'What is missing?', value: modalNotes, onChange: setModalNotes, required: true, placeholder: 'e.g. Which systems hold the visit data, and who would own the work on their side?' }}
            confirmLabel="Park until they reply"
            busy={saving}
            onConfirm={confirmModal}
            onClose={closeModal}
          />
        )}
        {modal?.mode === 'decline' && (
          <ReviewModal
            title="Decline this application"
            intro="No engagement is opened and the applicant is not notified. The decision is kept on the Declined tab, where it can be reopened."
            bucket={{ label: 'Closest fit, for the record', value: modalBucket, onChange: setModalBucket }}
            notes={{ label: 'Why not now?', value: modalNotes, onChange: setModalNotes, required: true, placeholder: 'e.g. No data to work from yet; suggested they start with a volunteer data audit.' }}
            confirmLabel="Decline application"
            danger
            busy={saving}
            onConfirm={confirmModal}
            onClose={closeModal}
          />
        )}
        {modal?.mode === 'reopen' && (
          <ReviewModal
            title="Reopen & approve"
            intro="The decline is replaced by an approval under your name, the business is created and the first engagement stage opens. The original decline stays in the audit trail."
            bucket={{ label: 'Bucket', value: modalBucket, onChange: setModalBucket }}
            notes={{ label: 'What changed?', value: modalNotes, onChange: setModalNotes, required: true, placeholder: 'e.g. They came back with two years of visit data and a named data lead.' }}
            confirmLabel="Reopen and approve"
            busy={saving}
            onConfirm={confirmModal}
            onClose={closeModal}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
