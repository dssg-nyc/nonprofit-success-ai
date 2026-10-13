import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../ErrorBanner';
import { reportSupabaseError } from '../supabaseErrors';
import { supabase, liveQuery, OperationType } from '../../lib/supabase';
import { scoutIntakeFromRow } from '../../lib/scoutIntake';
import { deriveCurrentStage } from '../../lib/lifecycle';
import { suggestCsaAnswers } from '../../agents/architect/suggest';
import { demoAssessments, demoReviewedIntakes } from '../../lib/demoStore';
import { ScoutIntake, Engagement, EngagementStage } from '../../types';
import { DraftingCompass, CalendarRange, ArrowRight, Search } from 'lucide-react';
import { Badge } from '../scout/IntakeCard';
import { relativeTime } from '../scout/review';

/**
 * Every partner Scout approved, by name, with where its assessment stands — so an admin or
 * data diplomat can see who still needs the Current-State Assessment and open it ready for
 * the kickoff call. Architect drafts answers from the intake; the form has a human confirm
 * each one before anything is scored (HITL). Same pattern as the Scout tabs: the agent
 * proposes, the queue shows it, a person decides.
 */

interface Props {
  isDemo?: boolean;
}

interface BusinessRow { id: string; name: string; scoutIntakeId: string | null }

type AssessState = 'to_assess' | 'assessed';

const STAGE_LABEL: Record<EngagementStage, string> = {
  initial_meeting: 'Initial Meeting',
  budget_check: 'Budget Check',
  data_ethics_committee: 'Data Ethics Committee',
  scoping: 'Scoping',
  hackathon_ready: 'Hackathon Ready',
  membership: 'Membership',
};

const TABS: { key: AssessState; label: string }[] = [
  { key: 'to_assess', label: 'To assess' },
  { key: 'assessed', label: 'Assessed' },
];

export default function ArchitectQueue({ isDemo }: Props) {
  const navigate = useNavigate();
  const [intakes, setIntakes] = useState<ScoutIntake[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [assessedIds, setAssessedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AssessState>('to_assess');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) {
      setIntakes([...demoReviewedIntakes.values()].filter(i => i.reviewStatus === 'reviewed'));
      setAssessedIds(new Set(demoAssessments.keys()));
      setLoading(false);
      return;
    }
    const fail = (table: string, what: string) => (err: unknown) => {
      setLoading(false);
      setError(reportSupabaseError(err, OperationType.LIST, table, what));
    };
    // Admin-scoped at the database; a non-admin sees empty lists, not errors.
    const unsubs = [
      liveQuery<Record<string, unknown>>(
        'scout_intakes',
        () => supabase.from('scout_intakes').select('*').eq('review_status', 'reviewed'),
        (rows) => { setIntakes(rows.map(scoutIntakeFromRow)); setLoading(false); },
        fail('scout_intakes', 'Could not load approved partners. The list below may be empty or stale.'),
        ['submittedAt', 'reviewedAt'],
      ),
      liveQuery<BusinessRow>(
        'businesses',
        () => supabase.from('businesses').select('id, name, scout_intake_id'),
        setBusinesses,
        fail('businesses', 'Could not load partner names. Some rows may show the intake name instead.'),
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
        fail('architect_assessments', 'Could not load assessment status. Rows may be in the wrong tab.'),
      ),
    ];
    return () => unsubs.forEach(u => u());
  }, [isDemo]);

  const approved = intakes.filter(i => i.reviewAction === 'approved' || i.reviewAction === 'edited');

  const rows = approved
    .map(intake => {
      const business = businesses.find(b => b.scoutIntakeId === intake.id);
      const stage = business ? deriveCurrentStage(engagements.filter(e => e.businessId === business.id)) : null;
      const suggested = suggestCsaAnswers(intake).length;
      return {
        intake,
        name: business?.name ?? intake.org_name,
        businessId: business?.id ?? null,
        stage: stage?.stage ?? null,
        state: (assessedIds.has(intake.id) ? 'assessed' : 'to_assess') as AssessState,
        suggested,
      };
    })
    .filter(r => r.state === tab)
    .filter(r => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const count = (t: AssessState) => approved.filter(i => (assessedIds.has(i.id) ? 'assessed' : 'to_assess') === t).length;

  return (
    <div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10">
        <div>
          <h2 className="text-2xl font-display font-bold text-dssg-blue tracking-tight">
            Architect <span className="italic">Assessments</span>
          </h2>
          <p className="text-sm text-slate-500 mt-2 max-w-xl">
            Every approved partner, by name. Architect drafts the 18 Current-State Assessment answers from the intake;
            you confirm or correct each one on the kickoff call before the maturity score and 90-day plan are generated.
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

      <div className="relative mb-6">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find a partner by name…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-dssg-blue"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-16 text-center shadow-sm">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <DraftingCompass size={40} className="text-slate-300" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900">Nothing here</h3>
          <p className="text-slate-500 mt-2">
            {query ? 'No partner matches that name.' : tab === 'to_assess' ? 'Every approved partner has been assessed.' : 'No assessments yet.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(r => (
            <div key={r.intake.id} className="bento-card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-display font-bold text-dssg-blue leading-tight truncate">{r.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{r.intake.contact_name_role}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge label={r.intake.finalBucket ?? 'No bucket'} className="bg-dssg-blue text-white border-dssg-blue" />
                  <Badge
                    label={r.stage ? STAGE_LABEL[r.stage] : r.businessId ? 'No stage yet' : 'Not in pipeline'}
                    className="bg-slate-50 text-slate-600 border-slate-200"
                  />
                  {r.state === 'to_assess' && (
                    <Badge
                      label={`${r.suggested} of 18 drafted by Architect`}
                      className="bg-amber-50 text-amber-700 border-amber-100"
                    />
                  )}
                </div>
                <p className="text-[10px] text-slate-400 font-medium mt-2">
                  approved by {r.intake.reviewedByEmail}{r.intake.reviewedAt?.seconds ? ` · ${relativeTime(r.intake.reviewedAt.seconds)}` : ''}
                </p>
              </div>
              {r.state === 'assessed' ? (
                <button
                  onClick={() => navigate(`/architect/plan/${r.intake.id}`)}
                  className="py-2.5 px-5 bg-dssg-blue text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-dssg-blue-light transition-all flex items-center justify-center gap-1.5 shrink-0"
                >
                  <CalendarRange size={14} /> View 90-Day Plan
                </button>
              ) : (
                <button
                  onClick={() => navigate(`/architect/assess/${r.intake.id}`)}
                  className="py-2.5 px-5 bg-slate-100 text-dssg-blue rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-50 transition-all flex items-center justify-center gap-1.5 shrink-0"
                >
                  <DraftingCompass size={14} /> Review assessment <ArrowRight size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
