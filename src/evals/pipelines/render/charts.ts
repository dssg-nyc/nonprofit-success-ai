/**
 * Every inline SVG on the page comes from here: the grouped bars (agent × lane on the
 * overview, dimension × lane on an agent tab), the line chart across keyed runs, the
 * fallback-vs-model dumbbell and sparkline cells of the metric table, the judge strip plot,
 * the latency bars and the judge-score scatter. Marks are thin, data-ends rounded, text
 * wears text tokens (never a series colour), and every mark carries a <title> for hover.
 * Series colours are CSS classes (`.s-0` … `.s-3`: fallback navy, model teal, then lighter
 * tints of each; the light-only theme owns the palette, and red, amber and green are kept
 * for fail, warn and pass).
 */

import type { CalibrationResult, EvalReport } from '../../types';
import type { RunHistoryEntry } from '../history';
import { fixtureChanged, laneRateOf } from './keyed';
import { escapeHtml, laneOfGrade, laneTone, pairedLanes, pct, plural } from './views';
import type { Lane, MetricView } from './views';

export interface BarSeries {
  key: string;
  label: string;
}

export interface BarValue {
  rate: number;
  /** Counts shown at the tip beside the rate: `17/20`. */
  n: string;
}

export interface BarGroup {
  label: string;
  href?: string;
  /** One entry per series; null when that series has no value for this group. */
  values: Array<BarValue | null>;
}

const GB_LABEL_W = 160;
const GB_PLOT_W = 360;
const GB_TIP_W = 90;
const GB_BAR_H = 12;
const GB_GAP = 2;
const GB_PAD = 8;

const r1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/** A horizontal bar with a 4px rounded data-end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w, h / 2);
  return `M${r1(x)} ${r1(y)}h${r1(w - r)}a${r} ${r} 0 0 1 ${r} ${r}v${r1(h - 2 * r)}a${r} ${r} 0 0 1 -${r} ${r}h-${r1(w - r)}z`;
}

/**
 * Grouped horizontal bars: one group per row label, one bar per series within it, a
 * target line when there is one, and the rate · counts at every tip (the number is the
 * point of this chart, so every bar is labelled). The legend is rendered beside it in HTML.
 */
export function groupedBars(groups: BarGroup[], series: BarSeries[], opts: { target?: number; caption: string } = { caption: '' }): string {
  if (groups.length === 0) return '';
  const rowH = series.length * (GB_BAR_H + GB_GAP) + GB_PAD;
  const height = groups.length * rowH + GB_PAD;
  const width = GB_LABEL_W + GB_PLOT_W + GB_TIP_W;
  const x0 = GB_LABEL_W;
  const rows = groups.map((g, gi) => {
    const top = GB_PAD + gi * rowH;
    const bars = series.map((s, si) => {
      const y = top + si * (GB_BAR_H + GB_GAP);
      const v = g.values[si] ?? null;
      const title = `${g.label} — ${s.label}: ${v ? `${pct(v.rate)} (${v.n})` : 'not run'}`;
      if (!v) return `<g class="gb-row"><title>${escapeHtml(title)}</title><text class="tip none" x="${x0 + 4}" y="${r1(y + GB_BAR_H - 2)}">not evaluated</text></g>`;
      const w = Math.max(1, v.rate * GB_PLOT_W);
      return `<g class="gb-row"><title>${escapeHtml(title)}</title><path class="gb s-${si}" d="${barPath(x0, y, w, GB_BAR_H)}"/><text class="tip" x="${r1(x0 + w + 4)}" y="${r1(y + GB_BAR_H - 2)}">${pct(v.rate)} <tspan class="n">${escapeHtml(v.n)}</tspan></text></g>`;
    });
    const label = g.href ? `<a href="${escapeHtml(g.href)}"><text class="label" x="${x0 - 8}" y="${r1(top + (rowH - GB_PAD) / 2 + 4)}">${escapeHtml(g.label)}</text></a>` : `<text class="label" x="${x0 - 8}" y="${r1(top + (rowH - GB_PAD) / 2 + 4)}">${escapeHtml(g.label)}</text>`;
    return `${label}${bars.join('')}`;
  });
  const target = opts.target !== undefined
    ? `<line class="target-line" x1="${r1(x0 + opts.target * GB_PLOT_W)}" x2="${r1(x0 + opts.target * GB_PLOT_W)}" y1="2" y2="${height - 2}"><title>target ${pct(opts.target)}</title></line>`
    : '';
  const axis = [0, 0.5, 1].map((t) => `<line class="grid" x1="${x0 + t * GB_PLOT_W}" x2="${x0 + t * GB_PLOT_W}" y1="2" y2="${height - 2}"/>`).join('');
  return `<svg class="gbars" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(opts.caption)}"><title>${escapeHtml(opts.caption)}</title>${axis}${rows.join('')}${target}</svg>`;
}

