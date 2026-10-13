import type { CalibrationResult, EvalReport } from '../../types';
import type { RunHistoryEntry } from '../history';
import { actionsFor } from './actions';
import { dumbbellCell, groupedBars, legend, lineChart, sparklineCell } from './charts';
import type { BarGroup, BarValue } from './charts';
import { laneRateOf, shortStamp, shortVersion, TREND_WINDOW, withCurrent } from './keyed';
import { readinessSummary } from './readiness';
import { AGENT_ROLES, CALIBRATION_FLOOR, callout, escapeHtml, fmtTimestamp, frame, gateBadge, gatedLaneKey, JUDGE_TRUST_AGREEMENT, laneCounts, laneGraded, laneTarget, laneTone, laneValue, metricLink, nameOf, pairedLanes, passedOf, pct, plural, runScope, sectionHead, toneFor } from './views';
import type { Lane, MetricView, RenderInput, Tone } from './views';

/** Every item the reader should look at before trusting the status line: failed gates, red lanes, errored graders. */
export function attentionItems(views: MetricView[]): string[] {
  const attention: string[] = [];
  for (const v of views) {
    const name = `<strong>${escapeHtml(nameOf(v))}</strong>`;
    if (v.gate.kind === 'failed') attention.push(`${name}: gate failed — ${escapeHtml(v.gate.detail)}`);
    const template = v.lanes.filter((l) => l.path === 'template');
    for (const lane of v.lanes) {
      if (!lane.ran || lane.rate === null || laneTone(v, lane) !== 'bad') continue;
      const twin = lane.path === 'model' ? template.find((t) => t.kind === lane.kind) : undefined;
      const vs = twin && twin.rate !== null ? ` (fallback ${passedOf(twin)} · ${pct(twin.rate)})` : '';
      attention.push(`${name}: ${escapeHtml(lane.label.toLowerCase())} at ${passedOf(lane)} · ${pct(lane.rate)}${vs}`);
    }
    const errored = v.lanes.reduce((a, l) => a + l.errored, 0);
    if (errored > 0) attention.push(`${name}: ${plural(errored, 'grader call')} errored — no verdict, excluded from rates`);
  }
  return attention;
}

/** One overview cell: the rate in colour, the counts beside it, errors called out. */
export function overviewCell(view: MetricView, lane: Lane | undefined): string {
  if (!lane) return '<td class="ov none" title="No such path for this metric">—</td>';
  const tone = laneTone(view, lane);
  if (!lane.ran || lane.rate === null) return `<td class="ov t-${tone}" title="${escapeHtml(laneCounts(lane))}">${laneValue(lane)}</td>`;
  const target = laneTarget(view, lane);
  const title = `${lane.label}: ${laneCounts(lane)}${target !== undefined ? ` · gate ≥ ${pct(target)}` : ''}`;
  return `<td class="ov t-${tone}" title="${escapeHtml(title)}"><b>${pct(lane.rate)}</b> <span class="n">${passedOf(lane)}</span>${
    lane.errored ? `<small class="t-err">${plural(lane.errored, 'error')}</small>` : ''
  }</td>`;
}

/**
 * The judge's agreement with hand labels, beside the rates it produced. Under the floor it
 * renders muted with the count, so a 2/3 can never read as a 67% that settles anything.
 */
export function trustCell(view: MetricView, report: EvalReport): string {
  if (!view.def.judgeCls) return '<td class="ov none" title="No judge on this metric">—</td>';
  const j = report.calibration?.judges.find((x) => x.judge === view.summary.metric);
  if (!j) return '<td class="ov none" title="This judge was not calibrated in this run">not calibrated</td>';
  const graded = j.n - j.nErrored;
  if (j.agreement === null || graded === 0) return `<td class="ov t-err" title="Every labelled output errored for this judge">all errored (${j.nErrored})</td>`;
  const agreed = Math.round(j.agreement * graded);
  const thin = graded < CALIBRATION_FLOOR;
  const title = thin
    ? `${agreed} of ${graded} labelled outputs agreed with the hand label — under the ${CALIBRATION_FLOOR}-output floor, so the judge rates on this row are indicative, not evidence`
    : `${agreed} of ${graded} labelled outputs agreed with the hand label`;
  return `<td class="ov t-${thin ? 'none' : toneFor(j.agreement)}${thin ? ' thin' : ''}" title="${escapeHtml(title)}"><b>${agreed}/${graded}</b> <span class="n">${pct(j.agreement)}</span>${
    thin ? '<small>under floor</small>' : ''
  }</td>`;
}

