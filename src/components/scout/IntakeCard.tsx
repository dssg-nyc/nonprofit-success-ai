import React from 'react';
import { Flag, Mail, Clock, ExternalLink, Landmark, MessageSquareText, Sparkles } from 'lucide-react';
import { ScoutIntake, PRIMARY_NEED_OPTIONS } from '../../types';
import type { ScoutRegistryLookup } from '../../types';
import { relativeTime } from './review';

/**
 * The parts of an intake card that every admin screen shows the same way — who applied,
 * every answer on the form, and what Scout made of it — so the review queue and the
 * decisions page cannot drift in what they tell a reviewer. The decision buttons and
 * the review outcome are the caller's: they differ per screen.
 */

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

export function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-[0.1em] border ${className}`}>
      {label}
    </span>
  );
}

/**
 * What each readiness score means and which answer it is scored from — so a reviewer can
 * check the pips against the intake instead of taking them on trust. Definitions follow
 * `scoreReadiness()` in agents/scout/routing.ts (the spec's foothold wording differs; see
 * scout.md "Open: score definitions vs code").
 */
const READINESS: { key: 'poc_score' | 'clarity_score' | 'foothold_score'; label: string; means: string; from: (i: ScoutIntake) => string }[] = [
  { key: 'poc_score', label: 'POC', means: 'A named contact with a role who can unblock work', from: i => (i.contact_name_role ? `${i.contact_name_role} · ${i.timeline}` : i.timeline) },
  { key: 'clarity_score', label: 'Clarity', means: 'How well-formed their own ask is', from: i => i.problem_description },
  { key: 'foothold_score', label: 'Foothold', means: 'Real systems and data to build on', from: i => i.current_systems },
];

function ReadinessRow({ label, means, from, score }: { label: string; means: string; from: string; score: number }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex gap-0.5 mt-1 shrink-0">
        {[1, 2, 3].map(n => (
          <div key={n} className={`w-2.5 h-2.5 rounded-full ${n <= score ? 'bg-dssg-blue' : 'bg-slate-200'}`} />
        ))}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {label} <span className="text-slate-300">{score}/3</span>
          <span className="normal-case tracking-normal font-medium text-slate-400"> · {means}</span>
        </p>
        <p className="text-[11px] text-slate-500 truncate" title={from}>from: “{from}”</p>
      </div>
    </div>
  );
}

function Answer({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300">{label}</p>
      <p className="text-xs text-slate-600 leading-relaxed">{value}</p>
    </div>
  );
}

/** One line for a lookup that produced no record. `skipped` shows nothing: nothing was looked up. */
const REGISTRY_STATE: Partial<Record<ScoutRegistryLookup, string>> = {
  not_found: 'No IRS record matched the org name — verify nonprofit status before approving.',
  ambiguous: 'Several IRS records could match the org name; none was taken. Check ProPublica by hand.',
  unavailable: 'The IRS registry lookup was unavailable when this intake was filed.',
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * The applicant's IRS registry record (ProPublica), fetched server-side when the intake
 * was filed (0011). Shown beside what they told us so a reviewer can see the match — the
 * name and EIN ProPublica returned, not the name on the form — and the facts Scout's
 * flags refer to. The record never moves a score or a tier; it informs the reviewer.
 */
function RegistryBlock({ intake }: { intake: ScoutIntake }) {
  const lookup = intake.registryLookup;
  if (!lookup || lookup === 'skipped') return null;
  const record = lookup === 'matched' ? intake.registry : null;
  return (
    <div className="pt-3 border-t border-slate-50 space-y-1.5">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300">
        <Landmark size={10} /> IRS registry
      </p>
      {record ? (
        <>
          <p className="text-xs text-slate-600 leading-relaxed">
            <span className="font-semibold">{record.name}</span>
            <span className="text-slate-400"> · EIN {record.ein.slice(0, 2)}-{record.ein.slice(2)}</span>
            {(record.city || record.state) && (
              <span className="text-slate-400"> · {[record.city, record.state].filter(Boolean).join(', ')}</span>
            )}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <RegistryFact label="Status" value={record.subsectionCode !== null ? `501(c)(${record.subsectionCode})` : 'unknown'} />
            <RegistryFact label="NTEE" value={record.nteeCode ?? '—'} />
            <RegistryFact label="Revenue" value={record.revenue !== null ? usd.format(record.revenue) : 'not reported'} />
            <RegistryFact label="Assets" value={record.assets !== null ? usd.format(record.assets) : 'not reported'} />
            <RegistryFact label="Newest filing" value={record.latestFilingYear !== null ? String(record.latestFilingYear) : 'none on record'} />
          </dl>
          <a
            href={`https://projects.propublica.org/nonprofits/organizations/${record.ein}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-dssg-blue hover:underline"
          >
            View on ProPublica <ExternalLink size={10} />
          </a>
        </>
      ) : (
        <p className="text-xs text-slate-500 italic leading-relaxed">{REGISTRY_STATE[lookup]}</p>
      )}
    </div>
  );
}

function RegistryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5 min-w-0">
      <dt className="text-slate-400 shrink-0">{label}</dt>
      <dd className="truncate" title={value}>{value}</dd>
    </div>
  );
}

function primaryNeedLabel(intake: ScoutIntake): string {
  const label = PRIMARY_NEED_OPTIONS.find(o => o.value === intake.primary_need)?.label ?? intake.primary_need;
  return intake.primary_need_other ? `${label}: ${intake.primary_need_other}` : label;
}

/** Org, contact, when — with whatever the screen wants on the right (a tier, an outcome). */
export function IntakeHeader({ intake, right }: { intake: ScoutIntake; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
      <div className="min-w-0">
        <h3 className="text-xl font-display font-bold text-dssg-blue leading-tight">{intake.org_name}</h3>
        {/* A live row has no contact: it is the Salesforce Contact salesforceContactId names (NPS #28). */}
        {intake.contact_name_role && <p className="text-sm font-semibold text-slate-700 mt-1">{intake.contact_name_role}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400 mt-1">
          {intake.contact_email && <span className="flex items-center gap-1.5 text-[11px] font-medium"><Mail size={11} />{intake.contact_email}</span>}
          <span className="flex items-center gap-1.5 text-[11px] font-medium"><Clock size={11} />applied {relativeTime(intake.submittedAt?.seconds)}</span>
        </div>
      </div>
      {right && <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">{right}</div>}
    </div>
  );
}

/** Every answer on the form beside Scout's recommendation and the readiness it was scored from. */
export function IntakeBody({ intake }: { intake: ScoutIntake }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-3 lg:border-r lg:border-slate-100 lg:pr-6">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <MessageSquareText size={12} /> What they told us
        </p>
        <Answer label="What they do" value={intake.mission} />
        <Answer label="Who they serve" value={intake.scale} />
        <Answer label="What brings them to DSSG" value={primaryNeedLabel(intake)} />
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300">The problem, in their words</p>
          <p className="text-xs text-slate-600 leading-relaxed italic">“{intake.problem_description}”</p>
        </div>
        <Answer label="Data and systems today" value={intake.current_systems} />
        <Answer label="Timeline" value={intake.timeline} />
        <Answer label="How they heard of DSSG" value={intake.referral_source} />
        <RegistryBlock intake={intake} />
      </div>

      <div className="space-y-4">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <Sparkles size={12} /> Scout's recommendation
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge label={intake.bucket ?? 'Needs manual bucket'} className={intake.bucket ? 'bg-dssg-blue text-white border-dssg-blue' : 'bg-rose-50 text-rose-600 border-rose-100'} />
          {intake.confidence && <Badge label={`${intake.confidence} confidence`} className={CONFIDENCE_COLOR[intake.confidence]} />}
          <Badge label={intake.composite_signal} className={SIGNAL_COLOR[intake.composite_signal]} />
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">{intake.rationale}</p>

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

        <div className="space-y-2.5 pt-3 border-t border-slate-50">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300">Readiness · {intake.composite_signal}</p>
          {READINESS.map(r => (
            <ReadinessRow key={r.key} label={r.label} means={r.means} from={r.from(intake)} score={intake[r.key]} />
          ))}
        </div>
      </div>
    </div>
  );
}
