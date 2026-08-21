import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, handleSupabaseError, rowToDomain, OperationType } from '../../lib/supabase';
import { ArchitectAssessment } from '../../types';
import { DIMENSION_LABELS, LEVEL_NAMES } from '../../lib/architectScoring';
import { demoAssessments } from '../../lib/demoStore';
import { motion } from 'motion/react';
import {
  DraftingCompass, ChevronLeft, AlertTriangle, ShieldAlert, Flag,
  CalendarRange, FileText, FileSignature, Presentation, Pencil, CheckCircle2,
} from 'lucide-react';

interface Props {
  isDemo?: boolean;
}

type Tab = 'plan' | 'charter' | 'mou' | 'deck';

const COMPOSITE_COLOR: Record<string, string> = {
  Foundational: 'bg-rose-50 text-rose-600 border-rose-100',
  Developing: 'bg-amber-50 text-amber-600 border-amber-100',
  Established: 'bg-emerald-50 text-emerald-600 border-emerald-100',
};

export default function ArchitectPlan({ isDemo }: Props) {
  const { intakeId } = useParams();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState<ArchitectAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('plan');

  useEffect(() => {
    if (!intakeId) return;

    if (isDemo) {
      setAssessment(demoAssessments.get(intakeId) ?? null);
      setLoading(false);
      return;
    }

    // `architect_assessments.id` IS the source intake id (a 1:1 with scout_intakes that
    // firestore.rules:200 also enforced), so this stays a primary-key lookup, not a filter
    // on a separate column.
    supabase
      .from('architect_assessments')
      .select('*')
      .eq('id', intakeId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          try {
            handleSupabaseError(error, OperationType.GET, `architect_assessments/${intakeId}`);
          } catch { /* logged */ }
        } else if (data) {
          setAssessment(rowToDomain<ArchitectAssessment>(data, ['createdAt', 'updatedAt']));
        }
        setLoading(false);
      });
  }, [intakeId, isDemo]);

  if (loading) return <div className="h-screen flex items-center justify-center text-slate-400 text-sm font-medium">Loading plan…</div>;

  if (!assessment) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <h2 className="text-2xl font-display font-bold text-dssg-blue mb-3">No assessment found</h2>
        <p className="text-slate-500 text-sm mb-8">
          This organization hasn't been through the Architect assessment yet.
          {isDemo && ' (Demo Mode data resets on page reload.)'}
        </p>
        <button onClick={() => navigate('/scout/review')} className="btn-primary">Go to Review Queue</button>
      </div>
    );
  }

  const a = assessment;
  const scores = {
    di_score: a.di_score, gov_score: a.gov_score, tooling_score: a.tooling_score,
    dc_score: a.dc_score, tc_score: a.tc_score,
  } as const;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/scout/review')}
          className="flex items-center gap-2 text-slate-400 hover:text-dssg-blue transition-all font-bold text-[10px] uppercase tracking-[0.2em]"
        >
          <ChevronLeft size={14} /> Review Queue
        </button>
        <Link
          to={`/architect/assess/${a.id}`}
          className="flex items-center gap-2 text-slate-400 hover:text-dssg-blue transition-all font-bold text-[10px] uppercase tracking-[0.2em]"
        >
          <Pencil size={12} /> Re-conduct Assessment
        </Link>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-dssg-blue rounded-full text-[10px] font-bold uppercase tracking-widest mb-4">
            <DraftingCompass size={12} />
            Architect · Engagement Blueprint
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-4xl font-display font-bold text-dssg-blue tracking-tight leading-tight">
              {a.org_name}
            </h1>
            <div className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border ${COMPOSITE_COLOR[a.compositeLevel]}`}>
              {a.compositeLevel} · {a.points}/21 pts
            </div>
          </div>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-3">
            Scout bucket: {a.scoutBucket} · Confidence: {a.scoutConfidence ?? '—'} · Readiness: {a.scoutReadiness}
          </p>
        </div>

        {/* Warning banners */}
        <div className="space-y-3 mb-10">
          {a.crossCheckFlag && (
            <Banner icon={ShieldAlert} tone="rose" title="Scout cross-check failed" body={a.crossCheckFlag} />
          )}
          {a.overrideApplied && (
            <Banner icon={AlertTriangle} tone="amber" title="Data Infrastructure override applied" body="Points reached Established, but a Foundational Data Infrastructure score caps this engagement at Developing — you can't run a project on data that doesn't exist." />
          )}
          {a.remediationOnly && (
            <Banner icon={Flag} tone="amber" title="Remediation-only 90-day plan" body="Two or more dimensions flagged Foundational. The flagged workstreams ARE the deliverable; the stretch project is deferred to Phase 2." />
          )}
          {!a.remediationOnly && a.flaggedDimensions.length === 1 && (
            <Banner icon={Flag} tone="amber" title="Required workstream flagged" body={`${a.flaggedDimensions[0] === 'data_infrastructure' ? 'Data Integration & Hygiene' : 'Reporting Automation'} is a required, named workstream in this plan — never folded into generic "areas to improve."`} />
          )}
        </div>

        {/* Maturity scorecard */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-12">
          {DIMENSION_LABELS.map(dim => {
            const score = scores[dim.key as keyof typeof scores];
            const flagged =
              (dim.key === 'di_score' && a.flaggedDimensions.includes('data_infrastructure')) ||
              (dim.key === 'gov_score' && a.flaggedDimensions.includes('governance'));
            return (
              <div key={dim.key} className={`bento-card p-5 ${flagged ? 'border-amber-200 bg-amber-50/40' : ''}`}>
                <div className="flex gap-1 mb-3">
                  {[1, 2, 3].map(n => (
                    <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= score ? (flagged ? 'bg-amber-500' : 'bg-dssg-blue') : 'bg-slate-200'}`} />
                  ))}
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-tight mb-1">
                  {dim.label} <span className="text-slate-300">×{dim.weight}</span>
                </p>
                <p className={`text-sm font-bold ${flagged ? 'text-amber-600' : 'text-slate-700'}`}>
                  {LEVEL_NAMES[score]}
                </p>
              </div>
            );
          })}
        </div>

        {/* Document tabs */}
        <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit mb-8 flex-wrap">
          <TabButton active={tab === 'plan'} onClick={() => setTab('plan')} icon={CalendarRange} label="90-Day Plan" />
          <TabButton active={tab === 'charter'} onClick={() => setTab('charter')} icon={FileText} label="Charter" />
          <TabButton active={tab === 'mou'} onClick={() => setTab('mou')} icon={FileSignature} label="MOU" />
          <TabButton active={tab === 'deck'} onClick={() => setTab('deck')} icon={Presentation} label="Kickoff Deck" />
        </div>

        {tab === 'plan' && (
          <div className="space-y-6">
            <div className="bento-card accent-stripe-blue p-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Plan shape: {a.ninetyDayPlan.shape.replace(/_/g, ' ')}</p>
              <p className="text-xl font-display font-medium text-slate-800 leading-snug">{a.ninetyDayPlan.headline}</p>
              {a.ninetyDayPlan.phase2Note && (
                <p className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-4 leading-relaxed font-medium">
                  {a.ninetyDayPlan.phase2Note}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {a.ninetyDayPlan.phases.map((phase, idx) => (
                <div key={phase.window} className="bento-card p-6 flex flex-col">
                  <span className="font-display font-bold text-dssg-orange text-lg mb-1">0{idx + 1}</span>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{phase.window}</p>
                  <h3 className="text-lg font-display font-bold text-dssg-blue mb-4">{phase.title}</h3>
                  <ul className="space-y-3">
                    {phase.milestones.map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-600 font-medium leading-relaxed">
                        <CheckCircle2 size={13} className="text-slate-300 shrink-0 mt-0.5" />
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="bento-card p-8">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-5">Workstreams</h3>
              <div className="space-y-4">
                {a.ninetyDayPlan.workstreams.map(ws => (
                  <div key={ws.name} className="flex items-start gap-4">
                    <div className={`px-2.5 py-1 rounded text-[9px] font-bold uppercase tracking-widest border shrink-0 ${
                      ws.required ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'
                    }`}>
                      {ws.required ? 'Required' : 'Project'}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{ws.name}</p>
                      <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{ws.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'charter' && (
          <div className="bento-card p-10 space-y-8">
            <div>
              <h2 className="text-2xl font-display font-bold text-dssg-blue mb-1">{a.charter.title}</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Cadence: {a.charter.cadence}</p>
            </div>
            <CharterSection title="Background">
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{a.charter.background}</p>
            </CharterSection>
            <CharterSection title="Scope">
              <p className="text-sm text-slate-600 leading-relaxed">{a.charter.scopeStatement}</p>
            </CharterSection>
            <CharterSection title="Objectives">
              <ul className="space-y-2">
                {a.charter.objectives.map((o, i) => (
                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                    <span className="text-dssg-orange font-bold">→</span> {o}
                  </li>
                ))}
              </ul>
            </CharterSection>
            <CharterSection title="Risks">
              <ul className="space-y-2">
                {a.charter.risks.map((r, i) => (
                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2 leading-relaxed">
                    <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" /> {r}
                  </li>
                ))}
              </ul>
            </CharterSection>
            <CharterSection title="Success Criteria">
              <ul className="space-y-2">
                {a.charter.successCriteria.map((s, i) => (
                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" /> {s}
                  </li>
                ))}
              </ul>
            </CharterSection>
          </div>
        )}

        {tab === 'mou' && <PlaceholderDoc name="Memorandum of Understanding" />}
        {tab === 'deck' && <PlaceholderDoc name="Kickoff Deck" />}
      </motion.div>
    </div>
  );
}

function Banner({ icon: Icon, tone, title, body }: { icon: any; tone: 'rose' | 'amber'; title: string; body: string }) {
  const styles = tone === 'rose'
    ? 'bg-rose-50 border-rose-200 text-rose-700'
    : 'bg-amber-50 border-amber-200 text-amber-700';
  return (
    <div className={`flex items-start gap-3 p-4 rounded-2xl border ${styles}`}>
      <Icon size={18} className="shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-bold uppercase tracking-widest">{title}</p>
        <p className="text-xs font-medium leading-relaxed mt-1 opacity-90">{body}</p>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 ${
        active ? 'bg-white text-dssg-blue shadow-sm' : 'text-slate-400 hover:text-slate-600'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function CharterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function PlaceholderDoc({ name }: { name: string }) {
  return (
    <div className="bento-card p-16 text-center">
      <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <FileSignature size={28} className="text-slate-300" />
      </div>
      <h3 className="text-xl font-display font-bold text-slate-700 mb-2">{name}</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
        Template not yet drafted — listed as an open item in <span className="font-mono text-xs">architect-design.md</span> ("Still open"). The charter and 90-day plan carry the engagement's substance for this build.
      </p>
    </div>
  );
}
