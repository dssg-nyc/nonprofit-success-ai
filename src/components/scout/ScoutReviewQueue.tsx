import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  supabase, liveQuery, toColumns, handleSupabaseError, OperationType,
} from '../../lib/supabase';
import { ScoutIntake, ScoutBucket, SCOUT_BUCKETS } from '../../types';
import { routeScoutIntake, getOnboardingKitName } from '../../agents/scout/routing';
import { demoAssessments, demoReviewedIntakes } from '../../lib/demoStore';
import { motion, AnimatePresence } from 'motion/react';
import {
  ClipboardList, CheckCircle2, Pencil, CornerUpRight, Flag, X, Mail, Building2,
  DraftingCompass, CalendarRange,
} from 'lucide-react';

interface ScoutReviewQueueProps {
  isDemo?: boolean;
}

const DEMO_USER = { uid: 'demo-user-123', email: 'demo@nyc-dssg.org' };

function buildDemoIntake(id: string, base: {
  org_name: string; contact_name_role: string; contact_email: string; mission: string;
  scale: string; primary_need: ScoutIntake['primary_need']; problem_description: string;
  current_systems: string; timeline: string; referral_source: string; ageSeconds: number;
}): ScoutIntake {
  const { ageSeconds, ...intakeFields } = base;
  const result = routeScoutIntake(intakeFields);
  return {
    id,
    ...intakeFields,
    submittedAt: { seconds: Date.now() / 1000 - ageSeconds },
    ...result,
    reviewStatus: 'pending',
  };
}

const DEMO_INTAKES: ScoutIntake[] = [
  buildDemoIntake('demo-scout-1', {
    org_name: 'Uptown Youth Corps',
    contact_name_role: 'Maria Gonzalez, Program Director',
    contact_email: 'maria@uptownyouthcorps.org',
    mission: 'We provide after-school workforce training and mentorship to NYC teens.',
    scale: '~400 participants/year, staff of 18',
    primary_need: 'ml_predictive',
    problem_description: 'We want to predict which participants are at risk of dropping out of our program so we can intervene early with extra support.',
    current_systems: 'Salesforce CRM with 5 years of program completion data.',
    timeline: 'This quarter, before our next cohort starts in September.',
    referral_source: 'DSSG hackathon alum',
    ageSeconds: 86400,
  }),
  buildDemoIntake('demo-scout-2', {
    org_name: 'Riverside Family Services',
    contact_name_role: 'Tom Reyes, Development Manager',
    contact_email: 'tom@riversidefamily.org',
    mission: 'We connect low-income families in Queens with housing and legal aid services.',
    scale: '~1200 families/year, staff of 12',
    primary_need: 'ml_predictive',
    problem_description: 'We really just need a dashboard that shows our board members quarterly funding numbers.',
    current_systems: 'A mix of spreadsheets and an old Access database.',
    timeline: 'Before our next board meeting in October.',
    referral_source: 'Google search',
    ageSeconds: 43200,
  }),
  buildDemoIntake('demo-scout-3', {
    org_name: 'Queens Neighborhood Kitchen',
    contact_name_role: 'Sam',
    contact_email: 'sam@qnkitchen.org',
    mission: 'We run a small community food pantry.',
    scale: 'All-volunteer, 2 people, ~50 families/year',
    primary_need: 'analyze_data',
    problem_description: 'We want to understand our community better and use data more.',
    current_systems: 'Just a shared Google spreadsheet.',
    timeline: 'Not sure yet.',
    referral_source: 'Word of mouth',
    ageSeconds: 3600,
  }),
];

type ModalMode = 'edit' | 'redirect';

const CONFIDENCE_COLOR: Record<string, string> = {
  High: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  Medium: 'bg-amber-50 text-amber-600 border-amber-100',
  Low: 'bg-rose-50 text-rose-600 border-rose-100',
};