/** The HTML legend that always accompanies a multi-series chart. */
export function legend(series: BarSeries[]): string {
  if (series.length < 2) return '';
  return `<ul class="legend-row">${series.map((s, i) => `<li><i class="sw s-${i}"></i>${escapeHtml(s.label)}</li>`).join('')}</ul>`;
}

export interface LineSeries {
  key: string;
  label: string;
  /** One per run, in run order; null where the series was not measured. */
  values: Array<number | null>;
}

export interface LineRun {
  label: string;
  /** What changed before this run (prompt versions, fixture hashes): drawn as a tick. */
  change?: string;
}

const LC_W = 600;
const LC_H = 170;
const LC_L = 40;
const LC_R = 110;
const LC_T = 10;
const LC_B = 30;

/**
 * Rates across keyed runs, one 2px line per series with a marker per measured run, a
 * tick wherever prompts or fixtures changed, and the series name at its line end. Y is
 * always 0–100% so two charts compare.
 */
export function lineChart(runs: LineRun[], series: LineSeries[], caption: string): string {
  if (runs.length === 0 || series.length === 0) return '';
  const plotW = LC_W - LC_L - LC_R;
  const plotH = LC_H - LC_T - LC_B;
  const x = (i: number) => LC_L + (runs.length === 1 ? plotW / 2 : (i / (runs.length - 1)) * plotW);
  const y = (v: number) => LC_T + (1 - v) * plotH;
  const grid = [0, 0.5, 1].map((t) => `<line class="grid" x1="${LC_L}" x2="${LC_L + plotW}" y1="${r1(y(t))}" y2="${r1(y(t))}"/><text class="tick" x="${LC_L - 6}" y="${r1(y(t) + 3)}">${pct(t)}</text>`).join('');
  const ticks = runs.map((r, i) => (r.change ? `<line class="change" x1="${r1(x(i))}" x2="${r1(x(i))}" y1="${LC_T}" y2="${LC_T + plotH}"><title>${escapeHtml(r.change)}</title></line>` : '')).join('');
  const labels = runs.map((r, i) => `<text class="tick x" x="${r1(x(i))}" y="${LC_H - 8}">${escapeHtml(r.label)}</text>`).join('');
  const lines = series.map((s, si) => {
    const pts = s.values.map((v, i) => (v === null ? null : { x: x(i), y: y(v), v, i })).filter((p): p is { x: number; y: number; v: number; i: number } => p !== null);
    if (pts.length === 0) return '';
    const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${r1(p.x)} ${r1(p.y)}`).join('');
    const dots = pts.map((p) => `<circle class="pt s-${si}" cx="${r1(p.x)}" cy="${r1(p.y)}" r="4"><title>${escapeHtml(`${s.label} · ${runs[p.i]?.label ?? ''}: ${pct(p.v)}`)}</title></circle>`).join('');
    const end = pts[pts.length - 1];
    if (!end) return '';
    return `<g class="series"><path class="line s-${si}" d="${d}"/>${dots}<text class="end-label" x="${r1(end.x + 8)}" y="${r1(end.y + 3)}">${escapeHtml(s.label)} ${pct(end.v)}</text></g>`;
  });
  return `<svg class="linechart" viewBox="0 0 ${LC_W} ${LC_H}" role="img" aria-label="${escapeHtml(caption)}"><title>${escapeHtml(caption)}</title>${grid}${ticks}${labels}${lines.join('')}</svg>`;
}

// ---------------------------------------------------------------------------------------
// Metric-table cells: dumbbell and sparkline
// ---------------------------------------------------------------------------------------

export const DUMBBELL_W = 150;

/**
 * Fallback dot, model dot, and the bar they are measured against on one 0–100% rail. The
 * gap between the dots is the fallback contract made visible; the bar is the gate target,
 * or the 90% colour threshold (drawn soft) when the metric is ungated.
 */
export function dumbbellCell(view: MetricView, template: Lane | undefined, model: Lane | undefined): string {
  const rate = (lane: Lane | undefined) => (lane && lane.ran && lane.rate !== null ? lane.rate : null);
  const t = rate(template);
  const m = rate(model);
  if (t === null && m === null) return '<td class="ov none" title="Neither path was evaluated">Not evaluated</td>';
  const x = (r: number) => (6 + r * (DUMBBELL_W - 12)).toFixed(1);
  const bar = view.gate.target ?? 0.9;
  const parts = [`<line class="rail" x1="6" x2="${DUMBBELL_W - 6}" y1="10" y2="10"/>`];
  parts.push(`<line class="bar${view.gate.target === undefined ? ' soft' : ''}" x1="${x(bar)}" x2="${x(bar)}" y1="3" y2="17"/>`);
  if (t !== null && m !== null) parts.push(`<line class="gap" x1="${x(t)}" x2="${x(m)}" y1="10" y2="10"/>`);
  if (t !== null && template) parts.push(`<circle class="dot template t-fill-${laneTone(view, template)}" cx="${x(t)}" cy="10" r="5"/>`);
  if (m !== null && model) parts.push(`<circle class="dot model t-stroke-${laneTone(view, model)}" cx="${x(m)}" cy="10" r="4.5"/>`);
  const title = [
    t !== null ? `fallback ${pct(t)}` : 'fallback not measured',
    m !== null ? `model ${pct(m)}` : 'model not measured',
    `${view.gate.target === undefined ? 'bar' : 'gate'} ${pct(bar)}`,
  ].join(' · ');
  return `<td class="ov chart"><svg class="dumbbell" viewBox="0 0 ${DUMBBELL_W} 20" role="img" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title>${parts.join('')}</svg></td>`;
}

export const SPARK_W = 96;
export const SPARK_H = 22;

/** Whether the prompts behind a lane changed between two runs: the agent's, and the judge's for a judged lane. */
export function promptsChanged(view: MetricView, judged: boolean, run: RunHistoryEntry, prev: RunHistoryEntry): boolean {
  const keys = [view.agent.toLowerCase(), ...(judged ? ['judge'] : [])];
  return keys.some((k) => run.promptVersions[k] !== prev.promptVersions[k]);
}

/**
 * The same two lanes across the last keyed runs: fallback solid, model dashed, a tick on
 * every run whose prompts or fixture changed since the one before — the point where the
 * line stops being like for like.
 */
export function sparklineCell(view: MetricView, runs: RunHistoryEntry[]): string {
  if (runs.length < 2) return '<td class="ov none" title="Appears after the second keyed run">one run</td>';
  const { template, model } = pairedLanes(view);
  const series = (lane: Lane | undefined): Array<number | null> =>
    lane
      ? runs.map((r) => {
          const s = r.summaries.find((x) => x.metric === view.summary.metric);
          return s ? laneRateOf(s, lane.key) : null;
        })
      : runs.map(() => null);
  const t = series(template);
  const m = series(model);
  const points = (values: Array<number | null>) => values.filter((x) => x !== null).length;
  if (points(t) === 0 && points(m) === 0) return '<td class="ov none" title="No keyed run measured this metric">Not evaluated</td>';
  if (points(t) < 2 && points(m) < 2) return '<td class="ov none" title="Measured in one keyed run so far; the line appears with the next">new</td>';
  const px = (i: number) => (4 + (i * (SPARK_W - 8)) / (runs.length - 1)).toFixed(1);
  const py = (r: number) => (SPARK_H - 3 - r * (SPARK_H - 6)).toFixed(1);
  const path = (values: Array<number | null>): string => {
    let d = '';
    let pen = false;
    values.forEach((r, i) => {
      if (r === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${px(i)} ${py(r)}`;
      pen = true;
    });
    return d;
  };
  const last = (values: Array<number | null>, cls: string): string => {
    const i = values.length - 1;
    const r = values[i];
    return r === null ? '' : `<circle class="${cls}" cx="${px(i)}" cy="${py(r)}" r="2"/>`;
  };
  const breaks = runs
    .map((r, i) => (i > 0 && (fixtureChanged(view.def, r, runs[i - 1]) || promptsChanged(view, template?.kind === 'judge', r, runs[i - 1])) ? i : -1))
    .filter((i) => i >= 0);
  const ticks = breaks.map((i) => `<line class="break" x1="${px(i)}" x2="${px(i)}" y1="1" y2="${SPARK_H - 1}"/>`).join('');
  const fmt = (values: Array<number | null>) => values.map((r) => (r === null ? 'n/a' : pct(r))).join(' → ');
  const title = [
    `${runs.length} keyed runs, oldest first`,
    template && !t.every((x) => x === null) ? `fallback ${fmt(t)}` : '',
    model && !m.every((x) => x === null) ? `model ${fmt(m)}` : '',
    breaks.length ? `${plural(breaks.length, 'break')}: prompts or fixture changed, so the runs either side are not like for like` : 'same prompts and fixture throughout',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<td class="ov chart"><svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" role="img" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title>${ticks}${points(m) ? `<path class="line model" d="${path(m)}"/>` : ''}${points(t) ? `<path class="line template" d="${path(t)}"/>` : ''}${last(m, 'end model')}${last(t, 'end template')}</svg></td>`;
}


