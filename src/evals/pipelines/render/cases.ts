/**
 * Per-case detail. Every case is a <details class="case"> with its id, note and one pill
 * per lane in the summary, so the filter and the anchors work on server-rendered DOM.
 * Failing and errored cases carry their body inline — expected, got, reasoning — because
 * they are what a reader opens and what the triage links to. Everything heavy goes into
 * one JSON blob (`<script type="application/json">`): the passing cases' grades as compact
 * records, every distinct agent output stored once, every distinct expected block stored
 * once. `CASE_SCRIPT` builds the same markup in the browser on first expand.
 */

import { gzipSync } from 'node:zlib';

import type { EvalCase, GradedRow, GraderResult } from '../../types';
import { caseAnchor, escapeHtml, LANE_LABEL, laneOfGrade, PILL_LABEL, plural } from './views';
import type { Lane, LaneKey, MetricView, Tone } from './views';

export type CaseState = 'fail' | 'errored' | 'pass' | 'none';

/** A failing verdict anywhere makes the case failing; errored only when nothing failed. */
export function caseState(row: GradedRow): CaseState {
  if (row.grades.some((g) => g.status === 'graded' && !g.isCorrect)) return 'fail';
  if (row.grades.some((g) => g.status === 'errored')) return 'errored';
  if (row.grades.length > 0) return 'pass';
  return 'none';
}

export const STATE_ORDER: Record<CaseState, number> = { fail: 0, errored: 1, none: 2, pass: 3 };

export function pill(lane: Lane, g: GraderResult | undefined): string {
  const name = escapeHtml(PILL_LABEL[lane.key]);
  if (!g) return `<span class="pill absent" title="${lane.ran ? 'not run for this case' : 'skipped — no model key'}">${name}: —</span>`;
  if (g.status === 'errored') return `<span class="pill errored" title="${escapeHtml(g.error ?? 'errored')}">${name}: errored</span>`;
  const score = lane.kind === 'judge' ? ` ${g.score.toFixed(2)}` : '';
  return `<span class="pill ${g.isCorrect ? 'pass' : 'fail'}">${name}: ${g.isCorrect ? 'pass' : 'fail'}${score}</span>`;
}

/** `field=got (expected want)` pairs from a heuristic's reasoning; null when it is not that shape. */
export function parseComparisons(reasoning: string): Array<{ field: string; got: string; expected: string }> | null {
  const re = /([A-Za-z0-9_]+)=(.*?) \(expected (.*?)\)(?=, [A-Za-z0-9_]+=|$)/g;
  const out: Array<{ field: string; got: string; expected: string }> = [];
  for (const m of reasoning.matchAll(re)) out.push({ field: m[1], got: m[2], expected: m[3] });
  return out.length ? out : null;
}

