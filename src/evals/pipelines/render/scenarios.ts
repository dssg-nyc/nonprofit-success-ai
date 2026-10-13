/**
 * The scenario explorer on an agent tab. One entry per fixture case, with every metric's
 * verdict on it together: the intake, what the fixture expected, what the agent produced
 * and how each check graded it. Failing and errored scenarios carry their body inline;
 * passing ones build it in the browser from the blob (`cases.ts`). The default filter is
 * "needs attention", so a clean run shows its all-clear line and a button to open the rest.
 */

import type { EvalCase, GradedRow, GraderResult } from '../../types';
import { blobKey, caseState, compactGrade, pill, renderExpected, renderGradeDetail, renderIntake, STATE_ORDER } from './cases';
import type { CaseBlob, CaseState } from './cases';
import { checkName, checkRates } from './checks';
import { firstSentence } from './actions';
import { caseAnchor, escapeHtml, laneOfGrade, nameOf, plural } from './views';
import type { LaneKey, MetricView } from './views';

/** One metric's verdicts on a scenario. */
interface Entry {
  view: MetricView;
  row: GradedRow;
  byLane: Map<LaneKey, GraderResult>;
}

export interface Scenario {
  id: string;
  evalCase: EvalCase | undefined;
  entries: Entry[];
  state: CaseState;
  group: string;
}

const PULSE_STATUS: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', stalled: 'Stalled' };
const READINESS: Record<string, string> = { ready: 'Ready', thin: 'Thin', not_ready: 'Not ready' };

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/** The label a reader groups scenarios by: what the fixture expects, in the agent's own terms. */
export function groupOf(agent: string, evalCase: EvalCase | undefined): string {
  if (!evalCase) return '';
  const { expected, input } = evalCase;
  switch (agent) {
    case 'Scout':
      return [str(expected.bucket), str(expected.composite_signal)].filter(Boolean).join(' · ');
    case 'Architect':
      return str(expected.shape) || (expected.compositeLevel !== undefined ? `Maturity ${str(expected.compositeLevel)}` : '');
    case 'Pulse':
      return PULSE_STATUS[str(expected.status)] ?? str(expected.status);
    case 'Envoy':
      return str(input.occasion);
    case 'Chronicle':
      return READINESS[str(expected.readiness)] ?? str(expected.readiness);
    default:
      return '';
  }
}

/** Worst verdict across the scenario's metrics: a failure anywhere, then an error, then pass. */
function worstState(entries: Entry[]): CaseState {
  return entries.map((e) => caseState(e.row)).sort((a, b) => STATE_ORDER[a] - STATE_ORDER[b])[0] ?? 'none';
}

/** An agent's graded rows regrouped by fixture case, every metric's verdict beside the others. */
export function buildScenarios(agent: string, views: MetricView[]): Scenario[] {
  const byId = new Map<string, Scenario>();
  for (const view of views) {
    for (const row of view.rows) {
      const found = byId.get(row.caseId);
      const entry: Entry = { view, row, byLane: new Map(row.grades.map((g) => [laneOfGrade(g), g])) };
      if (found) {
        found.entries.push(entry);
        found.evalCase ??= view.cases.get(row.caseId);
      } else {
        byId.set(row.caseId, { id: row.caseId, evalCase: view.cases.get(row.caseId), entries: [entry], state: 'none', group: '' });
      }
    }
  }
  const out = [...byId.values()].map((s) => ({ ...s, state: worstState(s.entries), group: groupOf(agent, s.evalCase) }));
  return out.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
}

/** Lanes a scenario lost or errored on and the checks it lost, across its metrics — the filter's data attributes. */
function lostOn(entries: Entry[]): { lanes: string[]; dims: string[] } {
  const lanes = new Set<string>();
  const dims = new Set<string>();
  for (const { view, byLane } of entries) {
    for (const lane of view.lanes) {
      const g = byLane.get(lane.key);
      if (!g) continue;
      if (g.status === 'errored' || !g.isCorrect) lanes.add(lane.key);
      if (g.status === 'graded') for (const [d, v] of Object.entries(g.dimensions)) if (v < 1) dims.add(d);
    }
  }
  return { lanes: [...lanes], dims: [...dims] };
}