/** One row per metric, grouped by agent: counts beside rates, the dumbbell, the trend, the judge's trust, the gate. */
export function renderOverviewTable(views: MetricView[], report: EvalReport, history: RunHistoryEntry[]): string {
  const runs = withCurrent(report, history).slice(-TREND_WINDOW);
  const agents: string[] = [];
  for (const v of views) if (!agents.includes(v.agent)) agents.push(v.agent);
  const body = agents
    .map((agent) => {
      const group = `<tr class="group"><th colspan="7"><a href="#agent-${escapeHtml(agent.toLowerCase())}">${escapeHtml(agent)}</a><span class="role">${escapeHtml(AGENT_ROLES[agent] ?? '')}</span></th></tr>`;
      const rows = views
        .filter((v) => v.agent === agent)
        .map((v) => {
          const { template, model } = pairedLanes(v);
          const kind = template?.kind === 'judge' ? 'writing · judge' : 'decision · exact match';
          return (
            `<tr class="${v.gate.kind === 'failed' ? 'failing' : ''}"><th scope="row" title="${escapeHtml(v.def.description)}">${metricLink(v)}<small>${kind}</small></th>` +
            overviewCell(v, template) +
            overviewCell(v, model) +
            dumbbellCell(v, template, model) +
            sparklineCell(v, runs) +
            trustCell(v, report) +
            `<td class="gate-cell">${gateBadge(v.gate)}</td></tr>`
          );
        })
        .join('');
      return group + rows;
    })
    .join('');
  return `<div class="fields-wrap"><table class="fields overview-table">
      <thead><tr><th>Metric</th><th>Fallback</th><th>Model</th><th>Fallback ● vs model ○</th><th>Trend</th><th>Judge vs labels</th><th>Gate</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="legend"><svg class="dumbbell key" viewBox="0 0 150 20" aria-hidden="true"><line class="rail" x1="6" x2="144" y1="10" y2="10"/><line class="bar" x1="110" x2="110" y1="3" y2="17"/><line class="gap" x1="60" x2="130" y1="10" y2="10"/><circle class="dot template t-fill-good" cx="130" cy="10" r="5"/><circle class="dot model t-stroke-warn" cx="60" cy="10" r="4.5"/></svg> filled dot: fallback; open dot: model; the bar is the gate target (soft when ungated: the 90% colour threshold). Trend: fallback solid, model dashed, last ${TREND_WINDOW} keyed runs; a tick marks a prompt or fixture change. Judge vs labels: agreed/labelled, muted under ${CALIBRATION_FLOOR} outputs. Every rate shows passed/graded beside it; errored cases are in neither.</p>`;
}

/** What this run is and is not: offline, over fixtures, which prompts, which commit, full or partial. */
export function renderEvidenceLine(report: EvalReport): string {
  const run = report.run;
  const ran = [report.judgesRan ? 'judges' : '', report.modelCallsRan ? 'model path' : ''].filter(Boolean);
  const parts = [
    `<strong>Offline evaluation</strong> over ${plural(report.nCases, 'hand-written case')} — not live traffic`,
    `run <time datetime="${escapeHtml(report.generatedAt)}">${escapeHtml(fmtTimestamp(report.generatedAt))}</time>`,
    report.judgesRan && report.modelCallsRan ? 'full run' : `<strong>partial run</strong> (${ran.length ? ran.join(' and ') : 'fallback only'})`,
  ];
  if (run) {
    parts.push(`prompts ${Object.entries(run.promptVersions).map(([k, v]) => `${escapeHtml(k)} ${escapeHtml(shortVersion(v))}`).join(', ')}`);
    if (run.git.commit) parts.push(`commit <code>${escapeHtml(run.git.commit)}${run.git.dirty ? '*' : ''}</code>${run.git.dirty ? ' with uncommitted changes' : ''}`);
  }
  const models = Object.entries(report.models ?? {}).filter(([, v]) => v);
  if (models.length) parts.push(models.map(([k, v]) => `${escapeHtml(k)} <code>${escapeHtml(String(v))}</code>`).join(', '));
  return `<p class="footer-note evidence-line">${parts.join(' · ')}</p>`;
}