export function renderComparisonTable(reasoning: string): string {
  const pairs = parseComparisons(reasoning);
  if (!pairs) return reasoning ? `<p class="reasoning">${escapeHtml(reasoning)}</p>` : '';
  const norm = (s: string) => s.replace(/^\[|\]$/g, '').trim();
  const body = pairs
    .map((p) => {
      const same = norm(p.got) === norm(p.expected) || (p.got === '[]' && p.expected === 'none');
      return `<tr class="${same ? 'match' : 'mismatch'}"><th scope="row">${escapeHtml(p.field)}</th><td>${escapeHtml(p.got)}</td><td>${escapeHtml(p.expected)}</td><td aria-label="${same ? 'matches' : 'does not match'}">${same ? '✓' : '✗'}</td></tr>`;
    })
    .join('');
  return `<div class="fields-wrap"><table class="fields"><thead><tr><th>Field</th><th>Got</th><th>Expected</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderDims(dims: Record<string, number>): string {
  const entries = Object.entries(dims);
  if (!entries.length) return '';
  return `<ul class="dims">${entries
    .map(([k, v]) => {
      const tone: Tone = v >= 1 ? 'good' : v <= 0 ? 'bad' : 'warn';
      const shown = Number.isInteger(v) ? String(v) : v.toFixed(2);
      return `<li class="${v >= 1 ? 'ok' : v <= 0 ? 'miss' : 'partial'}"><span>${escapeHtml(k)}</span><span class="mini"><span class="t-bg-${tone}" style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></span></span><b>${shown}</b></li>`;
    })
    .join('')}</ul>`;
}

/** Values stored once and referred to by index; the same output is graded by several metrics. */
export class Store<T> {
  readonly items: T[] = [];
  private readonly index = new Map<string, number>();

  add(item: T, key: string = typeof item === 'string' ? item : JSON.stringify(item)): number {
    const found = this.index.get(key);
    if (found !== undefined) return found;
    this.items.push(item);
    this.index.set(key, this.items.length - 1);
    return this.items.length - 1;
  }
}

/** A string output is stored HTML-escaped (filled as HTML); anything else stays a value the page pretty-prints as text. */
export type StoredOutput = string | { v: unknown };
export type OutputStore = Store<StoredOutput>;

const storedOutput = (output: unknown): StoredOutput => (typeof output === 'string' ? escapeHtml(output) : { v: output });

export function renderOutput(output: unknown, store?: OutputStore): string {
  if (output === undefined || output === null) return '';
  const pre = store
    ? `<pre data-o="${store.add(storedOutput(output))}"></pre>`
    : `<pre>${typeof output === 'string' ? escapeHtml(output) : escapeHtml(JSON.stringify(output, null, 2))}</pre>`;
  return `<details class="output"><summary>What the agent produced</summary>${pre}</details>`;
}

export function renderGradeDetail(lane: Lane, g: GraderResult | undefined, store?: OutputStore): string {
  const head = `<h4>${escapeHtml(lane.label)}</h4>`;
  if (!g) return `<div class="grade absent">${head}<p class="muted">${lane.ran ? 'Not run for this case.' : 'Skipped — no model key for this run.'}</p></div>`;
  if (g.status === 'errored') {
    return `<div class="grade errored">${head}<p><span class="pill errored">errored</span> <code>${escapeHtml(g.error ?? 'unknown')}</code> — no verdict, so this case is left out of the rate.</p>${
      g.reasoning ? `<p class="reasoning">${escapeHtml(g.reasoning)}</p>` : ''
    }${renderOutput(g.output, store)}</div>`;
  }
  // Absent on template exact-match rows (deterministic, reproducible from the fixture).
  const body =
    lane.kind === 'exact'
      ? renderComparisonTable(g.reasoning)
      : `${renderDims(g.dimensions)}${g.reasoning ? `<p class="reasoning"><span class="muted">Judge’s reasoning:</span> ${escapeHtml(g.reasoning)}</p>` : ''}`;
  return `<div class="grade ${g.isCorrect ? 'pass' : 'fail'}">${head}${body}${renderOutput(g.output, store)}</div>`;
}

const fmtExpected = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

export function renderExpected(evalCase: EvalCase | undefined): string {
  if (!evalCase) return '';
  const entries = Object.entries(evalCase.expected);
  if (!entries.length) return '';
  return `<div class="expected"><h4>Expected (from the fixture)</h4><dl>${entries
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(fmtExpected(v))}</dd>`)
    .join('')}</dl></div>`;
}

/** One lane of a passing case, as the blob stores it: lane key, then only what is set. */
interface CompactGrade {
  l: LaneKey;
  /** Absent lane: 1 when the lane ran this run (not for this case), 0 when skipped. */
  a?: 0 | 1;
  /** Errored: the error code. */
  x?: string;
  c?: 0 | 1;
  d?: Record<string, number>;
  r?: string;
  o?: number;
}

interface CompactCase {
  /** Index into `expected`, as `[key, shown]` pairs. */
  e?: number;
  g: CompactGrade[];
}

/** What the blob holds: shared outputs and expected blocks, passing cases keyed `metric:caseId`. */
export interface CaseBlob {
  outputs: OutputStore;
  expected: Store<Array<[string, string]>>;
  cases: Record<string, CompactCase>;
}

export const newBlob = (): CaseBlob => ({ outputs: new Store(), expected: new Store(), cases: {} });

export const blobKey = (metric: string, caseId: string): string => `${metric}:${caseId}`;

function compactGrade(lane: Lane, g: GraderResult | undefined, store: OutputStore): CompactGrade {
  if (!g) return { l: lane.key, a: lane.ran ? 1 : 0 };
  const out: CompactGrade = { l: lane.key };
  if (g.status === 'errored') out.x = g.error ?? 'unknown';
  else {
    out.c = g.isCorrect ? 1 : 0;
    if (Object.keys(g.dimensions).length) out.d = g.dimensions;
  }
  if (g.reasoning) out.r = g.reasoning;
  if (g.output !== undefined && g.output !== null) out.o = store.add(storedOutput(g.output));
  return out;
}

/** Lanes a case lost or errored on, and the dimensions it lost — the filter's data attributes. */
function failedOn(view: MetricView, byLane: Map<LaneKey, GraderResult>): { lanes: string[]; dims: string[] } {
  const lanes: string[] = [];
  const dims = new Set<string>();
  for (const lane of view.lanes) {
    const g = byLane.get(lane.key);
    if (!g) continue;
    if (g.status === 'errored' || !g.isCorrect) lanes.push(lane.key);
    if (g.status === 'graded') for (const [d, v] of Object.entries(g.dimensions)) if (v < 1) dims.add(d);
  }
  return { lanes, dims: [...dims] };
}

