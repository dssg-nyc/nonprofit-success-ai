import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  ScoutIntake, ArchitectAssessment as ArchitectAssessmentDoc,
  CSA_OPTIONS, CSA_TOOL_OPTIONS, CsaTool, ScoutBucket,
} from '../../types';
import { scoreAssessment } from '../../lib/architectScoring';
import { generateCharter, generateNinetyDayPlan } from '../../lib/architectPlan';
import { demoAssessments, demoReviewedIntakes } from '../../lib/demoStore';
import { motion } from 'motion/react';
import { DraftingCompass, ChevronLeft, ArrowRight } from 'lucide-react';

interface Props {
  isDemo?: boolean;
}

const DEMO_USER = { uid: 'demo-user-123', email: 'demo@nyc-dssg.org' };

const emptyAnswers = {
  q1_org_context: '', q2_org_size: '', q3_poc: '',
  q4_collection_scope: '', q5_data_locations: '', q6_system_integration: '',
  q7_integration_familiarity: '', q8_quality_confidence: '',
  q9_current_decisions: '', q10_wished_decisions: '', q11_decision_empowerment: '',
  q12_reporting_to: '', q13_reporting_automation: '',
  q14_tools: [] as CsaTool[], q15_staff_confidence: '', q16_budget_speed: '',
  q17a_wish_list: '', q17b_biggest_worry: '', q18_past_blockers: '',
};