const SIGNAL_COLOR: Record<string, string> = {
  Ready: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  Conditional: 'bg-amber-50 text-amber-600 border-amber-100',
  'Not Ready': 'bg-rose-50 text-rose-600 border-rose-100',
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.1em] border ${className}`}>
      {label}
    </span>
  );
}

function ScorePip({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-0.5">
        {[1, 2, 3].map(n => (
          <div key={n} className={`w-2.5 h-2.5 rounded-full ${n <= score ? 'bg-dssg-blue' : 'bg-slate-200'}`} />
        ))}
      </div>
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
    </div>
  );
}

export default function ScoutReviewQueue({ isDemo }: ScoutReviewQueueProps) {
  const navigate = useNavigate();
  const [intakes, setIntakes] = useState<ScoutIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending');
  const [modal, setModal] = useState<{ mode: ModalMode; target: ScoutIntake } | null>(null);
  const [modalBucket, setModalBucket] = useState<ScoutBucket | ''>('');
  const [modalNotes, setModalNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [assessedIds, setAssessedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isDemo) {
      // Restore any decisions made earlier this demo session (module store
      // survives navigation; component state doesn't).
      setIntakes(DEMO_INTAKES.map(i => demoReviewedIntakes.get(i.id) ?? i));
      setAssessedIds(new Set(demoAssessments.keys()));
      setLoading(false);
      return;
    }

    // Both reads are admin-only at the database: scout_intakes_select_admin and the
    // assessments policies check is_admin(). A non-admin reaching this route sees an empty
    // queue rather than an error, which is the same outcome the Firestore rules produced.
    const unsubscribe = liveQuery<ScoutIntake>(
      'scout_intakes',
      () => supabase.from('scout_intakes').select('*'),
      (rows) => {
        setIntakes(rows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        try {
          handleSupabaseError(err, OperationType.LIST, 'scout_intakes');
        } catch { /* logged */ }
      },
      ['submittedAt', 'reviewedAt'],
    );

    const unsubAssessments = liveQuery<{ id: string }>(
      'architect_assessments',
      // Only the id is needed — this drives an "assessed" badge, not a detail view.
      () => supabase.from('architect_assessments').select('id'),
      (rows) => setAssessedIds(new Set(rows.map(r => r.id))),
      (err) => {
        try {
          handleSupabaseError(err, OperationType.LIST, 'architect_assessments');
        } catch { /* logged */ }
      },
    );

    return () => { unsubscribe(); unsubAssessments(); };
  }, [isDemo]);

  const visible = intakes
    .filter(i => i.reviewStatus === tab)
    .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));

  const applyDecision = async (intake: ScoutIntake, finalBucket: ScoutBucket, reviewAction: 'approved' | 'edited' | 'redirected', reviewNotes?: string) => {
    const { data: { user } } = isDemo
      ? { data: { user: null } }
      : await supabase.auth.getUser();

    const patch = {
      reviewStatus: 'reviewed' as const,
      reviewAction,
      finalBucket,
      onboardingKit: getOnboardingKitName(finalBucket),
      reviewedBy: isDemo ? DEMO_USER.uid : user?.id,
      // `?? undefined` rather than the raw value: Supabase types email as `string | null`,
      // while ScoutIntake declares `string | undefined`. Without this the assignment is a
      // type error under strictNullChecks — the same mismatch flagged at ScoutReviewQueue
      // :167 before the migration.
      reviewedByEmail: isDemo ? DEMO_USER.email : user?.email ?? undefined,
      ...(reviewNotes ? { reviewNotes } : {}),
    };

    if (isDemo) {
      const updated: ScoutIntake = { ...intake, ...patch, reviewedAt: { seconds: Date.now() / 1000 } };
      demoReviewedIntakes.set(intake.id, updated);
      setIntakes(prev => prev.map(i => i.id === intake.id ? updated : i));
      return;
    }

    setSaving(true);
    try {
      // reviewed_at has no column default (0001_init.sql:218), so it is sent explicitly —
      // unlike scout_intakes.submitted_at, which does default and is left to the server.
      const { error } = await supabase
        .from('scout_intakes')
        .update(toColumns({ ...patch, reviewedAt: new Date().toISOString() }))
        .eq('id', intake.id);

      if (error) handleSupabaseError(error, OperationType.UPDATE, `scout_intakes/${intake.id}`);
    } catch (err) {
      try {
        handleSupabaseError(err, OperationType.UPDATE, `scout_intakes/${intake.id}`);
      } catch { /* logged */ }
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = (intake: ScoutIntake) => {
    if (!intake.bucket) return;
    applyDecision(intake, intake.bucket, 'approved');
  };

  const openModal = (mode: ModalMode, intake: ScoutIntake) => {
    setModal({ mode, target: intake });
    setModalBucket(intake.bucket ?? '');
    setModalNotes('');
  };

  const closeModal = () => setModal(null);

  const confirmModal = async () => {
    if (!modal || !modalBucket) return;
    await applyDecision(modal.target, modalBucket, modal.mode === 'edit' ? 'edited' : 'redirected', modalNotes || undefined);
    closeModal();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-dssg-blue rounded-full text-[10px] font-bold uppercase tracking-widest mb-4">
            <ClipboardList size={12} />
            Scout Review Queue
          </div>
          <h1 className="text-4xl font-display font-bold text-dssg-blue tracking-tight leading-[1.1]">
            Intake <span className="italic">Review</span>
          </h1>
        </div>
        <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
          {(['pending', 'reviewed'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                tab === t ? 'bg-white text-dssg-blue shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t} {t === 'pending' ? `(${intakes.filter(i => i.reviewStatus === 'pending').length})` : ''}
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
          <p className="text-slate-500 mt-2">No {tab} applications right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {visible.map(intake => (
            <div key={intake.id} className="bento-card p-6 flex flex-col gap-5">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <Building2 size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{intake.org_name}</span>
                  </div>
                  <h3 className="text-lg font-display font-bold text-dssg-blue leading-tight">{intake.contact_name_role}</h3>
                  <div className="flex items-center gap-1.5 text-slate-400 mt-1">
                    <Mail size={11} />
                    <span className="text-[11px] font-medium">{intake.contact_email}</span>
                  </div>
                </div>
                <Badge label={intake.hitlTier} className={intake.hitlTier === 'L2' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-purple-50 text-purple-600 border-purple-100'} />
              </div>

              <p className="text-xs text-slate-500 leading-relaxed italic">"{intake.problem_description}"</p>

              <div className="flex flex-wrap gap-2">
                <Badge label={intake.bucket ?? 'Needs manual bucket'} className={intake.bucket ? 'bg-slate-50 text-slate-700 border-slate-200' : 'bg-rose-50 text-rose-600 border-rose-100'} />
                {intake.confidence && <Badge label={`${intake.confidence} confidence`} className={CONFIDENCE_COLOR[intake.confidence]} />}
                <Badge label={intake.composite_signal} className={SIGNAL_COLOR[intake.composite_signal]} />
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">{intake.rationale}</p>

              <div className="flex justify-around py-3 border-y border-slate-50">
                <ScorePip label="POC" score={intake.poc_score} />
                <ScorePip label="Clarity" score={intake.clarity_score} />
                <ScorePip label="Foothold" score={intake.foothold_score} />
              </div>

              {intake.flags.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {intake.flags.map((flag, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[10px] font-bold text-amber-600">
                      <Flag size={11} className="shrink-0 mt-0.5" />
                      <span className="uppercase tracking-wide">{flag}</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'pending' ? (
                <div className="flex gap-2 mt-auto pt-2">
                  <button
                    onClick={() => handleApprove(intake)}
                    disabled={!intake.bucket || saving}
                    className="flex-1 py-2.5 bg-emerald-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 size={14} /> Approve
                  </button>
                  <button
                    onClick={() => openModal('edit', intake)}
                    disabled={saving}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    onClick={() => openModal('redirect', intake)}
                    disabled={saving}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center justify-center gap-1.5"
                  >
                    <CornerUpRight size={14} /> Redirect
                  </button>
                </div>
              ) : (
                <div className="mt-auto pt-2 border-t border-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-bold text-slate-300 uppercase tracking-[0.2em]">{intake.reviewAction} → {intake.finalBucket}</p>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">{intake.onboardingKit}</p>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium">{intake.reviewedByEmail}</p>
                  </div>
                  {assessedIds.has(intake.id) ? (
                    <button
                      onClick={() => navigate(`/architect/plan/${intake.id}`)}
                      className="w-full py-2.5 bg-dssg-blue text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-1.5"
                    >
                      <CalendarRange size={14} /> View 90-Day Plan
                    </button>
                  ) : (
                    <button
                      onClick={() => navigate(`/architect/assess/${intake.id}`)}
                      className="w-full py-2.5 bg-slate-100 text-dssg-blue rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-50 transition-all flex items-center justify-center gap-1.5"
                    >
                      <DraftingCompass size={14} /> Architect Assessment →
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {modal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden p-8"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-display italic font-black">
                  {modal.mode === 'edit' ? 'Edit Bucket' : 'Reject & Redirect'}
                </h2>
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                  <X />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Bucket</label>
                  <select
                    value={modalBucket}
                    onChange={e => setModalBucket(e.target.value as ScoutBucket)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-dssg-blue"
                  >
                    <option value="" disabled>Choose a bucket…</option>
                    {SCOUT_BUCKETS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">
                    Notes {modal.mode === 'redirect' ? '(why was Scout wrong?)' : '(optional)'}
                  </label>
                  <textarea
                    value={modalNotes}
                    onChange={e => setModalNotes(e.target.value)}
                    className="w-full h-24 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-dssg-blue resize-none"
                  />
                </div>

                <button
                  onClick={confirmModal}
                  disabled={!modalBucket || saving}
                  className="w-full py-4 bg-dssg-blue text-white rounded-xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