/** The pills of one metric; named when the scenario carries more than one metric. */
function pillGroup(entry: Entry, named: boolean): string {
  const pills = entry.view.lanes.map((l) => pill(l, entry.byLane.get(l.key))).join('');
  return named ? `<span class="pill-group"><small>${escapeHtml(nameOf(entry.view))}</small>${pills}</span>` : pills;
}

/** The grade blocks of one metric, wrapped and named when the scenario has several. */
function metricBlock(entry: Entry, named: boolean, scenarioId: string, first: boolean, blob?: CaseBlob): string {
  const { view, byLane } = entry;
  const prose = Boolean(view.def.judgeCls);
  const grades = view.lanes.map((l) => renderGradeDetail(l, byLane.get(l.key), blob?.outputs, prose)).join('');
  if (!named) return grades;
  const anchor = first ? '' : ` id="${escapeHtml(caseAnchor(view.summary.metric, scenarioId))}"`;
  return `<div class="metric-block"${anchor}><h4 class="mb-h">${escapeHtml(nameOf(view))}</h4>${grades}</div>`;
}

export function renderScenario(scenario: Scenario, blob?: CaseBlob): string {
  const { id, evalCase, entries, state, group } = scenario;
  const named = entries.length > 1;
  const first = entries[0];
  if (!first) return '';
  const note = evalCase?.note ?? '';
  const title = note ? firstSentence(note) : id;
  const rest = note.startsWith(title) ? note.slice(title.length).trim() : note;
  const lost = lostOn(entries);
  const keys = entries.map((e) => blobKey(e.view.summary.metric, id));
  let body: string;
  let lazy = '';
  if (blob && state === 'pass') {
    for (const e of entries) {
      blob.metrics[e.view.summary.metric] = nameOf(e.view);
      const compact = { g: e.view.lanes.map((l) => compactGrade(l, e.byLane.get(l.key), blob.outputs)) };
      const expected = Object.entries(e.view.cases.get(id)?.expected ?? evalCase?.expected ?? {});
      blob.cases[blobKey(e.view.summary.metric, id)] = expected.length ? { e: blob.expected.add(expected.map(([k, v]) => [k, str(v)])), ...compact } : compact;
    }
    const inputs = Object.entries(evalCase?.input ?? {});
    if (inputs.length) lazy += ` data-i="${blob.inputs.add(inputs.map(([k, v]) => [k, str(v)]))}"`;
    // Every `#case-<metric>-<id>` resolves even before the body is built: an empty anchor per further metric.
    body = entries
      .slice(1)
      .map((e) => `<span class="anchor" id="${escapeHtml(caseAnchor(e.view.summary.metric, id))}"></span>`)
      .join('');
  } else {
    body = `<div class="case-body">${renderIntake(evalCase)}${renderExpected(evalCase)}${entries.map((e, i) => metricBlock(e, named, id, i === 0, blob)).join('')}</div>`;
  }
  const meta = [`<code>${escapeHtml(id)}</code>`, group ? `<span class="group-tag">${escapeHtml(group)}</span>` : '', rest ? escapeHtml(rest) : ''].filter(Boolean).join(' · ');
  return `<details class="case scenario s-${state}" id="${escapeHtml(caseAnchor(first.view.summary.metric, id))}" data-state="${state}" data-search="${escapeHtml(id.toLowerCase())}" data-keys="${escapeHtml(keys.join(' '))}"${
    group ? ` data-group="${escapeHtml(group)}"` : ''
  }${lost.lanes.length ? ` data-lanes="${escapeHtml(lost.lanes.join(' '))}"` : ''}${lost.dims.length ? ` data-dims="${escapeHtml(lost.dims.join(' '))}"` : ''}${lazy}><summary><span class="case-id"><b class="title">${escapeHtml(title)}</b><span class="note">${meta}</span></span><span class="pills">${entries.map((e) => pillGroup(e, named)).join('')}</span></summary>${body}</details>
`;
}