export function renderCase(view: MetricView, row: GradedRow, blob?: CaseBlob): string {
  const evalCase = view.cases.get(row.caseId);
  const state = caseState(row);
  const byLane = new Map(row.grades.map((g) => [laneOfGrade(g), g]));
  const note = evalCase?.note ?? '';
  const lost = failedOn(view, byLane);
  const metric = view.summary.metric;
  // A passing case's grades go to the blob and the page builds the body on expand; a
  // failing or errored one is inline, with its outputs shared through the blob.
  let body = '';
  if (blob && state === 'pass') {
    const entries = Object.entries(evalCase?.expected ?? {});
    const compact: CompactCase = { g: view.lanes.map((l) => compactGrade(l, byLane.get(l.key), blob.outputs)) };
    if (entries.length) compact.e = blob.expected.add(entries.map(([k, v]) => [k, fmtExpected(v)]));
    blob.cases[blobKey(metric, row.caseId)] = compact;
  } else {
    body = `<div class="case-body">${renderExpected(evalCase)}${view.lanes.map((l) => renderGradeDetail(l, byLane.get(l.key), blob?.outputs)).join('')}</div>`;
  }
  return `<details class="case s-${state}" id="${escapeHtml(caseAnchor(metric, row.caseId))}" data-state="${state}" data-search="${escapeHtml(row.caseId.toLowerCase())}"${lost.lanes.length ? ` data-lanes="${escapeHtml(lost.lanes.join(' '))}"` : ''}${lost.dims.length ? ` data-dims="${escapeHtml(lost.dims.join(' '))}"` : ''}><summary><span class="case-id"><code>${escapeHtml(row.caseId)}</code>${note ? `<span class="note">${escapeHtml(note)}</span>` : ''}</span><span class="pills">${view.lanes.map((l) => pill(l, byLane.get(l.key))).join('')}</span></summary>${body}</details>
`;
}

/** One metric's cases, failing first, under a count line; the filter bar lives on the tab. */
export function renderCases(view: MetricView, blob?: CaseBlob): string {
  if (view.rows.length === 0) return '<p class="muted">No cases graded.</p>';
  const rows = [...view.rows].sort((a, b) => STATE_ORDER[caseState(a)] - STATE_ORDER[caseState(b)]);
  const failing = rows.filter((r) => caseState(r) === 'fail').length;
  const errored = rows.filter((r) => caseState(r) === 'errored').length;
  return `<div class="cases" data-cases>
    <div class="cases-bar">
      <h4>${plural(rows.length, 'case')}${failing ? ` · <span class="t-bad">${failing} with a failing verdict</span>` : ''}${errored ? ` · <span class="t-err">${errored} errored</span>` : ''}</h4>
    </div>
    <div class="case-list">${rows.map((r) => renderCase(view, r, blob)).join('')}</div>
    <p class="muted no-match" hidden>No cases match.</p>
  </div>`;
}

/** A blob longer than this is gzipped: plain JSON stays greppable on small pages, big pages stay light. */
export const BLOB_PLAIN_LIMIT = 32_768;

/**
 * The blob as a script element. JSON is valid JS data; `<` is written as `\u003c` so no
 * string can close the tag, and the type attribute keeps the browser from executing it.
 * Past BLOB_PLAIN_LIMIT the JSON travels gzipped and base64-encoded as `{"gzip": …}`,
 * which the page inflates with the browser's own DecompressionStream.
 */
export function renderCaseBlob(blob: CaseBlob): string {
  const lanes = Object.fromEntries((Object.keys(LANE_LABEL) as LaneKey[]).map((k) => [k, { label: LANE_LABEL[k], exact: k === 'heuristic' || k === 'model' }]));
  const json = JSON.stringify({ lanes, outputs: blob.outputs.items, expected: blob.expected.items, cases: blob.cases });
  const payload = json.length > BLOB_PLAIN_LIMIT ? `{"gzip":"${gzipSync(Buffer.from(json, 'utf-8'), { level: 9 }).toString('base64')}"}` : json;
  return `<script type="application/json" id="case-data">${payload.replace(/</g, '\\u003c')}</script>`;
}

/**
 * The browser half: fills `pre[data-o]` from the shared outputs and builds a passing
 * case's body from its compact record with the same markup the server writes inline.
 */