// ---------------------------------------------------------------------------------------
// Dashboard: tiles, roster, agent × lane bars, the line across keyed runs
// ---------------------------------------------------------------------------------------

/** Passed over graded, pooled across the lanes that match; null when none was measured. */
export function pooled(views: MetricView[], pick: (lane: Lane) => boolean): BarValue | null {
  let passed = 0;
  let graded = 0;
  for (const v of views) {
    for (const lane of v.lanes) {
      if (!pick(lane) || !lane.ran || lane.rate === null) continue;
      const g = lane.n - lane.errored;
      passed += Math.round(lane.rate * g);
      graded += g;
    }
  }
  return graded > 0 ? { rate: passed / graded, n: `${passed}/${graded}` } : null;
}

export const agentsOf = (views: MetricView[]): string[] => {
  const agents: string[] = [];
  for (const v of views) if (!agents.includes(v.agent)) agents.push(v.agent);
  return agents;
};

/** Judges trusted this run: 80%+ agreement over the floor. */
export function judgesTrusted(report: EvalReport): { trusted: number; total: number } {
  const judges = report.calibration?.judges ?? [];
  const trusted = judges.filter((j) => j.n - j.nErrored >= CALIBRATION_FLOOR && j.agreement !== null && j.agreement >= JUDGE_TRUST_AGREEMENT).length;
  return { trusted, total: judges.length };
}

function tile(label: string, value: string, sub: string, tone: Tone, href: string): string {
  return `<a class="stat-card tone-${tone}" href="${href}"><div class="num">${value}</div><div class="label">${label}</div><div class="sub">${sub}</div></a>`;
}

/** Four numbers a reader checks first; each card links to the tab that explains it. */
export function renderTiles(views: MetricView[], report: EvalReport, calibrationRows: CalibrationResult[], input: RenderInput): string {
  const gated = views.filter((v) => v.gate.kind !== 'ungated');
  const gatesOk = gated.filter((v) => v.gate.kind === 'passed').length;
  const measured = views.filter((v) => v.lanes.some((l) => l.path === 'model' && l.ran && l.rate !== null));
  const atBar = measured.filter((v) => v.lanes.filter((l) => l.path === 'model' && l.ran && l.rate !== null).every((l) => laneTone(v, l) === 'good')).length;
  const judges = judgesTrusted(report);
  const p1 = actionsFor(views, report, calibrationRows, input).filter((a) => a.priority === 1).length;
  const of = (a: number, b: number) => `${a}<small> / ${b}</small>`;
  return `<div class="grid-4">
    ${tile('Gated metrics passing', gated.length ? of(gatesOk, gated.length) : '—', gated.length ? (gatesOk === gated.length ? 'every gate certifies its fallback' : `${gated.length - gatesOk} failing — blocks a deploy`) : 'no metric is gated yet', gated.length === 0 ? 'none' : gatesOk === gated.length ? 'good' : 'bad', '#calibration')}
    ${tile('Model metrics at the 90% bar', !report.modelCallsRan ? 'not run' : measured.length ? of(atBar, measured.length) : '—', !report.modelCallsRan ? 'the model path was skipped this run' : measured.length ? 'reported, never gated' : 'no metric measured', !report.modelCallsRan || measured.length === 0 ? 'none' : atBar === measured.length ? 'good' : atBar === 0 ? 'bad' : 'warn', '#calibration')}
    ${tile('Judges trusted', !report.judgesRan ? 'not run' : judges.total ? of(judges.trusted, judges.total) : '—', !report.judgesRan ? 'the judges were skipped this run' : judges.total ? `${pct(JUDGE_TRUST_AGREEMENT)}+ agreement on ${CALIBRATION_FLOOR}+ labelled outputs` : 'not calibrated this run', !report.judgesRan || judges.total === 0 ? 'none' : judges.trusted === judges.total ? 'good' : judges.trusted === 0 ? 'bad' : 'warn', '#calibration')}
    ${tile('Open P1 actions', String(p1), p1 ? 'each blocks a gate — see the actions table' : 'nothing blocks a gate', p1 ? 'bad' : 'good', '#actions')}
  </div>`;
}

