/**
 * What an agent produced, laid out as a reader would see it in the portal: a charter with
 * its 90-day timeline, an email with its subject line, a story with its evidence, a
 * routing decision with its rationale. An output of any other shape is shown as JSON.
 * Also the readable labels for fixture input and expected fields.
 */

import { escapeHtml } from './views';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? escapeHtml(v) : v === undefined || v === null ? '' : escapeHtml(JSON.stringify(v)));
const list = (v: unknown): string => (Array.isArray(v) && v.length ? `<ul>${v.map((x) => `<li>${text(x)}</li>`).join('')}</ul>` : '');
const section = (title: string, body: string): string => (body ? `<h6>${title}</h6>${body}` : '');

/** Readable names for fixture input fields; an unknown key is humanised. */
export const INPUT_LABEL: Record<string, string> = {
  scale: 'Scale',
  primary_need: 'Primary need',
  problem_description: 'Problem',
  current_systems: 'Current systems',
  contact_name_role: 'Contact',
  timeline: 'Timeline',
  answers: 'Assessment answers',
  scoutBucket: 'Scout project type',
  orgName: 'Organization',
  bucket: 'Project type',
  maturity: 'Maturity',
  q1_org_context: 'Organization context',
  q9_current_decisions: 'Decisions made today',
  q10_wished_decisions: 'Decisions wished for',
  q17a_wish_list: 'Wish list',
  q17b_biggest_worry: 'Biggest worry',
  q18_past_blockers: 'Past blockers',
  engagementId: 'Engagement',
  stage: 'Stage',
  daysSinceLastEvent: 'Days since last event',
  daysInStage: 'Days in stage',
  lastEventWasBlocker: 'Last event was a blocker',
  hasPlan: 'Has a plan',
  occasion: 'Occasion',
  planTitle: 'Plan title',
  cadence: 'Cadence',
  status: 'Status',
  eventCount: 'Events logged',
  objectives: 'Objectives',
  successCriteria: 'Success criteria',
};

/** Readable names for fixture expected fields. */
export const EXPECTED_LABEL: Record<string, string> = {
  bucket: 'Project type',
  composite_signal: 'Readiness signal',
  hitlTier: 'Human review tier',
  compositeLevel: 'Maturity level',
  overrideApplied: 'Override applied',
  flaggedDimensions: 'Flagged dimensions',
  remediationOnly: 'Remediation only',
  crossCheckFlag: 'Cross-check flag',
  shape: 'Plan shape',
  requiredWorkstreams: 'Required workstreams',
  deliverable: 'Deliverable',
  phase2Note: 'Phase 2 note',
  mustNotPromise: 'Must not promise',
  status: 'Status',
  reasonContains: 'Reason mentions',
  mentionsCadence: 'Mentions the cadence',
  readiness: 'Readiness',
};

const humanise = (key: string): string => key.replace(/^q\d+[a-z]?_/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export const inputLabel = (key: string): string => INPUT_LABEL[key] ?? humanise(key);
export const expectedLabel = (key: string): string => EXPECTED_LABEL[key] ?? humanise(key);

/** A workstream list, whether the entries are names or `{name, required, description}` objects. */
function workstreamList(v: unknown): string {
  return Array.isArray(v) && v.length
    ? `<ul>${v.map((w: unknown) => (isRec(w) ? `<li><b>${text(w.name)}</b>${w.required ? ' <span class="pill absent">required</span>' : ''}${w.description ? ` — ${text(w.description)}` : ''}</li>` : `<li>${text(w)}</li>`)).join('')}</ul>`
    : '';
}

function charter(c: Rec, plan: Rec | undefined): string {
  const workstreams = workstreamList(c.workstreams);
  const phases = plan && Array.isArray(plan.phases) && plan.phases.length
    ? `<ol class="timeline">${plan.phases
        .map((p: unknown) => (isRec(p) ? `<li><span class="window">${text(p.window)}</span><b>${text(p.title)}</b>${list(p.milestones)}</li>` : `<li>${text(p)}</li>`))
        .join('')}</ol>`
    : '';
  return `<div class="artifact charter"><h5>${text(c.title) || 'Charter'}</h5>${c.background ? `<p>${text(c.background)}</p>` : ''}${c.scopeStatement ? `<p><em>${text(c.scopeStatement)}</em></p>` : ''}${section('Objectives', list(c.objectives))}${section('Workstreams', workstreams)}${section('Risks', list(c.risks))}${section('Success criteria', list(c.successCriteria))}${c.cadence ? `<p class="muted">Cadence: ${text(c.cadence)}</p>` : ''}</div>${
    plan
      ? `<div class="artifact plan"><h5>${text(plan.headline) || '90-day plan'}${plan.shape ? ` <span class="muted">· ${text(plan.shape)}</span>` : ''}</h5>${section('Timeline', phases)}${section('Workstreams', workstreamList(plan.workstreams))}</div>`
      : ''
  }`;
}

function email(o: Rec): string {
  const meta = [o.occasion ? `occasion: ${text(o.occasion)}` : '', o.hitlTier ? `review tier ${text(o.hitlTier)}` : ''].filter(Boolean).join(' · ');
  return `<div class="artifact email">${meta ? `<p class="muted">${meta}</p>` : ''}<p class="subject"><b>Subject:</b> ${text(o.subject)}</p><pre class="prose">${text(o.body)}</pre></div>`;
}

function story(o: Rec): string {
  const meta = [o.readiness ? `readiness: ${text(o.readiness)}` : '', o.hitlTier ? `review tier ${text(o.hitlTier)}` : ''].filter(Boolean).join(' · ');
  const narrative = typeof o.narrative === 'string' && o.narrative.trim() ? `<p class="prose">${text(o.narrative)}</p>` : '<p class="muted">No story written.</p>';
  return `<div class="artifact story">${meta ? `<p class="muted">${meta}</p>` : ''}${o.headline ? `<h5>${text(o.headline)}</h5>` : ''}${narrative}${section('Outcomes', list(o.outcomes))}${section('What helped', list(o.successFactors))}${section('What got in the way', list(o.failureFactors))}</div>`;
}

function routing(o: Rec): string {
  const facts: Array<[string, unknown]> = [
    ['Project type', o.bucket],
    ['Readiness signal', o.composite_signal],
    ['Human review tier', o.hitlTier],
    ['Confidence', o.confidence],
    ['Flags', Array.isArray(o.flags) && o.flags.length ? o.flags.join(', ') : undefined],
  ];
  return `<div class="artifact routing"><dl>${facts
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<dt>${k}</dt><dd>${text(v)}</dd>`)
    .join('')}</dl>${o.rationale ? `<p class="prose">${text(o.rationale)}</p>` : ''}</div>`;
}

/** The output as a reader sees it, or null when its shape is not one the portal shows. */
export function renderArtifact(output: unknown): string | null {
  if (!isRec(output)) return null;
  if (isRec(output.charter)) return charter(output.charter, isRec(output.plan) ? output.plan : undefined);
  if (typeof output.subject === 'string' && typeof output.body === 'string') return email(output);
  if ('narrative' in output && 'readiness' in output) return story(output);
  if (typeof output.bucket === 'string' && 'rationale' in output) return routing(output);
  return null;
}