export const CASE_SCRIPT = `
var data = null;
function inflate(b64) {
  if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser cannot inflate the page data (no DecompressionStream).'));
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
}
function caseData() {
  if (!data) {
    var el = document.getElementById('case-data');
    var parsed = el ? JSON.parse(el.textContent) : { lanes: {}, outputs: [], expected: [], cases: {} };
    data = parsed.gzip ? inflate(parsed.gzip) : Promise.resolve(parsed);
  }
  return data;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function fillOutputs(d, root) {
  root.querySelectorAll('pre[data-o]').forEach(function (p) {
    var o = d.outputs[+p.getAttribute('data-o')];
    if (typeof o === 'string') p.innerHTML = o; else p.textContent = JSON.stringify(o && o.v, null, 2);
    p.removeAttribute('data-o');
  });
}
function output(g) { return g.o === undefined ? '' : '<details class="output"><summary>What the agent produced</summary><pre data-o="' + g.o + '"></pre></details>'; }
function comparisons(r) {
  var re = /([A-Za-z0-9_]+)=(.*?) \\(expected (.*?)\\)(?=, [A-Za-z0-9_]+=|$)/g, m, out = [];
  while ((m = re.exec(r))) out.push({ field: m[1], got: m[2], expected: m[3] });
  if (!out.length) return r ? '<p class="reasoning">' + esc(r) + '</p>' : '';
  var norm = function (s) { return s.replace(/^\\[|\\]$/g, '').trim(); };
  return '<div class="fields-wrap"><table class="fields"><thead><tr><th>Field</th><th>Got</th><th>Expected</th><th></th></tr></thead><tbody>' + out.map(function (p) {
    var same = norm(p.got) === norm(p.expected) || (p.got === '[]' && p.expected === 'none');
    return '<tr class="' + (same ? 'match' : 'mismatch') + '"><th scope="row">' + esc(p.field) + '</th><td>' + esc(p.got) + '</td><td>' + esc(p.expected) + '</td><td aria-label="' + (same ? 'matches' : 'does not match') + '">' + (same ? '✓' : '✗') + '</td></tr>';
  }).join('') + '</tbody></table></div>';
}
function dims(d) {
  var keys = Object.keys(d || {});
  if (!keys.length) return '';
  return '<ul class="dims">' + keys.map(function (k) {
    var v = d[k], tone = v >= 1 ? 'good' : v <= 0 ? 'bad' : 'warn';
    return '<li class="' + (v >= 1 ? 'ok' : v <= 0 ? 'miss' : 'partial') + '"><span>' + esc(k) + '</span><span class="mini"><span class="t-bg-' + tone + '" style="width:' + Math.round(Math.max(0, Math.min(1, v)) * 100) + '%"></span></span><b>' + (Number.isInteger(v) ? v : v.toFixed(2)) + '</b></li>';
  }).join('') + '</ul>';
}
function gradeHtml(d, g) {
  var lane = d.lanes[g.l] || { label: g.l, exact: false };
  var head = '<h4>' + esc(lane.label) + '</h4>';
  if (g.a !== undefined) return '<div class="grade absent">' + head + '<p class="muted">' + (g.a ? 'Not run for this case.' : 'Skipped — no model key for this run.') + '</p></div>';
  if (g.x !== undefined) return '<div class="grade errored">' + head + '<p><span class="pill errored">errored</span> <code>' + esc(g.x) + '</code> — no verdict, so this case is left out of the rate.</p>' + (g.r ? '<p class="reasoning">' + esc(g.r) + '</p>' : '') + output(g) + '</div>';
  var body = lane.exact ? comparisons(g.r || '') : dims(g.d) + (g.r ? '<p class="reasoning"><span class="muted">Judge’s reasoning:</span> ' + esc(g.r) + '</p>' : '');
  return '<div class="grade ' + (g.c ? 'pass' : 'fail') + '">' + head + body + output(g) + '</div>';
}
function buildBody(d, details) {
  var id = details.id.slice(5), cut = id.indexOf('-');
  var c = d.cases[id.slice(0, cut) + ':' + id.slice(cut + 1)];
  var body = document.createElement('div');
  body.className = 'case-body';
  if (!c) { body.textContent = 'This case is not in the page data.'; details.appendChild(body); return; }
  var exp = c.e === undefined ? '' : '<div class="expected"><h4>Expected (from the fixture)</h4><dl>' + d.expected[c.e].map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd>'; }).join('') + '</dl></div>';
  body.innerHTML = exp + c.g.map(function (g) { return gradeHtml(d, g); }).join('');
  details.appendChild(body);
}
document.addEventListener('toggle', function (e) {
  var t = e.target;
  if (!t.open || !t.classList || !t.classList.contains('case')) return;
  caseData().then(function (d) {
    if (!t.querySelector('.case-body')) buildBody(d, t);
    fillOutputs(d, t);
  }, function (err) {
    if (!t.querySelector('.case-body')) { var p = document.createElement('p'); p.className = 'case-body muted'; p.textContent = err.message; t.appendChild(p); }
  });
}, true);
`;
