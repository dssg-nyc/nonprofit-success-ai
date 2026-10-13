import { JUDGE_PROMPT_VERSION } from '../../graders/judges/base';
import type { MetricDefinition } from '../../registry';
import { groupedBars, legend, renderScatter } from './charts';
import type { BarGroup, BarSeries } from './charts';
import { renderCases } from './cases';
import type { CaseBlob } from './cases';
import { AGENT_ROLES, CALIBRATION_FLOOR, escapeHtml, frame, gateBadge, gatedLaneKey, JUDGE_TRUST_AGREEMENT, LANE_LABEL, laneCounts, laneOfGrade, laneTarget, laneTone, laneValue, metricLink, nameOf, pairedLanes, pct, plural, sectionHead, toneFor } from './views';
import type { EvalReport } from '../../types';
import type { Lane, LaneKey, MetricView, Tone } from './views';


export interface CheckCell {
  passed: number;
  n: number;
}

/** Per metric → per check (field or rubric dimension) → per path, the pass count over graded verdicts. */
export function checkRates(view: MetricView): Map<string, Record<'template' | 'model', CheckCell>> {
  const out = new Map<string, Record<'template' | 'model', CheckCell>>();
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

export function checkCell(cell: CheckCell, target: number | undefined): string {
  if (cell.n === 0) return '<td class="none">—</td>';
  const rate = cell.passed / cell.n;
  const tone = toneFor(rate, target);
  return `<td class="check"><div class="bar-row"><div class="track thin"><div class="fill t-bg-${tone}" style="width:${Math.round(rate * 1000) / 10}%"></div></div><b class="t-${tone}">${pct(rate)}</b></div><small>${cell.passed} / ${cell.n}</small></td>`;
}

/**
 * The scoreboard says a metric fails; this says on which check. Exact-match metrics
 * break down by compared field, judge metrics by rubric dimension. The weakest check
 * sits first within each metric.
 */
export function renderChecks(views: MetricView[]): string {
  const blocks: string[] = [];
  const clean: Array<{ metric: string; checks: number }> = [];
  const worst = (c: Record<'template' | 'model', CheckCell>) =>
    Math.min(...(['template', 'model'] as const).filter((p) => c[p].n > 0).map((p) => c[p].passed / c[p].n));
  for (const v of views) {
    const rates = checkRates(v);
    if (rates.size === 0) continue;
    // A metric that loses on nothing has nothing to point at; it is counted, not tabled.
    if ([...rates.values()].every((c) => worst(c) >= 1)) {
      clean.push({ metric: v.summary.metric, checks: rates.size });
      continue;
    }
    const rows = [...rates.entries()]
      .sort((a, b) => worst(a[1]) - worst(b[1]))
      .map(([dim, cell]) => {
        const weak = worst(cell) < (v.gate.target ?? 0.9);
        const tWeak = cell.template.n > 0 && cell.template.passed / cell.template.n < (v.gate.target ?? 0.9);
        const mWeak = cell.model.n > 0 && cell.model.passed / cell.model.n < 0.9;
        const means = !weak
          ? 'Holds on both paths.'
          : v.def.judgeCls
            ? tWeak
              ? `The template string misses this rubric line${mWeak ? ' and so does the model' : '; the model meets it'} — a string fix${tWeak && v.gate.kind !== 'ungated' ? ', and it is gated' : ''}.`
              : 'Only the model text misses this rubric line — a prompt gap, reported not gated.'
            : tWeak
              ? `The fallback rule that sets this field is wrong on ${cell.template.n - cell.template.passed} of ${cell.template.n} cases${v.gate.kind !== 'ungated' ? ' — this is what fails the gate' : ''}.`
              : `Only the model gets this field wrong (${cell.model.n - cell.model.passed} of ${cell.model.n}) — a prompt gap, reported not gated.`;
        return `<tr class="${weak ? 'failing' : ''}"><th scope="row"><code>${escapeHtml(dim)}</code></th>${checkCell(cell.template, v.gate.target)}${checkCell(cell.model, undefined)}<td class="why">${means}</td></tr>`;
      })
      .join('');
    const kind = v.def.judgeCls ? 'rubric dimension' : 'compared field';
    blocks.push(
      `<tr class="group"><th colspan="4">${metricLink(v)}<span class="role">${escapeHtml(v.agent)} · per ${kind}</span></th></tr>${rows}`,
    );
  }
  if (blocks.length === 0 && clean.length === 0) return '';
  const cleanLine = clean.length
    ? `<p class="small muted">Every check passed on every path for ${clean.map((c) => `<a href="#${escapeHtml(c.metric)}">${escapeHtml(c.metric)}</a> (${c.checks})`).join(', ')} — not tabled.</p>`
    : '';
  const lede = `${blocks.length ? `<strong>${plural(blocks.length, 'metric')}</strong> lose on at least one check` : '<strong>No check lost a case</strong>'}${clean.length ? `; ${clean.length} pass every check on every path` : ''}. A metric's verdict is made of named checks: the fields an exact match compares, or the dimensions a judge scores. This says which check a metric loses on, so it points at the rule or the prompt line to change. Weakest check first; a row is marked when either path is under the metric's target.`;
  return `<section class="section-block" aria-labelledby="checks-h">
    ${sectionHead('checks-h', 'Calibration', 'Which field or rubric line does each metric lose on?', lede)}
    ${
      blocks.length
        ? `<div class="fields-wrap"><table class="fields score-table check-table">
      <thead><tr><th>Check</th><th>Template</th><th>Model</th><th>What it means</th></tr></thead>
      <tbody>${blocks.join('')}</tbody>
    </table></div>`
        : '<p class="t-good">No check lost a case on either path.</p>'
    }
    ${cleanLine}
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Template vs model comparison
// ---------------------------------------------------------------------------------------

export function bar(lane: Lane | undefined, tone: Tone, target: number | undefined, tag: string): string {
  if (!lane) return `<div class="bar-row"><span class="bar-tag">${tag}</span><span class="none-note">No ${tag.toLowerCase()} path for this metric</span></div>`;
  const width = lane.ran && lane.rate !== null ? Math.round(lane.rate * 1000) / 10 : 0;
  const tick = target !== undefined ? `<i class="target" style="left:${Math.round(target * 1000) / 10}%" title="gate target ${pct(target)}"></i>` : '';
  const cls = lane.ran ? (lane.rate === null ? 'empty' : '') : 'skipped';
  return `<div class="bar-row" title="${escapeHtml(`${lane.label}: ${laneCounts(lane)}`)}"><span class="bar-tag">${tag}</span><div class="track ${cls}"><div class="fill t-bg-${tone}" style="width:${width}%"></div>${tick}</div><b class="t-${tone}">${laneValue(lane)}</b></div>`;
}

export function renderComparison(views: MetricView[]): string {
  const rows: string[] = [];
  for (const v of views) {
    for (const kind of ['exact', 'judge'] as const) {
      const template = v.lanes.find((l) => l.kind === kind && l.path === 'template');
      const model = v.lanes.find((l) => l.kind === kind && l.path === 'model');
      if (!template && !model) continue;
      rows.push(`<div class="cmp-row">
        <div class="cmp-label"><a href="#${escapeHtml(v.summary.metric)}">${escapeHtml(v.summary.metric)}</a><small>${escapeHtml(v.agent)} · ${kind === 'exact' ? 'exact match' : 'judge pass rate'}</small></div>
        <div class="cmp-bars">
          ${bar(template, template ? laneTone(v, template) : 'none', template ? laneTarget(v, template) : undefined, 'Template')}
          ${bar(model, model ? laneTone(v, model) : 'none', undefined, 'Model')}
        </div>
      </div>`);
    }
  }
  const scatters = views.map(renderScatter).filter((s) => s.length > 0);
  const measured = views.filter((v) => v.lanes.some((l) => l.path === 'model' && l.ran && l.rate !== null));
  const behind = measured.filter((v) => {
    const { template, model } = pairedLanes(v);
    return template && model && template.rate !== null && model.rate !== null && model.rate < template.rate;
  });
  const lede = `${measured.length ? `The model path is behind the fallback on <strong>${behind.length} of ${measured.length}</strong> measured metrics. ` : '<strong>The model path was not measured this run.</strong> '}Same test cases, two ways of producing the answer. <strong>Template</strong> is the deterministic fallback (no AI). <strong>Model</strong> is the same agent asking Gemini. A gap means the model disagrees with the spec where the fallback does not. The thin line marks a gate target.`;
  return `<section class="section-block" aria-labelledby="cmp-h">
    ${sectionHead('cmp-h', 'Calibration', 'Where does the model fall short of the fallback?', lede)}
    <div class="cmp">${rows.join('')}</div>
    ${
      scatters.length
        ? `<h3>Which text did the judge prefer?</h3>
    <p class="muted">One point per case the judge scored both ways. Above the diagonal the model text scored higher than the template text; below, lower. Scores are banded (1, 0.5, 0.2 — how many rubric dimensions failed), so points stack: a bigger circle is more cases, and hovering lists them.</p>
    <div class="scatters">${scatters.join('')}</div>`
        : ''
    }
  </section>`;
}



export function howGraded(view: MetricView): string {
  const parts: string[] = [];
  if (view.def.heuristic) {
    const dims = new Set<string>();
    for (const row of view.rows) for (const g of row.grades) if (g.grader !== 'judge') Object.keys(g.dimensions).forEach((d) => dims.add(d));
    parts.push(
      `<strong>Exact match</strong>: each case's output is compared field by field with the fixture's expected answer; a case passes only if every field matches${
        dims.size ? ` (${[...dims].map((d) => `<code>${escapeHtml(d)}</code>`).join(', ')})` : ''
      }.`,
    );
  }
  if (view.def.judgeCls) {
    parts.push('<strong>Judge</strong>: an AI judge (OpenAI) reads the written output and scores it 0–1 against the rubric below; it passes or fails each case and explains why.');
  }
  return parts.join(' ');
}

export function renderRubric(def: MetricDefinition): string {
  if (!def.judgeCls) return '';
  const judge = new def.judgeCls();
  return `<details class="rubric"><summary>Judge rubric — the instructions the judge is given (<code>judge:${escapeHtml(def.name)}@${JUDGE_PROMPT_VERSION}</code>)</summary>
    <p class="muted">Each case's expected fields are appended as reference facts.</p>
    <pre>${escapeHtml(judge.systemPrompt.trim())}</pre></details>`;
}

export function renderLaneStat(view: MetricView, lane: Lane): string {
  const tone = laneTone(view, lane);
  const isGated = lane.key === gatedLaneKey(view.summary) && view.gate.kind !== 'ungated';
  const width = lane.ran && lane.rate !== null ? Math.round(lane.rate * 1000) / 10 : 0;
  return `<div class="stat tone-${tone}">
    <div class="stat-label">${escapeHtml(lane.label)}${isGated ? ' <span class="tag">gated</span>' : lane.path === 'model' ? ' <span class="tag">never gated</span>' : ''}</div>
    <div class="stat-value t-${tone}">${laneValue(lane)}</div>
    <div class="track thin"><div class="fill t-bg-${tone}" style="width:${width}%"></div></div>
    <div class="stat-sub">${escapeHtml(laneCounts(lane))}</div>
  </div>`;
}

type PathCells = Record<'template' | 'model', CheckCell>;

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

/** Dimension × path bars for one metric, weakest dimension first, with a one-line reading. */
export function renderDimChart(view: MetricView): string {
  const rates = summaryDimensions(view) ?? checkRates(view);
  if (rates.size === 0) return '';
  const paths = (['template', 'model'] as const).filter((p) => [...rates.values()].some((c) => c[p].n > 0));
  if (paths.length === 0) return '';
  const series: BarSeries[] = paths.map((p) => ({ key: p, label: p === 'template' ? 'Fallback' : 'Model' }));
  const worst = (c: PathCells) => Math.min(...paths.filter((p) => c[p].n > 0).map((p) => c[p].passed / c[p].n));
  const groups: BarGroup[] = [...rates.entries()]
    .sort((a, b) => worst(a[1]) - worst(b[1]))
    .map(([dim, c]) => ({ label: dim, values: paths.map((p) => (c[p].n ? { rate: c[p].passed / c[p].n, n: `${c[p].passed}/${c[p].n}` } : null)) }));
  const first = groups[0];
  const weakest = first ? [...rates.entries()].find(([d]) => d === first.label) : undefined;
  const why = weakest
    ? worst(weakest[1]) >= 1
      ? 'Every check holds on every path.'
      : `Weakest check: <code>${escapeHtml(weakest[0])}</code> at ${paths.map((p) => `${pct(weakest[1][p].n ? weakest[1][p].passed / weakest[1][p].n : null)} on the ${p === 'template' ? 'fallback' : 'model'}`).join(', ')}${view.gate.target !== undefined ? ` against a ${pct(view.gate.target)} gate` : ''}.`
    : '';
  const kind = view.def.judgeCls ? 'rubric dimension' : 'compared field';
  return `<div class="dim-chart"><figure><figcaption>Pass rate per ${kind}, by path</figcaption>${groupedBars(groups, series, { target: view.gate.target, caption: `${nameOf(view)}: pass rate per ${kind} on each path` })}${legend(series)}</figure><p class="dim-why">${why}</p></div>`;
}

export function renderMetric(view: MetricView): string {
  const { summary, def } = view;
  return `<section class="metric" id="${escapeHtml(summary.metric)}">
    <header class="metric-head">
      <h3>${escapeHtml(nameOf(view))} <code class="mname">${escapeHtml(summary.metric)}</code></h3>${gateBadge(view.gate)}
    </header>
    <p class="checks"><span class="muted">Checks:</span> ${escapeHtml(def.description)}</p>
    <div class="stats">${view.lanes.map((l) => renderLaneStat(view, l)).join('')}</div>
    <p class="how">${howGraded(view)} <span class="muted">${escapeHtml(view.gate.detail)}</span>${
      def.fixture ? ` <span class="muted">Cases come from <code>${escapeHtml(def.fixture)}.jsonl</code>.</span>` : ''
    }</p>
    ${renderDimChart(view)}
    ${renderRubric(def)}
  </section>`;
}

/** One filter row per tab: verdict chips, the lane and dimension a case lost on, free text. */
export function renderFilterBar(views: MetricView[]): string {
  const lanes = new Map<LaneKey, string>();
  const dims = new Set<string>();
  for (const v of views) {
    for (const l of v.lanes) lanes.set(l.key, l.label);
    for (const d of checkRates(v).keys()) dims.add(d);
  }
  const chip = (key: string, label: string) => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${key === 'all'}">${label}</button>`;
  const opt = (value: string, label: string) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  return `<div class="filter-bar" data-filter-bar>
    <div class="chips">${chip('all', 'All')}${chip('fail', 'Failing')}${chip('errored', 'Errored')}${chip('pass', 'Passing')}</div>
    <label>Lost on <select data-lane><option value="">any lane</option>${[...lanes].map(([k, l]) => opt(k, l)).join('')}</select></label>
    ${dims.size ? `<label>Dimension <select data-dim><option value="">any</option>${[...dims].sort().map((d) => opt(d, d)).join('')}</select></label>` : ''}
    <input type="search" placeholder="Find a case id or note" aria-label="Find a case">
    <span class="shown" data-shown></span>
  </div>`;
}

/** The claim an agent's run supports, and what it does not. */
export function agentFrame(agent: string, views: MetricView[], report: EvalReport): string {
  const gated = views.filter((v) => v.gate.kind !== 'ungated');
  const failed = gated.filter((v) => v.gate.kind !== 'passed');
  const claim = gated.length === 0
    ? `${escapeHtml(agent)} has no gated metric yet: its rates are reported, none certifies a deploy.`
    : failed.length
      ? `<span class="t-bad">${escapeHtml(agent)} would not ship</span>: ${failed.map((v) => `${escapeHtml(nameOf(v))} — ${escapeHtml(v.gate.detail)}`).join('; ')}.`
      : `<span class="t-good">${escapeHtml(agent)}’s fallback is certified</span>: ${gated.length === 1 ? 'its gated metric passes' : `all ${gated.length} gated metrics pass`} on this run’s fixtures.`;
  const model = views.filter((v) => v.lanes.some((l) => l.path === 'model' && l.ran && l.rate !== null));
  const judged = views.filter((v) => v.def.judgeCls);
  const untrusted = judged.filter((v) => {
    const j = report.calibration?.judges.find((x) => x.judge === v.summary.metric);
    return !j || j.n - j.nErrored < CALIBRATION_FLOOR || j.agreement === null || j.agreement < JUDGE_TRUST_AGREEMENT;
  });
  const caveats = [
    report.modelCallsRan ? (model.length ? 'Model-path rates are reported at a 90% bar and never gated.' : 'The model path measured nothing for this agent.') : 'The model path did not run, so nothing here says how the model behaves.',
    judged.length ? (untrusted.length ? `${untrusted.length === judged.length ? 'Its judge rates are' : `${plural(untrusted.length, 'judge rate')} are`} indicative: the judge is not yet trusted at ${pct(JUDGE_TRUST_AGREEMENT)}+ on ${CALIBRATION_FLOOR}+ labelled outputs.` : 'Its judges are trusted on this run’s calibration sample.') : '',
  ].filter(Boolean);
  return frame(claim, caveats.join(' '));
}

/** An agent's tab: what it does, its metrics, then every case behind one filter bar. */
export function renderAgentTab(agent: string, views: MetricView[], report: EvalReport, blob: CaseBlob): string {
  const failing = views.reduce((a, v) => a + v.rows.filter((r) => r.grades.some((g) => g.status === 'graded' && !g.isCorrect)).length, 0);
  const cases = views
    .map((v) => `<div class="cases-head"><h3>Cases — ${escapeHtml(nameOf(v))}</h3><code class="mname">${escapeHtml(v.summary.metric)}</code> ${gateBadge(v.gate)}</div>${renderCases(v, blob)}`)
    .join('');
  const lead = `${escapeHtml(AGENT_ROLES[agent] ?? '')} ${plural(views.length, 'metric')}, ${plural(views.reduce((a, v) => a + v.rows.length, 0), 'graded case')}${failing ? `, <span class="t-bad">${failing} with a failing verdict</span>` : ''}.`;
  return `<section class="section-block agent" id="agent-${escapeHtml(agent.toLowerCase())}" aria-labelledby="agent-${escapeHtml(agent.toLowerCase())}-h">
    ${sectionHead(`agent-${agent.toLowerCase()}-h`, agent, `Is ${agent} ready to ship behind its gate?`, lead)}
    ${agentFrame(agent, views, report)}
    ${views.map(renderMetric).join('')}
    <h3 id="cases-${escapeHtml(agent.toLowerCase())}">Cases, failing first</h3>
    <p class="muted">Each case shows what the fixture expected, what every lane produced and, for a judge, its reasoning. Lanes: ${[...new Set(views.flatMap((v) => v.lanes.map((l) => l.key)))].map((k) => `<strong>${escapeHtml(LANE_LABEL[k])}</strong>`).join(', ')}.</p>
    ${renderFilterBar(views)}
    ${cases}
  </section>`;
}
