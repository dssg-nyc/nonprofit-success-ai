import type { EvalReport } from '../../types';
import type { RunHistoryEntry } from '../history';
import { latencyChart, secs } from './charts';
import { fixtureChanged, LANE_ORDER, laneRateOf, previousKeyedRun, shortStamp, shortVersion, TREND_WINDOW, withCurrent } from './keyed';
import { AGENT_ROLES, CALIBRATION_FLOOR, escapeHtml, gateBadge, gatedLaneKey, JUDGE_TRUST_AGREEMENT, LANE_LABEL, laneCounts, laneTarget, laneTone, laneValue, metricLink, pairedLanes, pct, plural, renderModels, sectionHead, toneFor } from './views';
import type { LaneKey, MetricView } from './views';

/** Model-call latency per agent/judge group, from calls.jsonl via summary.json. */
export function renderLatency(report: EvalReport): string {
  const groups = report.latency ?? [];
  if (groups.length === 0) return '';
  const sorted = [...groups].sort((a, b) => a.role.localeCompare(b.role) || a.agent.localeCompare(b.agent));
  const agents = groups.filter((g) => g.role === 'agent');
  const judges = groups.filter((g) => g.role === 'judge');
  const body = sorted
    .map((g) => {
      const failures = Object.entries(g.failures).map(([code, n]) => `${escapeHtml(code)} ×${n}`).join(', ');
      const tokens = g.meanInputTokens !== null ? `${g.meanInputTokens} → ${g.meanOutputTokens ?? '–'}` : '–';
      return `<tr><td>${g.role === 'judge' ? 'Judge' : 'Agent'}</td><td>${escapeHtml(g.agent)}</td><td><code>${escapeHtml(g.promptVersion)}</code><br><small>${escapeHtml(g.model)}</small></td>` +
        `<td>${g.n}</td><td>${secs(g.p50Ms)}</td><td>${secs(g.p95Ms)}</td><td>${secs(g.maxMs)}</td><td>${tokens}</td>` +
        `<td class="${g.nFailed ? 't-bad' : ''}">${g.nFailed ? failures : '0'}</td></tr>`;
    })
    .join('');
  const slowest = agents.length ? [...agents].sort((a, b) => b.p95Ms - a.p95Ms)[0] : undefined;
  const lede = `${slowest ? `Slowest agent at p95 is <strong>${escapeHtml(slowest.agent)}</strong> at ${secs(slowest.p95Ms)}. ` : ''}<strong>Agent calls</strong> are what a partner waits on in the portal — one call per case, so these are the numbers that matter. <strong>Judge calls</strong> grade a batch of cases each and only cost the harness; they are charted apart so they do not set the scale. Bar is p50, tick is p95, over successful calls only — a timeout's duration is the timeout, not the model. Every call this run made, retries included, is in the table below.`;
  return `<section class="section-block" aria-labelledby="lat-h">
    ${sectionHead('lat-h', 'Calibration', 'How long does a partner wait on each agent?', lede)}
    ${latencyChart(agents, 'Agent calls — seconds per case')}
    ${latencyChart(judges, 'Judge calls — seconds per batch')}
    <details><summary>Every call group: calls, p50 / p95 / max, tokens, failures by code</summary>
    <div class="fields-wrap"><table class="fields"><thead><tr><th>Role</th><th>Agent</th><th>Prompt · model</th><th>Calls</th><th>p50</th><th>p95</th><th>Max</th><th>Tokens</th><th>Failed</th></tr></thead><tbody>${body}</tbody></table></div>
    </details>
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Scoreboard — every metric, every lane, with the change since the previous keyed run
// ---------------------------------------------------------------------------------------

export const FIXTURE_MARK = '<abbr class="fx" title="The fixture file changed between these runs, so the rates are not like for like.">†</abbr>';

export const pts = (delta: number): string => {
  const n = Math.round(Math.abs(delta) * 100);
  return n === 0 ? '±0' : `${delta > 0 ? '+' : '−'}${n} pts`;
};

/** One scoreboard cell: the rate, then passed/graded and the change since the previous keyed run. */
export function scoreCell(view: MetricView, key: LaneKey, report: EvalReport, previous: RunHistoryEntry | undefined): string {
  const lane = view.lanes.find((l) => l.key === key);
  if (!lane) return '<td class="score none" title="No such path for this metric">Not applicable</td>';
  if (!lane.ran) return '<td class="score none" title="Not evaluated — no model key for this run">Not evaluated</td>';
  const tone = laneTone(view, lane);
  if (lane.rate === null) return `<td class="score t-${tone}" title="${escapeHtml(laneCounts(lane))}">${laneValue(lane)}</td>`;
  const graded = lane.n - lane.errored;
  const passed = Math.round(lane.rate * graded);
  const sub: string[] = [`${passed}/${graded}`];
  if (previous) {
    const before = previous.summaries.find((s) => s.metric === view.summary.metric);
    const was = before ? laneRateOf(before, key) : null;
    if (was === null) sub.push('new');
    else {
      const delta = lane.rate - was;
      const dTone = delta > 0.005 ? 'good' : delta < -0.005 ? 'bad' : 'none';
      sub.push(`<span class="t-${dTone}">${pts(delta)}</span>${fixtureChanged(view.def, report.run, previous) ? FIXTURE_MARK : ''}`);
    }
  }
  const target = laneTarget(view, lane);
  const title = `${lane.label}: ${laneCounts(lane)}${target !== undefined ? ` · gate ≥ ${pct(target)}` : ''}`;
  return `<td class="score t-${tone}" title="${escapeHtml(title)}"><b>${pct(lane.rate)}</b><small>${sub.join(' · ')}</small>${lane.errored ? `<small class="t-err">${plural(lane.errored, 'error')}</small>` : ''}</td>`;
}

/** One sentence per scoreboard row: what the gate, the model gap and the judge's trust add up to. */
export function scoreMeans(view: MetricView, report: EvalReport): string {
  const { template, model } = pairedLanes(view);
  const parts: string[] = [];
  if (view.gate.kind === 'failed') parts.push(`<span class="t-bad">Blocks a deploy</span>: ${escapeHtml(view.gate.detail)}`);
  else if (view.gate.kind === 'passed') parts.push('Fallback certified by the gate.');
  else if (view.gate.kind === 'unmeasured') parts.push('Gated but not measured this run.');
  else parts.push('Reported only; no threshold yet.');
  if (template && model && template.ran && model.ran && template.rate !== null && model.rate !== null) {
    const gap = Math.round((template.rate - model.rate) * 100);
    parts.push(gap > 0 ? `Model ${gap} pts behind the fallback.` : gap < 0 ? `Model ${-gap} pts ahead of the fallback.` : 'Model matches the fallback.');
  } else if (model && !model.ran) parts.push('Model path not run.');
  if (view.def.judgeCls) {
    const j = report.calibration?.judges.find((x) => x.judge === view.summary.metric);
    const graded = j ? j.n - j.nErrored : 0;
    if (!j) parts.push('Judge uncalibrated: read its rates as indicative.');
    else if (graded < CALIBRATION_FLOOR) parts.push(`Judge calibrated on ${graded}: indicative.`);
    else if (j.agreement !== null && j.agreement < JUDGE_TRUST_AGREEMENT) parts.push(`<span class="t-warn">Judge at ${pct(j.agreement)} agreement</span>: not trusted.`);
    else parts.push('Judge trusted.');
  }
  return parts.join(' ');
}

export function renderScoreboard(views: MetricView[], report: EvalReport, history: RunHistoryEntry[]): string {
  const previous = previousKeyedRun(report, history);
  const agents: string[] = [];
  for (const v of views) if (!agents.includes(v.agent)) agents.push(v.agent);
  const body = agents
    .map((agent) => {
      const group = `<tr class="group"><th colspan="7"><a href="#agent-${escapeHtml(agent.toLowerCase())}">${escapeHtml(agent)}</a><span class="role">${escapeHtml(AGENT_ROLES[agent] ?? '')}</span></th></tr>`;
      const rows = views
        .filter((v) => v.agent === agent)
        .map(
          (v) =>
            `<tr class="${v.gate.kind === 'failed' ? 'failing' : ''}"><th scope="row">${metricLink(v)}<small>${escapeHtml(v.def.description)}</small></th>` +
            LANE_ORDER.map((key) => scoreCell(v, key, report, previous)).join('') +
            `<td class="gate-cell">${gateBadge(v.gate)}</td><td class="why">${scoreMeans(v, report)}</td></tr>`,
        )
        .join('');
      return group + rows;
    })
    .join('');
  const vs = previous
    ? `Small print under each rate: cases passed / graded, then the change in points against the previous keyed run (<a href="#trends">${escapeHtml(shortStamp(previous.generatedAt))}${previous.label ? ` · ${escapeHtml(previous.label)}` : ''}</a>). ${FIXTURE_MARK} means the fixture changed in between, so that change is not like for like.`
    : 'Small print under each rate: cases passed / graded. The change against the previous keyed run appears once there is one.';
  const failing = views.filter((v) => v.gate.kind === 'failed').length;
  const lede = `${failing ? `<strong class="t-bad">${plural(failing, 'gated metric')} failing</strong>` : '<strong>No gated metric is failing</strong>'} across ${plural(views.length, 'metric')}. One row per metric, one column per way of grading it. Read left to right: the <strong>fallback</strong> columns are the deterministic fallback and carry the gate; the <strong>model</strong> columns are the same cases through Gemini. ${vs}`;
  return `<section class="section-block" aria-labelledby="score-h">
    ${sectionHead('score-h', 'Calibration', 'What did every metric score, on every path?', lede)}
    <div class="fields-wrap"><table class="fields score-table">
      <thead><tr><th>Metric</th>${LANE_ORDER.map((k) => `<th>${escapeHtml(LANE_LABEL[k])}</th>`).join('')}<th>Gate</th><th>What it means</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Trends — the same rates across keyed runs, columns labelled by what changed
// ---------------------------------------------------------------------------------------

/** What a column's prompts changed from the column before it: `scout 0.05 · judge 0.05`, or `same prompts`. */
export function versionChanges(run: RunHistoryEntry, prev: RunHistoryEntry | undefined): string {
  if (!prev) return Object.entries(run.promptVersions).map(([k, v]) => `${k} ${shortVersion(v)}`).join(' · ');
  const changed = Object.entries(run.promptVersions)
    .filter(([k, v]) => prev.promptVersions[k] !== v)
    .map(([k, v]) => `${k} ${shortVersion(v)}`);
  return changed.length ? changed.join(' · ') : 'same prompts';
}

export function trendHead(run: RunHistoryEntry, prev: RunHistoryEntry | undefined, current: boolean): string {
  const drift = run.drift.length ? `<small class="t-bad">drift: ${escapeHtml(run.drift.join(', '))}</small>` : '';
  const title = [run.id, run.label ?? '', `models: ${run.models?.agent ?? '–'} / ${run.models?.judge ?? '–'}`, run.git.commit ? `commit ${run.git.commit}${run.git.dirty ? '*' : ''}` : ''].filter(Boolean).join('\n');
  return `<th class="${current ? 'current' : ''}" title="${escapeHtml(title)}"><time datetime="${escapeHtml(run.generatedAt)}">${escapeHtml(shortStamp(run.generatedAt))}</time>${current ? '<small class="now">this run</small>' : ''}<small>${escapeHtml(versionChanges(run, prev))}</small>${drift}</th>`;
}

export function renderTrends(views: MetricView[], report: EvalReport, history: RunHistoryEntry[]): string {
  const runs = withCurrent(report, history).slice(-TREND_WINDOW);
  const currentId = report.run?.id;
  if (runs.length < 2) {
    return `<section class="section-block" id="trends" aria-labelledby="trend-h">${sectionHead(
      'trend-h',
      'Calibration',
      'Are the rates moving, and why?',
      runs.length === 0 ? 'No keyed run is recorded yet. Each run that calls a judge or a model is appended to <code>experiments/log.jsonl</code> and appears here.' : 'One keyed run so far. The trend appears after the next one.',
    )}</section>`;
  }
  const head = runs.map((r, i) => trendHead(r, runs[i - 1], r.id === currentId)).join('');
  const rows: string[] = [];
  for (const v of views) {
    for (const key of LANE_ORDER) {
      if (!v.lanes.some((l) => l.key === key)) continue;
      const rates = runs.map((r) => {
        const s = r.summaries.find((m) => m.metric === v.summary.metric);
        return s ? laneRateOf(s, key) : null;
      });
      if (rates.every((x) => x === null)) continue;
      const target = key === gatedLaneKey(v.summary) ? v.gate.target : undefined;
      const cells = rates
        .map((rate, i) => {
          if (rate === null) return '<td class="none">Not evaluated</td>';
          const mark = i > 0 && fixtureChanged(v.def, runs[i], runs[i - 1]) ? FIXTURE_MARK : '';
          return `<td class="t-${toneFor(rate, target)} ${runs[i].id === currentId ? 'current' : ''}"><b>${pct(rate)}</b>${mark}</td>`;
        })
        .join('');
      rows.push(`<tr><th scope="row">${metricLink(v)}<small>${escapeHtml(LANE_LABEL[key])}${target !== undefined ? ` · gate ≥ ${pct(target)}` : ''}</small></th>${cells}</tr>`);
    }
  }
  return `<section class="section-block" id="trends" aria-labelledby="trend-h">
    ${sectionHead('trend-h', 'Calibration', 'Are the rates moving, and why?', `The last <strong>${plural(runs.length, 'keyed run')}</strong>, oldest first, from <code>experiments/log.jsonl</code> and the local <code>runs/</code>. Each column head names the prompts that changed since the column before it — a rate that moves under <em>same prompts</em> is model variance, not an improvement. ${FIXTURE_MARK} marks a fixture change between two columns; <span class="t-bad">drift</span> names a prompt edited without a version bump.`)}
    <div class="fields-wrap"><table class="fields trend-table"><thead><tr><th>Metric · lane</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Run facts — what this run is, what it is compared with, what the judge cache saved
// ---------------------------------------------------------------------------------------

/** The run id, label, keyed-run count, comparison run, judge-cache hits, commit and models, as a key/value strip. */
export function runFacts(report: EvalReport, history: RunHistoryEntry[]): string {
  const keyed = withCurrent(report, history);
  const prev = previousKeyedRun(report, history);
  const run = report.run;
  const cache = report.judgeCache;
  const facts = [
    run ? `<span class="kv"><span>Run</span> <code>${escapeHtml(run.id)}</code></span>` : '<span class="kv"><span>Run</span> unkeyed (heuristics only)</span>',
    run?.label ? `<span class="kv"><span>Label</span> ${escapeHtml(run.label)}</span>` : '',
    `<span class="kv"><span>Keyed runs</span> ${keyed.length}</span>`,
    prev ? `<span class="kv"><span>Compared with</span> <code>${escapeHtml(prev.id)}</code></span>` : '',
    cache ? `<span class="kv"><span>Judge cache</span> ${cache.hits} hit${cache.hits === 1 ? '' : 's'}, ${cache.misses} miss${cache.misses === 1 ? '' : 'es'}</span>` : '',
    run?.git.commit ? `<span class="kv"><span>Commit</span> <code>${escapeHtml(run.git.commit)}${run.git.dirty ? '*' : ''}</code></span>` : '',
    renderModels(report),
  ].filter(Boolean);
  return `<div class="run">${facts.join('')}</div>`;
}

/** Names what changed between this run and the one it is compared with, when a Δ would not be like for like. */
export function comparisonWarning(report: EvalReport, prev: RunHistoryEntry): string {
  const run = report.run;
  if (!run) return '';
  const prompts = Object.entries(run.promptVersions)
    .filter(([k, v]) => prev.promptVersions[k] !== undefined && prev.promptVersions[k] !== v)
    .map(([k, v]) => `${k} ${shortVersion(prev.promptVersions[k] ?? '')} → ${shortVersion(v)}`);
  const fixtures = run.fixtures && prev.fixtures ? Object.keys(run.fixtures).filter((k) => prev.fixtures?.[k] !== undefined && prev.fixtures[k] !== run.fixtures?.[k]) : [];
  if (!prompts.length && !fixtures.length) return '';
  const parts = [prompts.length ? `prompts changed (${prompts.join(', ')})` : '', fixtures.length ? `${fixtures.length === 1 ? 'a fixture file' : `${fixtures.length} fixture files`} changed (${fixtures.join(', ')})` : ''].filter(Boolean);
  return ` <span class="t-warn">Not like for like: ${escapeHtml(parts.join(' and '))} — a Δ there reflects the change as much as the agent.</span>`;
}

/** One sentence on what every Δ on the scoreboard is measured against. */
export function runClaim(report: EvalReport, history: RunHistoryEntry[]): string {
  const prev = previousKeyedRun(report, history);
  if (prev) return `This run is measured against <code>${escapeHtml(prev.id)}</code>; every Δ on the scoreboard is that comparison, marked † where the fixture changed in between.${comparisonWarning(report, prev)}`;
  return withCurrent(report, history).length
    ? 'This is the first keyed run, so the scoreboard carries no Δ yet.'
    : 'An unkeyed run (fallback only) is not recorded in the experiment log and carries no Δ.';
}
