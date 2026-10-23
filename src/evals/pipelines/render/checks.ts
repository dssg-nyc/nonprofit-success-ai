/**
 * The checks behind a metric: the fields an exact match compares or the dimensions a
 * judge scores, read from the summary when the grader wrote them and recomputed from the
 * graded rows otherwise. Each check id has a readable name; the raw id stays available
 * under a technical disclosure. One visual per metric: compact rows when every check
 * holds on every path, the grouped bar chart when something fails.
 */

import { groupedBars, legend } from './charts';
import type { BarGroup, BarSeries } from './charts';
import { escapeHtml, laneOfGrade, nameOf, pct } from './views';
import type { MetricView } from './views';

export interface CheckCell {
  passed: number;
  n: number;
}

export type PathCells = Record<'template' | 'model', CheckCell>;

/** Readable names for the check ids graders emit; an unknown id falls back to itself. */
export const CHECK_NAME: Record<string, string> = {
  // Scout routing
  bucketMatch: 'Project type',
  signalMatch: 'Readiness',
  tierMatch: 'Human review tier',
  // Architect scoring
  levelMatch: 'Maturity level',
  overrideMatch: 'Override applied',
  flagsMatch: 'Flagged dimensions',
  remediationMatch: 'Remediation only',
  crossCheckMatch: 'Cross-check flag',
  scoresMatch: 'Dimension scores',
  // Pulse
  statusMatch: 'Health status',
  reasonMatch: 'Reason text',
  // Architect plan structure
  shapeMatch: 'Plan shape',
  phasesValid: 'Three phases',
  requiredMatch: 'Required workstreams',
  deliverableMatch: 'Deliverable',
  phase2Match: 'Phase 2 note',
  risksValid: 'Risks listed',
  schemaValid: 'Valid shape',
  objectivesMatch: 'Objectives',
  workstreamsAgree: 'Charter and plan agree',
  // Envoy structure
  cadence: 'States the cadence',
  concerns: 'States the concerns',
  consent: 'Consent ask',
  echoesInput: 'Echoes its input',
  namesOrg: 'Names the partner',
  nonEmpty: 'Has a body',
  tierL3: 'Human review tier L3',
  // Chronicle readiness
  readiness: 'Readiness',
  hasStory: 'Has a story',
  writesNothing: 'Writes nothing when not ready',
  provisional: 'Provisional when thin',
  noFabrication: 'No invented facts',
  outcomesEmpty: 'Claims no outcome',
  objectiveLowered: 'Objective stated as intent',
  criteriaAsDefinition: 'Criteria as a definition',
  // Grounding lints
  noBannedPhrase: 'No stock phrase',
  noScoreArithmetic: 'No rubric arithmetic',
  criteriaMatchDeliverable: 'Criteria match the deliverable',
  requiredProseOnlyWhenFlagged: 'Required work only when flagged',
  completedNotBeginning: 'Completed, not beginning',
  thinProvisionalEarly: 'Provisional said early',
  notReadyIsEmpty: 'Empty when not ready',
  outcomesTraceToInput: 'Outcomes trace to the record',
  thinClaimsNoOutcome: 'Thin record claims no outcome',
  thinIsProvisional: 'Thin record reads as provisional',
  noInventedRhythm: 'No invented rhythm',
  noProposedCause: 'No invented cause',
  signOff: 'Signs off as the team',
  criteriaNameOnlyFlagged: 'Criteria name only flagged work',
  criteriaPromiseNoFunders: 'No funder promise',
  criteriaPromiseNoLevel: 'No maturity-level promise',
  hasWorkstreams: 'Has workstreams',
  requiredTraceToFlags: 'Required work traces to a flag',
  // Judge rubric dimensions
  grounded: 'Grounded',
  accurate: 'Accurate',
  clear: 'Clear',
  consistent: 'Consistent',
  proportionate: 'Proportionate',
  appropriate: 'Fits the occasion',
};

export const checkName = (id: string): string => CHECK_NAME[id] ?? id;

/** Per metric → per check (field or rubric dimension) → per path, the pass count over graded verdicts. */
export function checkRates(view: MetricView): Map<string, PathCells> {
  const out = new Map<string, PathCells>();
  const laneByKey = new Map(view.lanes.map((l) => [l.key, l]));
  for (const row of view.rows) {
    for (const g of row.grades) {
      if (g.status !== 'graded') continue;
      const lane = laneByKey.get(laneOfGrade(g));
      if (!lane) continue;
      for (const [dim, v] of Object.entries(g.dimensions)) {
        const cell = out.get(dim) ?? { template: { passed: 0, n: 0 }, model: { passed: 0, n: 0 } };
        cell[lane.path].n += 1;
        if (v >= 1) cell[lane.path].passed += 1;
        out.set(dim, cell);
      }
    }
  }
  return out;
}

const isCell = (x: unknown): x is { passed: number; graded: number } =>
  typeof x === 'object' && x !== null && typeof (x as { passed?: unknown }).passed === 'number' && typeof (x as { graded?: unknown }).graded === 'number';