export const STRIP_W = 320;
export const STRIP_L = 74;
export const STRIP_DOT_R = 4;

/**
 * Judge scores on a 0–1 rail, one rail per hand label: outputs a reader passed (green)
 * above, outputs a reader failed (red) below, the pass threshold drawn as one vertical
 * line through both. Dots stack where scores tie. The two kinds of miss read at a glance:
 * a red dot at or right of the line is lenient, a green dot left of it is harsh.
 */
export function stripPlot(judge: string, rows: CalibrationResult[], threshold = 1): string {
  const graded = rows.filter((r) => r.verdict.status === 'graded');
  if (graded.length === 0) return '';
  const r = STRIP_DOT_R;
  const step = r * 2 + 2;
  const lanes = (['pass', 'fail'] as const).map((label) => {
    const own = graded.filter((row) => row.expected.isCorrect === (label === 'pass'));
    const stacks = new Map<string, CalibrationResult[]>();
    for (const row of own) {
      const key = row.verdict.score.toFixed(2);
      stacks.set(key, [...(stacks.get(key) ?? []), row]);
    }
    const depth = Math.max(1, ...[...stacks.values()].map((s) => s.length));
    return { label, stacks, height: 8 + depth * step };
  });
  const H = lanes.reduce((a, l) => a + l.height, 0) + 18;
  const x = (score: number) => (STRIP_L + r + score * (STRIP_W - STRIP_L - 2 * r - 6)).toFixed(1);
  let top = 4;
  const body = lanes.map((lane) => {
    const bottom = top + lane.height - 4;
    const dots = [...lane.stacks.values()]
      .flatMap((s) =>
        s.map((row, i) => {
          const kind = row.agreed === false ? (row.verdict.isCorrect ? 'lenient' : 'harsh') : 'agreed';
          const title = `${row.id} — reader: ${lane.label}; judge: ${row.verdict.isCorrect ? 'pass' : 'fail'} (score ${row.verdict.score.toFixed(2)}) — ${kind}`;
          return `<circle class="dot label-${lane.label} ${kind}" cx="${x(row.verdict.score)}" cy="${(bottom - r - i * step).toFixed(1)}" r="${r}"><title>${escapeHtml(title)}</title></circle>`;
        }),
      )
      .join('');
    const out = `<text class="lane" x="${STRIP_L - 8}" y="${(bottom - 1).toFixed(1)}" text-anchor="end">Reader: ${lane.label}</text><line class="rail" x1="${x(0)}" x2="${x(1)}" y1="${bottom}" y2="${bottom}"/>${dots}`;
    top += lane.height;
    return out;
  });
  const ticks = [0, 0.5, 1].map((v) => `<text class="tick" x="${x(v)}" y="${H - 3}" text-anchor="middle">${v}</text>`).join('');
  return `<figure class="stripplot">
    <svg viewBox="0 0 ${STRIP_W} ${H}" role="img" aria-label="${escapeHtml(`${judge}: judge score per hand-labelled output, outputs a reader passed on the top rail in green, outputs a reader failed on the bottom rail in red; the pass threshold is at ${threshold}`)}">
      ${body.join('')}
      <line class="pass-line" x1="${x(threshold)}" x2="${x(threshold)}" y1="2" y2="${H - 14}"><title>pass threshold ${threshold}</title></line>
      ${ticks}
    </svg>
  </figure>`;
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export type LatencyGroup = NonNullable<EvalReport['latency']>[number];

/**
 * Horizontal bars of p50 with a tick at p95, one row per call group, slowest first. Agent
 * and judge groups get their own chart because they are on different scales and answer
 * different questions: an agent's latency is what a partner waits on in the portal; a
 * judge's is only the harness's cost.
 */
export function latencyChart(groups: LatencyGroup[], label: string): string {
  if (groups.length === 0) return '';
  const sorted = [...groups].sort((a, b) => b.p50Ms - a.p50Ms);
  const LABEL_W = 230;
  const BAR_W = 330;
  const ROW_H = 26;
  const max = Math.max(...sorted.map((g) => g.p95Ms), 1);
  const w = (ms: number) => (ms / max) * BAR_W;
  const rows = sorted
    .map((g, i) => {
      const yTop = i * ROW_H + 4;
      const name = `${g.agent} · ${g.promptVersion}`;
      return `<g transform="translate(0 ${yTop})">
        <text class="label" x="${LABEL_W - 8}" y="13" text-anchor="end"><title>${escapeHtml(`${name} · ${g.model} · ${g.n} calls`)}</title>${escapeHtml(name)}</text>
        <rect class="p50 ${g.role}" x="${LABEL_W}" y="3" width="${w(g.p50Ms).toFixed(1)}" height="14" rx="2"/>
        <line class="p95" x1="${(LABEL_W + w(g.p95Ms)).toFixed(1)}" x2="${(LABEL_W + w(g.p95Ms)).toFixed(1)}" y1="0" y2="20"/>
        <text class="val" x="${(LABEL_W + w(g.p95Ms) + 6).toFixed(1)}" y="14">p50 ${secs(g.p50Ms)} · p95 ${secs(g.p95Ms)}${g.nFailed ? ` · ${g.nFailed} failed` : ''}</text>
      </g>`;
    })
    .join('');
  const height = sorted.length * ROW_H + 8;
  return `<figure class="latency-chart">
    <figcaption>${escapeHtml(label)}</figcaption>
    <svg viewBox="0 0 ${LABEL_W + BAR_W + 150} ${height}" role="img" aria-label="${escapeHtml(label)}: p50 bar with a tick at p95, per call group">${rows}</svg>
  </figure>`;
}


/**
 * One point per case where the judge scored both texts: fallback score across, model
 * score up. Scores are banded (1, 0.5, 0.2), so points stack — the circle grows with the
 * count and its tooltip lists the cases. Above the diagonal the model text did better.
 */
export function renderScatter(view: MetricView): string {
  const pairs: Array<{ caseId: string; t: number; m: number }> = [];
  for (const row of view.rows) {
    const t = row.grades.find((g) => laneOfGrade(g) === 'judge' && g.status === 'graded');
    const m = row.grades.find((g) => laneOfGrade(g) === 'modelJudge' && g.status === 'graded');
    if (t && m) pairs.push({ caseId: row.caseId, t: t.score, m: m.score });
  }
  if (pairs.length === 0) return '';
  const better = pairs.filter((p) => p.m > p.t).length;
  const worse = pairs.filter((p) => p.m < p.t).length;
  const stacks = new Map<string, { t: number; m: number; cases: string[] }>();
  for (const p of pairs) {
    const key = `${p.t.toFixed(2)}|${p.m.toFixed(2)}`;
    const s = stacks.get(key) ?? { t: p.t, m: p.m, cases: [] };
    s.cases.push(p.caseId);
    stacks.set(key, s);
  }
  // Margins hold the largest stacked circle (r 12) at a corner score of 1 or 0.
  const X0 = 34;
  const Y0 = 14;
  const SIDE = 150;
  const x = (v: number) => X0 + v * SIDE;
  const y = (v: number) => Y0 + SIDE - v * SIDE;
  const points = [...stacks.values()]
    .map((s) => {
      const r = Math.min(12, 4 + 2 * Math.sqrt(s.cases.length - 1));
      const cls = s.m > s.t ? 'better' : s.m < s.t ? 'worse' : 'tie';
      const title = `${s.cases.length === 1 ? s.cases[0] : `${s.cases.length} cases: ${s.cases.join(', ')}`} — fallback ${s.t.toFixed(2)}, model ${s.m.toFixed(2)}`;
      return `<circle class="pt ${cls}" cx="${x(s.t).toFixed(1)}" cy="${y(s.m).toFixed(1)}" r="${r.toFixed(1)}"><title>${escapeHtml(title)}</title></circle>${
        s.cases.length > 1 ? `<text class="n" x="${x(s.t).toFixed(1)}" y="${(y(s.m) + 3).toFixed(1)}">${s.cases.length}</text>` : ''
      }`;
    })
    .join('');
  const ticks = [0, 0.5, 1]
    .map(
      (v) =>
        `<text class="tick" x="${x(v).toFixed(1)}" y="${(Y0 + SIDE + 14).toFixed(1)}" text-anchor="middle">${v}</text>` +
        `<text class="tick" x="${(X0 - 6).toFixed(1)}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`,
    )
    .join('');
  return `<figure class="scatter">
    <figcaption><a href="#${escapeHtml(view.summary.metric)}">${escapeHtml(view.summary.metric)}</a><small>model better <b class="t-good">${better}</b> · worse <b class="t-bad">${worse}</b> · tie ${pairs.length - better - worse}</small></figcaption>
    <svg viewBox="0 0 ${X0 + SIDE + 16} ${Y0 + SIDE + 32}" role="img" aria-label="Judge score of the fallback text against the model text, per case, for ${escapeHtml(view.summary.metric)}">
      <rect class="plot" x="${X0}" y="${Y0}" width="${SIDE}" height="${SIDE}"/>
      <line class="diag" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>
      ${ticks}
      <text class="axis" x="${(X0 + SIDE / 2).toFixed(1)}" y="${(Y0 + SIDE + 28).toFixed(1)}" text-anchor="middle">fallback text</text>
      <text class="axis" x="10" y="${(Y0 + SIDE / 2).toFixed(1)}" text-anchor="middle" transform="rotate(-90 10 ${(Y0 + SIDE / 2).toFixed(1)})">model text</text>
      ${points}
    </svg>
  </figure>`;
}