/** One row per agent: metrics, pooled fallback and model rates, gates, judges, failing cases. */
export function renderRoster(views: MetricView[], report: EvalReport): string {
  const rows = agentsOf(views).map((agent) => {
    const mine = views.filter((v) => v.agent === agent);
    const gated = mine.filter((v) => v.gate.kind !== 'ungated');
    const failedGates = gated.filter((v) => v.gate.kind !== 'passed').length;
    const fallback = pooled(mine, (l) => l.path === 'template');
    const model = pooled(mine, (l) => l.path === 'model');
    const failing = mine.reduce((a, v) => a + v.rows.filter((r) => r.grades.some((g) => g.status === 'graded' && !g.isCorrect)).length, 0);
    const judged = mine.filter((v) => v.def.judgeCls);
    const trusted = judged.filter((v) => {
      const j = report.calibration?.judges.find((x) => x.judge === v.summary.metric);
      return j && j.n - j.nErrored >= CALIBRATION_FLOOR && j.agreement !== null && j.agreement >= JUDGE_TRUST_AGREEMENT;
    }).length;
    const cell = (v: BarValue | null, target?: number) => (v ? `<td class="ov t-${toneFor(v.rate, target)}"><b>${pct(v.rate)}</b> <span class="n">${v.n}</span></td>` : '<td class="ov none">—</td>');
    const gateText = gated.length === 0 ? '<span class="muted">none gated</span>' : failedGates ? `<span class="t-bad">${failedGates} of ${gated.length} failing</span>` : `<span class="t-good">${gated.length} of ${gated.length} pass</span>`;
    const judgeText = judged.length === 0 ? '<span class="muted">—</span>' : report.calibration ? `${trusted} of ${judged.length} trusted` : '<span class="muted">not calibrated</span>';
    return `<tr class="${failedGates ? 'failing' : ''}"><th scope="row"><a href="#${escapeHtml(agent.toLowerCase())}">${escapeHtml(agent)}</a><small>${escapeHtml(AGENT_ROLES[agent] ?? '')}</small></th><td class="num">${mine.length}</td>${cell(fallback, 0.9)}${cell(model, 0.9)}<td>${gateText}</td><td>${judgeText}</td><td class="num">${failing ? `<span class="t-bad">${failing}</span>` : '0'}</td></tr>`;
  });
  return `<div class="fields-wrap"><table class="fields roster"><thead><tr><th>Agent</th><th>Metrics</th><th>Fallback</th><th>Model</th><th>Gates</th><th>Judges</th><th>Failing cases</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

const PATH_SERIES = [
  { key: 'template', label: 'Fallback (gated)' },
  { key: 'model', label: 'Model path (reported)' },
];

/** Agent × path: the pooled pass rate per agent, fallback beside model. */
export function renderAgentBars(views: MetricView[]): string {
  const groups: BarGroup[] = agentsOf(views).map((agent) => {
    const mine = views.filter((v) => v.agent === agent);
    return { label: agent, href: `#${agent.toLowerCase()}`, values: [pooled(mine, (l) => l.path === 'template'), pooled(mine, (l) => l.path === 'model')] };
  });
  return `<figure><figcaption>Pass rate per agent, by path</figcaption>${groupedBars(groups, PATH_SERIES, { target: 0.9, caption: 'Pooled pass rate per agent: fallback and model path, with the 90% bar' })}${legend(PATH_SERIES)}</figure>`;
}