/**
 * Per-dimension counts from the summary when a later grader wrote them (`dimensions`,
 * keyed by dimension then lane or path); null on a run that predates them, and then the
 * rates come from the graded rows instead, so an old run still renders.
 */
export function summaryDimensions(view: MetricView): Map<string, PathCells> | null {
  const dims = (view.summary as { dimensions?: unknown }).dimensions;
  if (!dims || typeof dims !== 'object') return null;
  const out = new Map<string, PathCells>();
  // Keyed lane -> dimension -> { passed, graded }.
  for (const [lane, byDim] of Object.entries(dims as Record<string, unknown>)) {
    if (!byDim || typeof byDim !== 'object') return null;
    const path = lane === 'heuristic' || lane === 'judge' ? 'template' : 'model';
    for (const [dim, cell] of Object.entries(byDim as Record<string, unknown>)) {
      if (!isCell(cell)) return null;
      const cells = out.get(dim) ?? { template: { passed: 0, n: 0 }, model: { passed: 0, n: 0 } };
      cells[path].passed += cell.passed;
      cells[path].n += cell.graded;
      out.set(dim, cells);
    }
  }
  return out.size ? out : null;
}

/** The check rates a metric renders from: the summary's when written, the rows' otherwise. */
export const pathRates = (view: MetricView): Map<string, PathCells> => summaryDimensions(view) ?? checkRates(view);

const PATHS = ['template', 'model'] as const;
const pathLabel = (p: 'template' | 'model'): string => (p === 'template' ? 'Fallback' : 'Model');

/** Every check passed on every path that graded it. */
export function allChecksHold(rates: Map<string, PathCells>): boolean {
  return [...rates.values()].every((c) => PATHS.every((p) => c[p].n === 0 || c[p].passed === c[p].n));
}

/** Dimension × path bars for one metric, weakest dimension first, with a one-line reading. */
export function renderDimChart(view: MetricView): string {
  const rates = pathRates(view);
  if (rates.size === 0) return '';
  const paths = PATHS.filter((p) => [...rates.values()].some((c) => c[p].n > 0));
  if (paths.length === 0) return '';
  const series: BarSeries[] = paths.map((p) => ({ key: p, label: pathLabel(p) }));
  const worst = (c: PathCells) => Math.min(...paths.filter((p) => c[p].n > 0).map((p) => c[p].passed / c[p].n));
  const sorted = [...rates.entries()].sort((a, b) => worst(a[1]) - worst(b[1]));
  const groups: BarGroup[] = sorted.map(([dim, c]) => ({ label: checkName(dim), values: paths.map((p) => (c[p].n ? { rate: c[p].passed / c[p].n, n: `${c[p].passed}/${c[p].n}` } : null)) }));
  const weakest = sorted[0];
  const why = weakest
    ? worst(weakest[1]) >= 1
      ? 'Every check holds on every path.'
      : `Weakest check: <strong>${escapeHtml(checkName(weakest[0]))}</strong> (<code>${escapeHtml(weakest[0])}</code>) at ${paths.map((p) => `${pct(weakest[1][p].n ? weakest[1][p].passed / weakest[1][p].n : null)} on the ${p === 'template' ? 'fallback' : 'model'}`).join(', ')}${view.gate.target !== undefined ? ` against a ${pct(view.gate.target)} gate` : ''}.`
    : '';
  const kind = view.def.judgeCls ? 'rubric dimension' : 'compared field';
  return `<div class="dim-chart"><figure><figcaption>Pass rate per ${kind}, by path</figcaption>${groupedBars(groups, series, { target: view.gate.target, caption: `${nameOf(view)}: pass rate per ${kind} on each path` })}${legend(series)}</figure><p class="dim-why">${why}</p></div>`;
}

/**
 * The checks as a reader sees them: when every check holds on every path, one row per
 * check with its readable name and passed/graded per path, the raw ids behind a
 * technical disclosure; when any check fails, the grouped bar chart that shows where.
 */
export function renderCompactChecks(view: MetricView): string {
  const rates = pathRates(view);
  if (rates.size === 0) return '';
  if (!allChecksHold(rates)) return renderDimChart(view);
  const paths = PATHS.filter((p) => [...rates.values()].some((c) => c[p].n > 0));
  if (paths.length === 0) return '';
  const rows = [...rates.entries()]
    .map(([id, c]) => `<tr><th scope="row">${escapeHtml(checkName(id))}</th>${paths.map((p) => (c[p].n ? `<td class="num t-good">${c[p].passed}/${c[p].n}</td>` : '<td class="num none">Not evaluated</td>')).join('')}</tr>`)
    .join('');
  const ids = [...rates.keys()].map((id) => (CHECK_NAME[id] ? `<code>${escapeHtml(id)}</code> — ${escapeHtml(CHECK_NAME[id])}` : `<code>${escapeHtml(id)}</code>`)).join(' · ');
  return `<div class="check-rows"><table class="fields checks-compact"><thead><tr><th>Check</th>${paths.map((p) => `<th>${pathLabel(p)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <details class="technical"><summary>Technical details</summary><p class="muted small">Check ids as the grader writes them: ${ids}.</p></details></div>`;
}
