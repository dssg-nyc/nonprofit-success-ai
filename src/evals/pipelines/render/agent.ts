/**
 * An agent's tab: one verdict line derived from the data, a summary card per metric with
 * its checks, then the scenario explorer (`scenarios.ts`). The check table and the
 * fallback-vs-model comparison also serve the Calibration tab.
 */

import { JUDGE_PROMPT_VERSION } from '../../graders/judges/base';
import type { MetricDefinition } from '../../registry';
import { renderScatter } from './charts';
import type { CaseBlob } from './cases';
import { checkRates, renderCompactChecks } from './checks';
import type { CheckCell } from './checks';
import { renderScenarios, skippedLanes } from './scenarios';
import { AGENT_ROLES, CALIBRATION_FLOOR, escapeHtml, gateBadge, gatedLaneKey, JUDGE_TRUST_AGREEMENT, laneCounts, laneTarget, laneTone, laneValue, metricLink, nameOf, pairedLanes, passedOf, pct, plural, sectionHead, toneFor } from './views';
import type { EvalReport } from '../../types';
import type { Lane, MetricView, Tone } from './views';

export function checkCell(cell: CheckCell, target: number | undefined): string {
  if (cell.n === 0) return '<td class="none">Not evaluated</td>';
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
              ? `The fallback text misses this rubric line${mWeak ? ' and so does the model' : '; the model meets it'} — a string fix${tWeak && v.gate.kind !== 'ungated' ? ', and it is gated' : ''}.`
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
      <thead><tr><th>Check</th><th>Fallback</th><th>Model</th><th>What it means</th></tr></thead>
      <tbody>${blocks.join('')}</tbody>
    </table></div>`
        : '<p class="t-good">No check lost a case on either path.</p>'
    }
    ${cleanLine}
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Fallback vs model comparison
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
          ${bar(template, template ? laneTone(v, template) : 'none', template ? laneTarget(v, template) : undefined, 'Fallback')}
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
  const lede = `${measured.length ? `The model path is behind the fallback on <strong>${behind.length} of ${measured.length}</strong> measured metrics. ` : '<strong>The model path was not measured this run.</strong> '}Same test cases, two ways of producing the answer. <strong>Fallback</strong> is the deterministic path (no AI). <strong>Model</strong> is the same agent asking Gemini. A gap means the model disagrees with the spec where the fallback does not. The thin line marks a gate target.`;
  return `<section class="section-block" aria-labelledby="cmp-h">
    ${sectionHead('cmp-h', 'Calibration', 'Where does the model fall short of the fallback?', lede)}
    <div class="cmp">${rows.join('')}</div>
    ${
      scatters.length
        ? `<h3>Which text did the judge prefer?</h3>
    <p class="muted">One point per case the judge scored both ways. Above the diagonal the model text scored higher than the fallback text; below, lower. Scores are banded (1, 0.5, 0.2 — how many rubric dimensions failed), so points stack: a bigger circle is more cases, and hovering lists them.</p>
    <div class="scatters">${scatters.join('')}</div>`
        : ''
    }
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Metric cards
// ---------------------------------------------------------------------------------------

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

/** A lane's verdict in words: how many passed of those graded, or why there is no count. */
export function laneVerdict(lane: Lane): string {
  if (!lane.ran) return 'Not evaluated';
  if (lane.n === 0) return 'No cases';
  if (lane.n - lane.errored === 0) return 'Evaluation error';
  return `${passedOf(lane)} passed`;
}

/** The lane a metric's verdict is read from: the gated lane when it ran, else the first fallback lane that did. */
export function verdictLane(view: MetricView): Lane | undefined {
  const gated = view.lanes.find((l) => l.key === gatedLaneKey(view.summary));
  if (gated?.ran) return gated;
  return view.lanes.find((l) => l.path === 'template' && l.ran) ?? gated ?? view.lanes[0];
}

/** One summary card: name and gate, the verdict in words, what the metric checks, its checks, then the graded detail behind a disclosure. */
export function renderMetric(view: MetricView): string {
  const { summary, def } = view;
  const lead = verdictLane(view);
  const others = view.lanes.filter((l) => l !== lead && l.ran);
  const verdict = lead
    ? `<b class="t-${laneTone(view, lead)}">${laneVerdict(lead)}</b> <span class="muted">on the ${lead.path === 'template' ? 'fallback' : 'model'}${lead.kind === 'judge' ? ' by the judge' : ''}</span>${others
        .map((l) => ` · <span class="t-${laneTone(view, l)}">${l.path === 'model' ? 'Model' : 'Fallback'}${l.kind === 'judge' ? ' (judge)' : ''}: ${laneVerdict(l)}</span>`)
        .join('')}`
    : '<b class="t-none">Not evaluated</b>';
  return `<section class="metric" id="${escapeHtml(summary.metric)}">
    <header class="metric-head">
      <h3>${escapeHtml(nameOf(view))} <code class="mname">${escapeHtml(summary.metric)}</code></h3>${gateBadge(view.gate)}
    </header>
    <p class="metric-verdict">${verdict}</p>
    <p class="checks">${escapeHtml(def.description)}</p>
    ${renderCompactChecks(view)}
    <details class="technical"><summary>How it is graded</summary>
      <div class="stats">${view.lanes.map((l) => renderLaneStat(view, l)).join('')}</div>
      <p class="how">${howGraded(view)} <span class="muted">${escapeHtml(view.gate.detail)}</span>${
        def.fixture ? ` <span class="muted">Cases come from <code>${escapeHtml(def.fixture)}.jsonl</code>.</span>` : ''
      }</p>
      ${renderRubric(def)}
    </details>
  </section>`;
}

/** Architect grades two different fixtures; its cards sit in two groups. Other agents have one. */
const GROUP_LABEL: Record<string, string> = { architectScoring: 'Assessment scoring', architectCharter: 'Plan quality' };

export function renderMetricGroups(views: MetricView[]): string {
  const groups = new Map<string, MetricView[]>();
  for (const v of views) {
    const key = v.def.fixture ?? v.summary.metric;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  if (groups.size < 2) return views.map(renderMetric).join('');
  return [...groups.entries()].map(([key, vs]) => `<h3 class="group-h">${escapeHtml(GROUP_LABEL[key] ?? key)}</h3>${vs.map(renderMetric).join('')}`).join('');
}

// ---------------------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------------------

type VerdictKind = 'passed' | 'attention' | 'unknown';

/** The one line an agent's tab leads with, derived from its fallback verdicts and gates. */
export function agentVerdict(agent: string, views: MetricView[]): { kind: VerdictKind; text: string } {
  const fallback = views.map((v) => ({ v, lane: v.lanes.find((l) => l.path === 'template' && l.ran && l.n - l.errored > 0) })).filter((x): x is { v: MetricView; lane: Lane } => x.lane !== undefined);
  const part = (x: { v: MetricView; lane: Lane }) => `${escapeHtml(nameOf(x.v))}: ${passedOf(x.lane)}`;
  const failing = fallback.filter((x) => x.v.gate.kind === 'failed' || (x.lane.rate !== null && x.lane.rate < 1));
  if (failing.length) return { kind: 'attention', text: `${escapeHtml(agent)} · <span class="t-bad">Needs attention</span> — ${failing.map(part).join(' · ')}` };
  if (fallback.length === 0) return { kind: 'unknown', text: `${escapeHtml(agent)} · <span class="t-none">Not evaluated</span>` };
  return { kind: 'passed', text: `${escapeHtml(agent)} · <span class="t-good">Fallback checks passed</span> — ${fallback.map(part).join(' · ')}` };
}

/** What the run counted and what it left unverified, in plain numbers. */
export function agentLead(agent: string, views: MetricView[], report: EvalReport): string {
  const scenarios = new Set(views.flatMap((v) => v.rows.map((r) => r.caseId))).size;
  const completed = views.reduce((a, v) => a + v.lanes.filter((l) => l.ran).reduce((b, l) => b + (l.n - l.errored), 0), 0);
  const skipped = skippedLanes(views);
  const judged = views.filter((v) => v.def.judgeCls);
  const judgesRan = judged.filter((v) => v.lanes.some((l) => l.kind === 'judge' && l.ran));
  const untrusted = judgesRan.filter((v) => {
    const j = report.calibration?.judges.find((x) => x.judge === v.summary.metric);
    return !j || j.n - j.nErrored < CALIBRATION_FLOOR || j.agreement === null || j.agreement < JUDGE_TRUST_AGREEMENT;
  });
  const modelRan = views.some((v) => v.lanes.some((l) => l.path === 'model' && l.ran && l.rate !== null));
  const unverified = [
    modelRan ? '' : 'model behavior',
    judged.length === 0 ? '' : judgesRan.length === 0 ? 'prose quality (no judge ran)' : untrusted.length ? `prose quality (${untrusted.length === judgesRan.length ? 'judge' : `${untrusted.length} of ${judgesRan.length} judges`} not yet trusted at ${pct(JUDGE_TRUST_AGREEMENT)}+ on ${CALIBRATION_FLOOR}+ labelled outputs)` : '',
  ].filter(Boolean);
  return `${escapeHtml(AGENT_ROLES[agent] ?? '')} <strong>${plural(scenarios, 'scenario')}</strong>, <strong>${plural(completed, 'completed check result')}</strong>${skipped.length ? `; ${skipped.join('; ')}` : ''}.${
    unverified.length ? ` <span class="still">Still unverified: ${unverified.join(' and ')}.</span>` : ''
  }${modelRan ? ' Model-path rates are reported at a 90% bar and never gated.' : ''}`;
}

/** An agent's tab: the verdict line, a card per metric, then every scenario behind one filter bar. */
export function renderAgentTab(agent: string, views: MetricView[], report: EvalReport, blob: CaseBlob): string {
  const slug = escapeHtml(agent.toLowerCase());
  const verdict = agentVerdict(agent, views);
  return `<section class="section-block agent verdict-${verdict.kind}" id="agent-${slug}" aria-labelledby="agent-${slug}-h">
    <div class="section-header"><span class="num">${escapeHtml(agent)}</span>
    <h2 id="agent-${slug}-h">${verdict.text}</h2>
    <p class="lead">${agentLead(agent, views, report)}</p></div>
    ${renderMetricGroups(views)}
    ${renderScenarios(agent, views, blob)}
  </section>`;
}