/** Lanes that did not run on this agent, named for the all-clear line. */
export function skippedLanes(views: MetricView[]): string[] {
  const out: string[] = [];
  const judges = views.filter((v) => v.lanes.some((l) => l.kind === 'judge' && !l.ran)).map((v) => nameOf(v));
  if (judges.length) out.push(`${judges.join(', ')} judge${judges.length === 1 ? '' : 's'} skipped`);
  if (views.some((v) => v.lanes.some((l) => l.path === 'model' && !l.ran))) out.push('model path skipped');
  return out;
}

/** One filter row per tab: verdict chips, group, the lane and check a scenario lost on, free text. */
export function renderFilterBar(views: MetricView[], scenarios: Scenario[]): string {
  const lanes = new Map<LaneKey, string>();
  const dims = new Set<string>();
  for (const v of views) {
    for (const l of v.lanes) lanes.set(l.key, l.label);
    for (const d of checkRates(v).keys()) dims.add(d);
  }
  const groups = [...new Set(scenarios.map((s) => s.group).filter(Boolean))].sort();
  const chip = (key: string, label: string) => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${key === 'attention'}">${label}</button>`;
  const opt = (value: string, label: string) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  return `<div class="filter-bar" data-filter-bar>
    <div class="chips">${chip('attention', 'Needs attention')}${chip('all', 'All')}${chip('fail', 'Failing')}${chip('errored', 'Errored')}${chip('pass', 'Passing')}</div>
    ${groups.length ? `<label>Group <select data-group><option value="">any</option>${groups.map((g) => opt(g, g)).join('')}</select></label>` : ''}
    <label>Lost on <select data-lane><option value="">any lane</option>${[...lanes].map(([k, l]) => opt(k, l)).join('')}</select></label>
    ${dims.size ? `<label>Check <select data-dim><option value="">any</option>${[...dims].sort().map((d) => opt(d, checkName(d))).join('')}</select></label>` : ''}
    <input type="search" placeholder="Find a scenario" aria-label="Find a scenario">
    <span class="shown" data-shown></span>
  </div>`;
}

/** The explorer: count line, filter bar, the all-clear line and every scenario, failing first. */
export function renderScenarios(agent: string, views: MetricView[], blob?: CaseBlob): string {
  const scenarios = buildScenarios(agent, views);
  const slug = escapeHtml(agent.toLowerCase());
  if (scenarios.length === 0) return `<h3 id="cases-${slug}">Scenarios</h3><p class="muted">No cases graded.</p>`;
  const failing = scenarios.filter((s) => s.state === 'fail').length;
  const errored = scenarios.filter((s) => s.state === 'errored').length;
  const skipped = skippedLanes(views);
  const allClear = `No failures in completed checks.${skipped.length ? ` ${skipped.map((s) => s[0].toUpperCase() + s.slice(1)).join('; ')}.` : ''}`;
  return `<h3 id="cases-${slug}">Scenarios</h3>
    <p class="muted">Each scenario is one fixture case with every check's verdict on it. Open one for the intake, what the fixture expected, what the agent produced and how each check graded it.</p>
    ${renderFilterBar(views, scenarios)}
    <div class="cases" data-cases>
      <div class="cases-bar"><h4>${plural(scenarios.length, 'scenario')}${failing ? ` · <span class="t-bad">${failing} with a failing verdict</span>` : ''}${errored ? ` · <span class="t-err">${errored} errored</span>` : ''}</h4></div>
      <p class="all-clear" data-all-clear hidden><span class="t-good">${allClear}</span> <button type="button" class="chip" data-filter="all">Explore all ${plural(scenarios.length, 'scenario')}</button></p>
      <div class="case-list">${scenarios.map((s) => renderScenario(s, blob)).join('')}</div>
      <p class="muted no-match" hidden>No scenarios match.</p>
    </div>`;
}
