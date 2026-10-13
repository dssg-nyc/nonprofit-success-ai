import type { MetricDefinition } from '../../registry';
import type { CalibrationCase, CalibrationResult, EvalCase, EvalReport, GradedRow, GraderResult, MetricSummary } from '../../types';
import type { RunHistoryEntry } from '../history';

export interface RenderInput {
  report: EvalReport;
  rows: GradedRow[];
  /** Fixture cases per metric name, for the note and expected block beside each verdict. */
  cases: Record<string, EvalCase[]>;
  metrics: Record<string, MetricDefinition>;
  /** targets.yaml, parsed. A metric whose `targetsKey` is absent is UNGATED. */
  targets?: Record<string, number>;
  /** Keyed runs, oldest first (`history.ts`) — the trend columns and the Δ beside each rate. */
  history?: RunHistoryEntry[];
  /** This run's judge-vs-label rows (`calibration.jsonl`), for the confusion counts. */
  calibrationRows?: CalibrationResult[];
  /** The hand-labelled set itself (`fixtures/judgeCalibration.jsonl`), for the sample card. */
  calibrationCases?: CalibrationCase[];
  /** Readiness steps that live outside the run: the κ rater sheets on disk, the judge CI job. */
  readiness?: ReadinessFacts;
}

export interface ReadinessFacts {
  /** Rater sheets found under `reports/output/kappa/` (D25); undefined when not checked. */
  kappaSheets?: number;
  /** Whether a workflow runs the judges in CI (J3). */
  judgeCiJob?: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------------------
// Numbers and tones
// ---------------------------------------------------------------------------------------

/** Whole percent, never rounding a miss up to 100% or a hit down to 0%. */
export function pct(rate: number | null): string {
  if (rate === null) return '—';
  if (rate >= 1) return '100%';
  if (rate <= 0) return '0%';
  return `${Math.min(99, Math.max(1, Math.round(rate * 100)))}%`;
}

export type Tone = 'good' | 'warn' | 'bad' | 'none';

/** Green at or above the target (0.9 when ungated), amber down to 0.7, red below. */
export function toneFor(rate: number | null, target?: number): Tone {
  if (rate === null) return 'none';
  const good = target ?? 0.9;
  if (rate >= good) return 'good';
  if (rate >= Math.min(0.7, good)) return 'warn';
  return 'bad';
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// ---------------------------------------------------------------------------------------
// Agents, lanes, gates
// ---------------------------------------------------------------------------------------

/** Agent a metric belongs to: its lower-case name prefix (`scoutRouting` → Scout). */
export function agentOf(metric: string): string {
  const prefix = /^[a-z]+/.exec(metric)?.[0] ?? metric;
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/** What each agent does, in one line, for readers who do not know the roster. */
export const AGENT_ROLES: Record<string, string> = {
  Scout: 'Reads a new intake form and routes it: project type, readiness signal, and whether a human must review.',
  Architect: 'Scores the readiness assessment, then drafts the project charter and 90-day plan.',
  Pulse: 'Watches an active engagement and flags its health.',
  Envoy: 'Drafts partner-facing emails (kickoff, check-in, milestone).',
  Chronicle: 'Drafts the impact story at the end of an engagement.',
};

export type LaneKey = 'heuristic' | 'judge' | 'modelJudge' | 'model';

/** One way a metric is graded: which path produced the output, and how it was checked. */
export interface Lane {
  key: LaneKey;
  path: 'template' | 'model';
  kind: 'exact' | 'judge';
  label: string;
  rate: number | null;
  /** Cases attempted, errored included. */
  n: number;
  errored: number;
  mean: number | null;
  ran: boolean;
}

export const LANE_LABEL: Record<LaneKey, string> = {
  heuristic: 'Fallback · exact match',
  judge: 'Fallback · judge',
  modelJudge: 'Model · judge',
  model: 'Model · exact match',
};

export const PILL_LABEL: Record<LaneKey, string> = {
  heuristic: 'Fallback',
  judge: 'Judge on fallback',
  modelJudge: 'Judge on model',
  model: 'Model',
};

export function lanesFor(def: MetricDefinition, s: MetricSummary, report: EvalReport): Lane[] {
  const lanes: Lane[] = [];
  const lane = (key: LaneKey, rest: Omit<Lane, 'key' | 'label' | 'path' | 'kind'>): Lane => ({
    key,
    label: LANE_LABEL[key],
    path: key === 'heuristic' || key === 'judge' ? 'template' : 'model',
    kind: key === 'heuristic' || key === 'model' ? 'exact' : 'judge',
    ...rest,
  });
  if (def.heuristic) lanes.push(lane('heuristic', { rate: s.heuristicPassRate, n: s.nHeuristic, errored: 0, mean: null, ran: true }));
  if (def.judgeCls) {
    lanes.push(lane('judge', { rate: s.judgePassRate, n: s.nJudge, errored: s.nJudgeErrored, mean: s.judgeMeanScore, ran: report.judgesRan }));
  }
  if (def.judgeCls && def.modelOutput) {
    lanes.push(
      lane('modelJudge', {
        rate: s.modelJudgePassRate,
        n: s.nModelJudge,
        errored: s.nModelJudgeErrored,
        mean: s.modelJudgeMeanScore,
        ran: report.judgesRan && report.modelCallsRan,
      }),
    );
  }
  if (def.model) lanes.push(lane('model', { rate: s.modelPassRate, n: s.nModel, errored: s.nModelErrored, mean: null, ran: report.modelCallsRan }));
  return lanes;
}

/** The gate's view: fallback judge when it ran, heuristic otherwise, null when neither. */
export function effectiveRate(summary: MetricSummary): number | null {
  return summary.judgePassRate !== null ? summary.judgePassRate : summary.heuristicPassRate;
}

/** Which lane the gate reads — mirrors grade.ts `effectivePassRate`. */
export function gatedLaneKey(summary: MetricSummary): LaneKey {
  return summary.judgePassRate !== null ? 'judge' : 'heuristic';
}

export interface Gate {
  kind: 'passed' | 'failed' | 'ungated' | 'unmeasured';
  target?: number;
  detail: string;
}

/** Same decision as grade.ts `checkTargets`, so the page and the CI gate cannot disagree. */
export function gateFor(summary: MetricSummary, def: MetricDefinition, targets: Record<string, number>): Gate {
  const key = def.targetsKey;
  if (!(key in targets)) return { kind: 'ungated', detail: `No threshold for ${key} in targets.yaml yet — reported, not enforced.` };
  const target = targets[key];
  if (summary.nJudgeErrored > 0) {
    return { kind: 'failed', target, detail: `${plural(summary.nJudgeErrored, 'judge call')} errored — the gate cannot certify cases nobody graded.` };
  }
  const rate = effectiveRate(summary);
  if (rate === null) return { kind: 'unmeasured', target, detail: 'Gated, but not measured this run.' };
  return rate >= target
    ? { kind: 'passed', target, detail: `${pct(rate)} meets the ${pct(target)} target.` }
    : { kind: 'failed', target, detail: `${pct(rate)} is below the ${pct(target)} target.` };
}

export const GATE_TEXT: Record<Gate['kind'], string> = {
  passed: 'Gate passed',
  failed: 'Gate failed',
  ungated: 'Ungated',
  unmeasured: 'Gate: not measured',
};

export function gateBadge(gate: Gate): string {
  return `<span class="gate gate-${gate.kind}" title="${escapeHtml(gate.detail)}">${GATE_TEXT[gate.kind]}${
    gate.target !== undefined ? ` <small>≥ ${pct(gate.target)}</small>` : ''
  }</span>`;
}

// ---------------------------------------------------------------------------------------
// Per-metric model
// ---------------------------------------------------------------------------------------

export interface MetricView {
  summary: MetricSummary;
  def: MetricDefinition;
  agent: string;
  lanes: Lane[];
  gate: Gate;
  rows: GradedRow[];
  cases: Map<string, EvalCase>;
}

export function buildViews(input: RenderInput): MetricView[] {
  const targets = input.targets ?? {};
  const views: MetricView[] = [];
  for (const summary of input.report.summaries) {
    const def = input.metrics[summary.metric];
    if (!def) continue;
    views.push({
      summary,
      def,
      agent: agentOf(summary.metric),
      lanes: lanesFor(def, summary, input.report),
      gate: gateFor(summary, def, targets),
      rows: input.rows.filter((r) => r.metric === summary.metric),
      cases: new Map((input.cases[summary.metric] ?? []).map((c) => [c.id, c])),
    });
  }
  return views;
}

export const laneTarget = (view: MetricView, lane: Lane): number | undefined =>
  lane.key === gatedLaneKey(view.summary) ? view.gate.target : undefined;

export const laneTone = (view: MetricView, lane: Lane): Tone => (lane.ran ? toneFor(lane.rate, laneTarget(view, lane)) : 'none');

/** Short value text for a lane: the rate, or why there is none. */
export function laneValue(lane: Lane): string {
  if (!lane.ran) return 'Not evaluated';
  if (lane.rate === null) return lane.errored > 0 ? 'Evaluation error' : 'No cases';
  return pct(lane.rate);
}

/** "10 of 21 cases exactly right" — counts behind a rate, errored cases called out apart. */
export function laneCounts(lane: Lane): string {
  if (!lane.ran) return 'Not evaluated — no model key for this run.';
  const graded = lane.n - lane.errored;
  const passed = lane.rate === null ? 0 : Math.round(lane.rate * graded);
  const verb = lane.kind === 'exact' ? 'exactly right' : 'passed by the judge';
  const parts = [`${passed} of ${graded} ${verb}`];
  if (lane.mean !== null) parts.push(`mean score ${lane.mean.toFixed(2)}`);
  if (lane.errored > 0) parts.push(`${lane.errored} errored (not counted)`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------------------
// Section pattern — tab name, question, lead, callouts
// ---------------------------------------------------------------------------------------

/**
 * Every card asks one question and answers it in its lead: the small label names the tab
 * the card lives on, the heading is the question, the lead carries the answer with its
 * numbers. The reader who stops after the first paragraph still leaves with the answer.
 */
export function sectionHead(id: string, tab: string, question: string, lead = ''): string {
  return `<div class="section-header"><span class="num">${escapeHtml(tab)}</span>
    <h2 id="${escapeHtml(id)}">${escapeHtml(question)}</h2>
    ${lead ? `<p class="lead">${lead}</p>` : ''}</div>`;
}

/** A lighter head for a section nested inside another: same shape as `sectionHead`, an h3 instead of an h2. */
export function subHead(id: string, tab: string, question: string, lead = ''): string {
  return `<div class="section-header sub"><span class="num">${escapeHtml(tab)}</span>
    <h3 id="${escapeHtml(id)}">${escapeHtml(question)}</h3>
    ${lead ? `<p class="lead">${lead}</p>` : ''}</div>`;
}

/** A boxed aside: amber for a caveat the reader must carry, teal for a rule or claim, red for failures, green for an all-clear. */
export function callout(kind: 'amber' | 'teal' | 'red' | 'green', body: string): string {
  return `<aside class="callout ${kind}">${body}</aside>`;
}

/** The one-line scope every run shares: offline, over fixtures, which paths ran. */
export function runScope(report: EvalReport): string {
  const ran = [`fallback`, report.judgesRan ? 'judges' : '', report.modelCallsRan ? 'model path' : ''].filter(Boolean);
  return `offline, ${plural(report.nCases, 'hand-written case')}, ${ran.join(' + ')} — not live traffic`;
}

// ---------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------

/**
 * "ran" alone misled when 0 of 44 calls succeeded (the retired-model run): a path that
 * ran and errored everywhere is reported as such, not as having run.
 */
export function ranLabel(ran: boolean, calls: { n: number; errored: number }): string {
  if (!ran) return '<strong>skipped</strong>';
  if (calls.n === 0) return 'ran';
  const ok = calls.n - calls.errored;
  return ok === 0 ? `<strong>ran, 0 of ${calls.n} succeeded</strong>` : `ran (${ok} of ${calls.n} succeeded)`;
}

/** Models named in the summary, when the run recorded them. */
export function renderModels(report: EvalReport): string {
  const entries = Object.entries(report.models ?? {}).filter(([, v]) => v);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `<span class="kv"><span>${escapeHtml(k)}</span> <code>${escapeHtml(String(v))}</code></span>`).join('');
}

export function renderRunStrip(views: MetricView[], report: EvalReport): string {
  const sum = (f: (s: MetricSummary) => number) => views.reduce((a, v) => a + f(v.summary), 0);
  const judgeCalls = { n: sum((s) => s.nJudge + s.nModelJudge), errored: sum((s) => s.nJudgeErrored + s.nModelJudgeErrored) };
  const modelCalls = { n: sum((s) => s.nModel), errored: sum((s) => s.nModelErrored) };
  return `<div class="run">
    <span class="kv"><span>Run</span> <time datetime="${escapeHtml(report.generatedAt)}">${escapeHtml(fmtTimestamp(report.generatedAt))}</time></span>
    <span class="kv"><span>Cases</span> ${report.nCases}</span>
    <span class="kv"><span>Judges</span> ${ranLabel(report.judgesRan, judgeCalls)}</span>
    <span class="kv"><span>Model path</span> ${ranLabel(report.modelCallsRan, modelCalls)}</span>
    ${renderModels(report)}
  </div>${
    report.judgesRan && report.modelCallsRan
      ? ''
      : '<p class="hint">Part of this run was skipped. Set <code>OPENAI_API_KEY</code> (judges) and <code>GOOGLE_GENERATIVE_AI_API_KEY</code> (model path), then rerun <code>npm run eval:grade</code>.</p>'
  }`;
}

/** Labelled outputs a judge needs before its agreement is read as evidence rather than a hint. */
export const CALIBRATION_FLOOR = 10;

/** Plain name for a metric: "Routing accuracy", with `scoutRouting` kept beside it for the code. */
export const nameOf = (view: MetricView): string => view.def.displayName;

/** Link to a metric's detail by its plain name, the code name in small print. */
export function metricLink(view: MetricView): string {
  const metric = view.summary.metric;
  return `<a href="#${escapeHtml(metric)}">${escapeHtml(nameOf(view))}</a> <code class="mname">${escapeHtml(metric)}</code>`;
}

/**
 * The template lane the gate reads and the model lane graded the same way: exact match
 * beside exact match, judge beside judge. A metric has at most one of each.
 */
export function pairedLanes(view: MetricView): { template?: Lane; model?: Lane } {
  const template = view.lanes.find((l) => l.key === gatedLaneKey(view.summary)) ?? view.lanes.find((l) => l.path === 'template');
  const twin: LaneKey = template?.kind === 'judge' ? 'modelJudge' : 'model';
  return { template, model: view.lanes.find((l) => l.key === twin) };
}

/** "25/29" — passed over graded, the counts a rate is made of. */
export function passedOf(lane: Lane): string {
  const graded = lane.n - lane.errored;
  const passed = lane.rate === null ? 0 : Math.round(lane.rate * graded);
  return `${passed}/${graded}`;
}


/** Agreement with hand labels a judge needs before its rate is trusted (eval-harness.md, keyed judge run). */
export const JUDGE_TRUST_AGREEMENT = 0.8;

/** Hand-written cases a metric needs before its rate is gated (eval-harness.md, keyed judge run). */
export const FIXTURE_FLOOR = 20;

export const caseAnchor = (metric: string, caseId: string): string => `case-${metric}-${caseId}`;

/** The lane a grade belongs to: heuristic, model, or the judge over the template or model output. */
export function laneOfGrade(g: GraderResult): LaneKey {
  if (g.grader === 'judge') return (g.source ?? 'template') === 'model' ? 'modelJudge' : 'judge';
  return g.grader;
}


/** What a tab opens with: the claim the run supports and the caveat that bounds it. */
export function frame(claim: string, caveat: string): string {
  return `<aside class="callout teal frame"><p><strong>Claim.</strong> ${claim}</p><p><strong>Caveat.</strong> ${caveat}</p></aside>`;
}

/** Graded verdicts behind a lane's rate in a summary — the weight when lanes are averaged. */
export function laneGraded(s: MetricSummary, key: LaneKey): number {
  switch (key) {
    case 'heuristic':
      return s.nHeuristic;
    case 'judge':
      return s.nJudge - s.nJudgeErrored;
    case 'model':
      return s.nModel - s.nModelErrored;
    case 'modelJudge':
      return s.nModelJudge - s.nModelJudgeErrored;
  }
}