export default function ArchitectAssessment({ isDemo }: Props) {
  const { intakeId } = useParams();
  const navigate = useNavigate();
  const [intake, setIntake] = useState<ScoutIntake | null>(null);
  const [answers, setAnswers] = useState(emptyAnswers);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!intakeId) return;

    const load = async () => {
      if (isDemo) {
        const demoIntake = demoReviewedIntakes.get(intakeId);
        if (!demoIntake) { setNotFound(true); setLoading(false); return; }
        setIntake(demoIntake);
        const existing = demoAssessments.get(intakeId);
        if (existing) setAnswers({ ...emptyAnswers, ...pickAnswers(existing) });
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'scoutIntakes', intakeId));
        if (!snap.exists() || snap.data().reviewStatus !== 'reviewed' || !snap.data().finalBucket) {
          setNotFound(true); setLoading(false); return;
        }
        setIntake({ id: snap.id, ...snap.data() } as ScoutIntake);
        const existingSnap = await getDoc(doc(db, 'architectAssessments', intakeId));
        if (existingSnap.exists()) {
          setAnswers({ ...emptyAnswers, ...pickAnswers(existingSnap.data() as ArchitectAssessmentDoc) });
        }
      } catch (err) {
        try { handleFirestoreError(err, OperationType.GET, `architectAssessments/${intakeId}`); } catch { /* logged */ }
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [intakeId, isDemo]);

  const update = (field: keyof typeof emptyAnswers, value: string) => {
    setAnswers(prev => ({ ...prev, [field]: value }));
  };

  const toggleTool = (tool: CsaTool) => {
    setAnswers(prev => ({
      ...prev,
      q14_tools: prev.q14_tools.includes(tool)
        ? prev.q14_tools.filter(t => t !== tool)
        : [...prev.q14_tools, tool],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intake || !intakeId) return;

    const bucket = intake.finalBucket as ScoutBucket;
    const scored = {
      q4_collection_scope: answers.q4_collection_scope,
      q6_system_integration: answers.q6_system_integration,
      q7_integration_familiarity: answers.q7_integration_familiarity,
      q8_quality_confidence: answers.q8_quality_confidence,
      q11_decision_empowerment: answers.q11_decision_empowerment,
      q13_reporting_automation: answers.q13_reporting_automation,
      q14_tools: answers.q14_tools,
      q15_staff_confidence: answers.q15_staff_confidence,
      q16_budget_speed: answers.q16_budget_speed,
    } as Parameters<typeof scoreAssessment>[0];

    const maturity = scoreAssessment(scored, bucket);
    const genInput = {
      orgName: intake.org_name,
      bucket,
      maturity,
      q1_org_context: answers.q1_org_context,
      q9_current_decisions: answers.q9_current_decisions,
      q10_wished_decisions: answers.q10_wished_decisions,
      q17a_wish_list: answers.q17a_wish_list,
      q17b_biggest_worry: answers.q17b_biggest_worry,
      q18_past_blockers: answers.q18_past_blockers,
    };
    const charter = generateCharter(genInput);
    const ninetyDayPlan = generateNinetyDayPlan(genInput);

    const docBody = {
      scoutIntakeId: intakeId,
      org_name: intake.org_name,
      scoutBucket: bucket,
      scoutConfidence: intake.confidence,
      scoutReadiness: intake.composite_signal,
      ...answers,
      ...maturity,
      charter,
      ninetyDayPlan,
      createdBy: isDemo ? DEMO_USER.uid : auth.currentUser?.uid,
      createdByEmail: isDemo ? DEMO_USER.email : auth.currentUser?.email,
    };

    if (isDemo) {
      demoAssessments.set(intakeId, {
        id: intakeId,
        ...docBody,
        createdAt: { seconds: Date.now() / 1000 },
        updatedAt: { seconds: Date.now() / 1000 },
      } as ArchitectAssessmentDoc);
      navigate(`/architect/plan/${intakeId}`);
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, 'architectAssessments', intakeId), {
        ...docBody,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate(`/architect/plan/${intakeId}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `architectAssessments/${intakeId}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center text-slate-400 text-sm font-medium">Loading assessment…</div>;

  if (notFound || !intake) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <h2 className="text-2xl font-display font-bold text-dssg-blue mb-3">No reviewed intake found</h2>
        <p className="text-slate-500 text-sm mb-8">
          Architect assessments start from an approved Scout intake. {isDemo && 'In Demo Mode, approve an intake in the Review Queue first (demo data resets on page reload).'}
        </p>
        <button onClick={() => navigate('/scout/review')} className="btn-primary">Go to Review Queue</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <button
        onClick={() => navigate('/scout/review')}
        className="flex items-center gap-2 text-slate-400 hover:text-dssg-blue transition-all font-bold text-[10px] uppercase tracking-[0.2em] mb-8"
      >
        <ChevronLeft size={14} /> Review Queue
      </button>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-dssg-blue rounded-full text-[10px] font-bold uppercase tracking-widest mb-4">
            <DraftingCompass size={12} />
            Architect · Current-State Assessment
          </div>
          <h1 className="text-4xl font-display font-bold text-dssg-blue tracking-tight leading-tight mb-4">
            {intake.org_name}
          </h1>
          <div className="flex flex-wrap gap-2">
            <HandoffBadge label={`Bucket: ${intake.finalBucket}`} />
            {intake.confidence && <HandoffBadge label={`Scout confidence: ${intake.confidence}`} />}
            <HandoffBadge label={`Readiness: ${intake.composite_signal}`} />
          </div>
          <p className="text-slate-500 text-sm font-medium mt-4 leading-relaxed">
            18 questions, ~30 minutes — conducted with the org during the kickoff call. Scored sections feed the maturity model; narrative sections feed the charter directly.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-10">
          <Section n={1} title="Organization Context" note="Narrative only — not scored">
            <Field label="Q1 — What does the organization do?">
              <textarea required value={answers.q1_org_context} onChange={e => update('q1_org_context', e.target.value)} className={`${inputClass} h-20 resize-none`} />
            </Field>
            <Field label="Q2 — Organization size (staff, volunteers, budget scale)">
              <input required value={answers.q2_org_size} onChange={e => update('q2_org_size', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Q3 — Who is the point of contact for this engagement?">
              <input required value={answers.q3_poc} onChange={e => update('q3_poc', e.target.value)} className={inputClass} />
            </Field>
          </Section>

          <Section n={2} title="What Data You Have" note="→ Data Infrastructure dimension">
            <SelectField label="Q4 — How systematic is data collection across programs?" value={answers.q4_collection_scope} onChange={v => update('q4_collection_scope', v)} options={CSA_OPTIONS.q4_collection_scope} />
            <Field label="Q5 — Where does the data live today?">
              <input required value={answers.q5_data_locations} onChange={e => update('q5_data_locations', e.target.value)} className={inputClass} placeholder="e.g. Salesforce + 12 spreadsheets + paper files" />
            </Field>
            <SelectField label="Q6 — How well do your systems talk to each other?" value={answers.q6_system_integration} onChange={v => update('q6_system_integration', v)} options={CSA_OPTIONS.q6_system_integration} />
            <SelectField label="Q7 — How familiar is the team with system integration?" value={answers.q7_integration_familiarity} onChange={v => update('q7_integration_familiarity', v)} options={CSA_OPTIONS.q7_integration_familiarity} />
            <SelectField label="Q8 — How confident are you in your data's quality?" value={answers.q8_quality_confidence} onChange={v => update('q8_quality_confidence', v)} options={CSA_OPTIONS.q8_quality_confidence} />
          </Section>

          <Section n={3} title="How Data Gets Used" note="→ Decision Culture dimension">
            <Field label="Q9 — What decisions get made from data today?">
              <textarea required value={answers.q9_current_decisions} onChange={e => update('q9_current_decisions', e.target.value)} className={`${inputClass} h-20 resize-none`} />
            </Field>
            <Field label="Q10 — What decisions do you wish data could inform?">
              <textarea required value={answers.q10_wished_decisions} onChange={e => update('q10_wished_decisions', e.target.value)} className={`${inputClass} h-20 resize-none`} />
            </Field>
            <SelectField label="Q11 — Who is empowered to act on data?" value={answers.q11_decision_empowerment} onChange={v => update('q11_decision_empowerment', v)} options={CSA_OPTIONS.q11_decision_empowerment} />
          </Section>

          <Section n={4} title="Reporting & Accountability" note="→ Governance dimension">
            <Field label="Q12 — Who do you report to, and how often?">
              <input required value={answers.q12_reporting_to} onChange={e => update('q12_reporting_to', e.target.value)} className={inputClass} placeholder="e.g. Board quarterly, two funders annually" />
            </Field>
            <SelectField label="Q13 — How automated is that reporting?" value={answers.q13_reporting_automation} onChange={v => update('q13_reporting_automation', v)} options={CSA_OPTIONS.q13_reporting_automation} />
          </Section>

          <Section n={5} title="Tools & Capacity" note="→ Tooling + Team Capacity dimensions">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">Q14 — Which tools does the org use today? (check all that apply)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {CSA_TOOL_OPTIONS.map(opt => (
                  <label key={opt.value} className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all text-xs font-medium ${
                    answers.q14_tools.includes(opt.value) ? 'bg-blue-50 border-dssg-blue text-dssg-blue' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>
                    <input
                      type="checkbox"
                      checked={answers.q14_tools.includes(opt.value)}
                      onChange={() => toggleTool(opt.value)}
                      className="accent-[#002D72]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <SelectField label="Q15 — How confident is staff with data work?" value={answers.q15_staff_confidence} onChange={v => update('q15_staff_confidence', v)} options={CSA_OPTIONS.q15_staff_confidence} />
            <SelectField label="Q16 — How quickly can you budget for a new tool?" value={answers.q16_budget_speed} onChange={v => update('q16_budget_speed', v)} options={CSA_OPTIONS.q16_budget_speed} />
          </Section>

          <Section n={6} title="Goals & Readiness" note="Narrative — feeds charter rationale and risks directly">
            <Field label="Q17a — Data wish list: if this works, what do you want in a year?">
              <textarea required value={answers.q17a_wish_list} onChange={e => update('q17a_wish_list', e.target.value)} className={`${inputClass} h-20 resize-none`} />
            </Field>
            <Field label="Q17b — What's your biggest data worry?">
              <textarea required value={answers.q17b_biggest_worry} onChange={e => update('q17b_biggest_worry', e.target.value)} className={`${inputClass} h-20 resize-none`} />
            </Field>
            <Field label="Q18 — What has blocked this kind of work before?">
              <textarea required value={answers.q18_past_blockers} onChange={e => update('q18_past_blockers', e.target.value)} className={`${inputClass} h-20 resize-none`} />
            </Field>
          </Section>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-4 bg-dssg-blue text-white rounded-xl font-bold shadow-lg shadow-blue-900/10 hover:bg-dssg-blue-light active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>Score Maturity & Generate 90-Day Plan <ArrowRight size={16} /></>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function pickAnswers(a: ArchitectAssessmentDoc) {
  return {
    q1_org_context: a.q1_org_context, q2_org_size: a.q2_org_size, q3_poc: a.q3_poc,
    q4_collection_scope: a.q4_collection_scope, q5_data_locations: a.q5_data_locations,
    q6_system_integration: a.q6_system_integration, q7_integration_familiarity: a.q7_integration_familiarity,
    q8_quality_confidence: a.q8_quality_confidence, q9_current_decisions: a.q9_current_decisions,
    q10_wished_decisions: a.q10_wished_decisions, q11_decision_empowerment: a.q11_decision_empowerment,
    q12_reporting_to: a.q12_reporting_to, q13_reporting_automation: a.q13_reporting_automation,
    q14_tools: a.q14_tools, q15_staff_confidence: a.q15_staff_confidence,
    q16_budget_speed: a.q16_budget_speed, q17a_wish_list: a.q17a_wish_list,
    q17b_biggest_worry: a.q17b_biggest_worry, q18_past_blockers: a.q18_past_blockers,
  };
}

const inputClass = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-dssg-blue focus:border-transparent transition-all outline-none text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400 ml-1">{label}</label>
      {children}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { readonly value: string; readonly label: string }[];
}) {
  return (
    <Field label={label}>
      <select required value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
        <option value="" disabled>Choose…</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

function Section({ n, title, note, children }: { n: number; title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="bento-card p-8">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-display font-bold text-dssg-orange text-lg">0{n}</span>
        <h2 className="text-xl font-display font-bold text-dssg-blue">{title}</h2>
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300 mb-6 ml-8">{note}</p>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function HandoffBadge({ label }: { label: string }) {
  return (
    <span className="px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.1em] border bg-slate-50 text-slate-600 border-slate-200">
      {label}
    </span>
  );
}