/** Fallback and model pooled rates across the last keyed runs, a tick where a prompt changed. */
export function renderRunsLine(views: MetricView[], report: EvalReport, history: RunHistoryEntry[]): string {
  const runs = withCurrent(report, history).slice(-TREND_WINDOW);
  if (runs.length < 2) return `<figure><figcaption>Across keyed runs</figcaption><p class="muted small">Appears after the second keyed run (${runs.length} so far).</p></figure>`;
  const defs = new Map(views.map((v) => [v.summary.metric, v]));
  const pool = (run: RunHistoryEntry, path: 'template' | 'model'): number | null => {
    let passed = 0;
    let graded = 0;
    for (const s of run.summaries) {
      if (!defs.has(s.metric)) continue;
      const keys = path === 'template' ? [gatedLaneKey(s)] : (['model', 'modelJudge'] as const);
      for (const key of keys) {
        const rate = laneRateOf(s, key);
        const g = laneGraded(s, key);
        if (rate === null || g <= 0) continue;
        passed += Math.round(rate * g);
        graded += g;
      }
    }
    return graded ? passed / graded : null;
  };
  const points = runs.map((run, i) => {
    const prev = runs[i - 1];
    const changed = prev ? Object.entries(run.promptVersions).filter(([k, v]) => prev.promptVersions[k] !== v).map(([k, v]) => `${k} → ${shortVersion(v)}`) : [];
    return { label: shortStamp(run.generatedAt), change: changed.length ? `prompt change: ${changed.join(', ')}` : undefined };
  });
  const series = [
    { key: 'template', label: 'Fallback', values: runs.map((r) => pool(r, 'template')) },
    { key: 'model', label: 'Model', values: runs.map((r) => pool(r, 'model')) },
  ];
  return `<figure><figcaption>Across the last ${runs.length} keyed runs</figcaption>${lineChart(points, series, 'Pooled pass rate per keyed run, fallback and model path; a dashed tick marks a prompt change')}${legend(series)}</figure>`;
}

/** The overview tab: claim and caveat, four stat cards, the roster, two charts, what needs attention, evidence. */
export function renderOverview(views: MetricView[], report: EvalReport, history: RunHistoryEntry[], calibrationRows: CalibrationResult[], input: RenderInput): string {
  const attention = attentionItems(views);
  const partial = !(report.judgesRan && report.modelCallsRan)
    ? callout('amber', `<strong>Partial run.</strong> ${report.judgesRan ? 'The model path' : report.modelCallsRan ? 'The judges' : 'The judges and the model path'} did not run, so the rows below say nothing about ${report.judgesRan ? 'how the model behaves' : report.modelCallsRan ? 'prose quality' : 'prose quality or how the model behaves'}. The fallback numbers are complete.`)
    : '';
  const gated = views.filter((v) => v.gate.kind !== 'ungated');
  const failed = gated.filter((v) => v.gate.kind !== 'passed');
  const claim = gated.length === 0
    ? 'No agent is gated yet: every rate on this page is reported, none certifies a deploy.'
    : failed.length
      ? `<span class="t-bad">${plural(failed.length, 'gated metric')} would block a deploy</span> (${failed.map((v) => escapeHtml(nameOf(v))).join(', ')}); the other ${gated.length - failed.length} certify their fallback.`
      : `<span class="t-good">Every gated fallback is certified</span> — ${gated.length} of ${gated.length} gates pass on this run’s fixtures.`;
  const caveat = 'The gate certifies the deterministic fallback only. Model-path rates are reported at a 90% bar and never gated; judge rates are worth exactly as much as the judge’s calibration sample (see Calibration).';
  const readiness = readinessSummary(views, report, input);
  return `<section class="section-block overview" id="overview" aria-labelledby="overview-h">
    ${sectionHead('overview-h', 'Overview', 'Is each agent ready to ship behind its gate?', `Scope: ${runScope(report)}.`)}
    ${frame(claim, caveat)}
    ${partial}
    ${renderTiles(views, report, calibrationRows, input)}
    ${renderRoster(views, report)}
    <div class="grid-2">${renderAgentBars(views)}${renderRunsLine(views, report, history)}</div>
    ${attention.length ? callout('red', `<h3>Needs attention</h3><ul>${attention.map((a) => `<li>${a}</li>`).join('')}</ul><p class="muted small">Every failing verdict, sorted by what it means, is under <a href="#triage-h">What to fix</a>.</p>`) : ''}
    <p class="pointer">${readiness.done} of ${readiness.total} readiness steps done${readiness.blocker ? ` — next: ${escapeHtml(readiness.blocker.step.toLowerCase())}` : ''} — see <a href="#readiness">How to read this page</a>.</p>
    <details class="metric-table" id="metric-table" open><summary>Every metric — rates, dumbbell, trend, judge trust, gate</summary>
    ${renderOverviewTable(views, report, history)}
    </details>
    ${renderEvidenceLine(report)}
  </section>`;
}
