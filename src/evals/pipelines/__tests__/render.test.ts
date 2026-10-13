import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { METRICS } from '../../registry';
import { evalReportSchema, gradedRowSchema } from '../../types';
import type { CalibrationResult, EvalCase, EvalReport, GradedRow, GraderResult, RunManifest } from '../../types';
import type { RunHistoryEntry } from '../history';
import { parseComparisons, renderReport } from '../render';
import { loadFixtures } from '../run';

// The report is read by people deciding whether an agent is validated, so what it must
// get right is the distinction between four states a cell can be in: pass, fail, errored
// (excluded from the rate) and never run (no key). A skipped judge rendering as "n/a"
// beside a real 0% was the confusion this test pins down.

const summaryFor = (metric: string, over: Partial<EvalReport['summaries'][number]> = {}) => ({
  metric,
  nHeuristic: 0,
  nJudge: 0,
  heuristicPassRate: null,
  judgePassRate: null,
  judgeMeanScore: null,
  nJudgeErrored: 0,
  nModel: 0,
  nModelErrored: 0,
  modelPassRate: null,
  nModelJudge: 0,
  nModelJudgeErrored: 0,
  modelJudgePassRate: null,
  modelJudgeMeanScore: null,
  ...over,
});

const grade = (over: Partial<GraderResult>): GraderResult => ({
  caseId: 'case-1',
  metric: 'scoutRouting',
  grader: 'heuristic',
  status: 'graded',
  isCorrect: true,
  score: 1,
  reasoning: '',
  dimensions: {},
  ...over,
});

const report = (over: Partial<EvalReport>): EvalReport => ({
  generatedAt: '2026-10-06T00:00:00.000Z',
  nCases: 1,
  judgesRan: false,
  modelCallsRan: false,
  summaries: [],
  ...over,
});

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The HTML of one case, by its `data-search` (case id is its first word). */
const caseBlock = (html: string, caseId: string): string => {
  const start = html.indexOf(`data-search="${caseId.toLowerCase()}`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<details', start), html.indexOf('</details>', start));
};

describe('renderReport', () => {
  it('shows each heuristic dimension, flags the mismatched field, and keeps the fixture note', () => {
    const rows: GradedRow[] = [
      {
        caseId: 'case-1',
        metric: 'scoutRouting',
        grades: [
          grade({
            isCorrect: false,
            score: 0,
            reasoning: 'bucket=X (expected Y), composite_signal=Ready (expected Ready)',
            dimensions: { bucketMatch: 0, signalMatch: 1 },
          }),
        ],
      },
    ];
    const html = renderReport({
      report: report({ summaries: [summaryFor('scoutRouting', { nHeuristic: 1, heuristicPassRate: 0 })] }),
      rows,
      cases: { scoutRouting: [{ id: 'case-1', input: {}, expected: { bucket: 'Y' }, note: 'why this case exists' }] },
      metrics: METRICS,
    });
    const block = caseBlock(html, 'case-1');
    expect(block).toContain('data-state="fail"');
    expect(block).toContain('<tr class="mismatch"><th scope="row">bucket</th><td>X</td><td>Y</td>');
    expect(block).toContain('<tr class="match"><th scope="row">composite_signal</th>');
    expect(block).toContain('why this case exists');
    expect(html).toContain('1 with a failing verdict');
  });

  it('parses field comparisons, including bracketed values, and declines free text', () => {
    expect(parseComparisons('shape=a (expected b), required=[X,Y] (expected [X,Y]), deliverable=[] (expected none)')).toEqual([
      { field: 'shape', got: 'a', expected: 'b' },
      { field: 'required', got: '[X,Y]', expected: '[X,Y]' },
      { field: 'deliverable', got: '[]', expected: 'none' },
    ]);
    expect(parseComparisons('The rationale is generic.')).toBeNull();
  });

  it('lists failing cases before passing ones', () => {
    const html = renderReport({
      report: report({ summaries: [summaryFor('scoutRouting', { nHeuristic: 2, heuristicPassRate: 0.5 })] }),
      rows: [
        { caseId: 'passes', metric: 'scoutRouting', grades: [grade({ caseId: 'passes' })] },
        { caseId: 'fails', metric: 'scoutRouting', grades: [grade({ caseId: 'fails', isCorrect: false, score: 0 })] },
      ],
      cases: {},
      metrics: METRICS,
    });
    expect(html.indexOf('data-search="fails')).toBeLessThan(html.indexOf('data-search="passes'));
  });

  it('a judge that never ran says so, and a metric without a judge has no judge lane', () => {
    const html = renderReport({
      report: report({
        summaries: [summaryFor('scoutRationale'), summaryFor('architectScoring', { nHeuristic: 1, heuristicPassRate: 1 })],
      }),
      rows: [
        { caseId: 'c', metric: 'scoutRationale', grades: [] },
        { caseId: 'c', metric: 'architectScoring', grades: [grade({ metric: 'architectScoring' })] },
      ],
      cases: {},
      metrics: METRICS,
    });
    expect(html).toContain('Not evaluated — no model key');
    const rationale = html.slice(html.indexOf('id="scoutRationale"'));
    expect(rationale).toContain('Not evaluated');
    const scoring = html.slice(html.indexOf('id="architectScoring"'), html.indexOf('</section>', html.indexOf('id="architectScoring"')));
    expect(scoring).not.toContain('Fallback · judge');
  });

  it('an errored judge is neither pass nor fail and carries its error code', () => {
    const html = renderReport({
      report: report({
        judgesRan: true,
        summaries: [summaryFor('scoutRationale', { nJudge: 1, nJudgeErrored: 1 })],
      }),
      rows: [
        {
          caseId: 'c',
          metric: 'scoutRationale',
          grades: [grade({ metric: 'scoutRationale', grader: 'judge', source: 'template', status: 'errored', error: 'model_timeout', isCorrect: false, score: 0 })],
        },
      ],
      cases: {},
      metrics: METRICS,
    });
    const block = caseBlock(html, 'c');
    expect(block).toContain('data-state="errored"');
    expect(block).toContain('pill errored');
    expect(block).toContain('model_timeout');
    expect(block).not.toContain('pill fail');
    expect(block).not.toContain('grade fail');
    expect(html).not.toContain('with a failing verdict');
  });

  it('gates read targets.yaml: pass, fail, errored-cannot-certify and ungated', () => {
    const html = renderReport({
      report: report({
        judgesRan: true,
        summaries: [
          summaryFor('scoutRouting', { nHeuristic: 10, heuristicPassRate: 1 }),
          summaryFor('architectScoring', { nHeuristic: 10, heuristicPassRate: 0.9 }),
          summaryFor('envoyDraft', { nJudge: 5, nJudgeErrored: 1, judgePassRate: 1, judgeMeanScore: 0.9 }),
          summaryFor('pulseHealth', { nHeuristic: 9, heuristicPassRate: 1 }),
        ],
      }),
      rows: [],
      cases: {},
      metrics: METRICS,
      targets: { scout_routing_pass_rate: 1, architect_scoring_pass_rate: 1, envoy_draft_pass_rate: 0.8 },
    });
    const head = (metric: string) => html.slice(html.indexOf(`id="${metric}"`), html.indexOf('</header>', html.indexOf(`id="${metric}"`)));
    expect(head('scoutRouting')).toContain('gate-passed');
    expect(head('architectScoring')).toContain('gate-failed');
    expect(head('envoyDraft')).toContain('gate-failed');
    expect(html).toContain('cannot certify');
    expect(head('pulseHealth')).toContain('gate-ungated');
    expect(html).toContain('2 gated metrics failing');
  });

  it('a path that ran but succeeded nowhere is not reported as having simply run', () => {
    const html = renderReport({
      report: report({
        judgesRan: true,
        modelCallsRan: true,
        summaries: [
          summaryFor('scoutRouting', { nHeuristic: 1, heuristicPassRate: 1, nModel: 21, nModelErrored: 21 }),
          summaryFor('scoutRationale', { nJudge: 21, nJudgeErrored: 21 }),
        ],
      }),
      rows: [],
      cases: {},
      metrics: METRICS,
    });
    expect(html).toContain('<span>Model path</span> <strong>ran, 0 of 21 succeeded</strong>');
    expect(html).toContain('<span>Judges</span> <strong>ran, 0 of 21 succeeded</strong>');
    expect(html).toContain('Evaluation error');
  });

  it('shows the template and model rates side by side in the comparison', () => {
    const html = renderReport({
      report: report({
        modelCallsRan: true,
        summaries: [summaryFor('scoutRouting', { nHeuristic: 21, heuristicPassRate: 1, nModel: 21, modelPassRate: 10 / 21 })],
      }),
      rows: [],
      cases: {},
      metrics: METRICS,
    });
    const cmp = html.slice(html.indexOf('id="cmp-h"'), html.indexOf('</section>', html.indexOf('id="cmp-h"')));
    expect(cmp).toContain('100%');
    expect(cmp).toContain('48%');
    expect(cmp).toContain('10 of 21 exactly right');
  });

  it('prints the judge rubric, collapsed, so a reader can see what was graded', () => {
    const html = renderReport({
      report: report({ summaries: [summaryFor('envoyDraft')] }),
      rows: [],
      cases: {},
      metrics: METRICS,
    });
    const rubric = new METRICS.envoyDraft.judgeCls!().systemPrompt.trim().slice(0, 40);
    expect(html).toContain('<details class="rubric">');
    expect(html).toContain(esc(rubric));
  });

  it('names the models the run called and tabulates latency per group, failures by code', () => {
    const html = renderReport({
      report: report({
        models: { agent: 'gemini-3.5-flash-lite', judge: null },
        latency: [
          {
            role: 'judge', agent: 'scout', model: 'gpt-5.4-nano', promptVersion: 'judge:scoutRationale@v3',
            n: 4, nFailed: 1, failures: { model_timeout: 1 }, p50Ms: 4_200, p95Ms: 9_000, maxMs: 9_000,
            meanInputTokens: 2_000, meanOutputTokens: 900,
          },
        ],
      }),
      rows: [],
      cases: {},
      metrics: {},
    });
    expect(html).toContain('<code>gemini-3.5-flash-lite</code>');
    expect(html).toContain('judge:scoutRationale@v3');
    expect(html).toContain('<td>4.2s</td><td>9.0s</td>');
    expect(html).toContain('model_timeout ×1');
  });

  it('omits the latency panel for a summary without latency', () => {
    expect(renderReport({ report: report({}), rows: [], cases: {}, metrics: {} })).not.toContain('id="lat-h"');
  });

  it('renders the graded output when present, escaped', () => {
    const html = renderReport({
      report: report({ judgesRan: true, summaries: [summaryFor('envoyDraft', { nJudge: 1, judgePassRate: 1 })] }),
      rows: [
        {
          caseId: 'c',
          metric: 'envoyDraft',
          grades: [grade({ metric: 'envoyDraft', grader: 'judge', source: 'template', output: 'Hi <team>, see you Thursday' })],
        },
      ],
      cases: {},
      metrics: METRICS,
    });
    expect(html).toContain('What the agent produced');
    expect(html).toContain('Hi &lt;team&gt;, see you Thursday');
  });

  it('escapes case ids, notes, reasoning and outputs', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderReport({
      report: report({ summaries: [summaryFor('scoutRouting', { nHeuristic: 1, heuristicPassRate: 1 })] }),
      rows: [{ caseId: evil, metric: 'scoutRouting', grades: [grade({ caseId: evil, reasoning: `${evil}</script><script>alert(2)` })] }],
      cases: { scoutRouting: [{ id: evil, input: {}, expected: { bucket: evil }, note: `"quoted" ${evil}` }] },
      metrics: METRICS,
    });
    expect(html).not.toContain(evil);
    expect(html).not.toContain('<script>alert(2)');
    expect(html).toContain(esc(evil));
    // Only the page's own filter script.
    expect(html.match(/<script>/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------
// Scoreboard, trends, calibration — the cross-run views
// ---------------------------------------------------------------------------------------

const manifest = (id: string, over: Partial<RunManifest> = {}): RunManifest => ({
  id,
  label: null,
  git: { commit: 'abc1234', dirty: false },
  promptVersions: { scout: 'scout-routing-0.04', judge: '0.04' },
  promptHashes: null,
  fixtures: { scoutRouting: 'fff' },
  flags: { judges: true, model: true, gate: false },
  drift: [],
  ...over,
});

const historyEntry = (id: string, generatedAt: string, over: Partial<RunHistoryEntry> = {}): RunHistoryEntry => ({
  ...manifest(id),
  generatedAt,
  models: { agent: 'gemini', judge: 'gpt' },
  summaries: [],
  source: 'log',
  backfilled: false,
  calibration: null,
  calibrationRows: [],
  ...over,
});

const calRow = (id: string, judge: string, judgeSaid: boolean, label: boolean): CalibrationResult => ({
  id,
  judge,
  caseId: 'c',
  expected: { isCorrect: label, failed: label ? [] : ['grounded'] },
  verdict: grade({ metric: judge, grader: 'judge', isCorrect: judgeSaid, score: judgeSaid ? 1 : 0, dimensions: { grounded: judgeSaid ? 1 : 0 }, reasoning: 'because <reasons>' }),
  agreed: judgeSaid === label,
  dimensionsAgreed: { grounded: judgeSaid === label },
});

const section = (html: string, id: string): string => {
  const start = html.indexOf(`id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
};

describe('scoreboard, trends and calibration', () => {
  const current = report({
    generatedAt: '2026-10-08T12:00:00.000Z',
    judgesRan: true,
    modelCallsRan: true,
    summaries: [
      summaryFor('scoutRouting', { nHeuristic: 20, heuristicPassRate: 1, nModel: 20, modelPassRate: 0.85 }),
      summaryFor('scoutRationale', { nJudge: 20, judgePassRate: 0.9, judgeMeanScore: 0.9, nModelJudge: 20, modelJudgePassRate: 0.7, modelJudgeMeanScore: 0.7 }),
    ],
    run: manifest('run-2', { promptVersions: { scout: 'scout-routing-0.05', judge: '0.05' }, fixtures: { scoutRouting: 'fff' } }),
  });
  const previous = historyEntry('run-1', '2026-10-08T11:00:00.000Z', {
    summaries: [
      summaryFor('scoutRouting', { nHeuristic: 20, heuristicPassRate: 1, nModel: 20, modelPassRate: 0.75 }),
      summaryFor('scoutRationale', { nJudge: 20, judgePassRate: 0.95, judgeMeanScore: 0.95 }),
    ],
  });

  it('puts every lane on one row with passed/graded and the change against the previous keyed run', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets: { scout_routing_pass_rate: 1 }, history: [previous] });
    const board = section(html, 'score-h');
    // Model exact: 85% of 20 = 17/20, up 10 points on run-1's 75%.
    expect(board).toContain('<b>85%</b><small>17/20 · <span class="t-good">+10 pts</span></small>');
    // Template judge on scoutRationale: 18/20, down 5 points.
    expect(board).toContain('<b>90%</b><small>18/20 · <span class="t-bad">−5 pts</span></small>');
    // A lane the previous run did not measure is "new", not a delta.
    expect(board).toContain('<small>14/20 · new</small>');
    // A lane the metric does not have is a dash, not "not run".
    expect(board).toMatch(/scoutRationale[\s\S]*?No such path for this metric/);
    expect(board).toContain('previous keyed run');
    // No fixture changed, so no cell carries the † mark (the lede explains it once).
    expect(board.slice(board.indexOf('<tbody>'))).not.toContain('†');
  });

  it('marks a delta whose fixture changed in between, and shows no delta without a previous run', () => {
    const changed = historyEntry('run-1', '2026-10-08T11:00:00.000Z', { fixtures: { scoutRouting: 'old' }, summaries: previous.summaries });
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, history: [changed] });
    expect(section(html, 'score-h')).toContain('+10 pts</span><abbr class="fx"');
    const alone = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS });
    expect(section(alone, 'score-h')).toContain('<b>85%</b><small>17/20</small>');
    expect(section(alone, 'score-h')).toContain('appears once there is one');
  });

  it('trends: one column per keyed run, headed by the prompts that changed, this run included', () => {
    const older = historyEntry('run-0', '2026-10-07T11:00:00.000Z', {
      promptVersions: { scout: 'scout-routing-0.03', judge: '0.04' },
      summaries: [summaryFor('scoutRouting', { nHeuristic: 20, heuristicPassRate: 0.9 })],
    });
    const drifted = { ...previous, drift: ['scout'] };
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, history: [older, drifted] });
    const trend = section(html, 'trends');
    expect(trend.indexOf('10-07 11:00')).toBeLessThan(trend.indexOf('10-08 11:00'));
    expect(trend.indexOf('10-08 11:00')).toBeLessThan(trend.indexOf('10-08 12:00'));
    expect(trend).toContain('<small>scout 0.03 · judge 0.04</small>');
    expect(trend).toContain('<small>scout 0.04</small>');
    expect(trend).toContain('<small>scout 0.05 · judge 0.05</small>');
    expect(trend).toContain('this run');
    expect(trend).toContain('drift: scout');
    // scoutRouting template·exact across the three: 90%, 100%, 100%; model·exact: —, 75%, 85%.
    expect(trend).toMatch(/scoutRouting[\s\S]*?<b>90%<\/b>[\s\S]*?<b>100%<\/b>[\s\S]*?<b>100%<\/b>/);
    expect(trend).toMatch(/Model · exact match[\s\S]*?<td class="none">Not evaluated<\/td>[\s\S]*?<b>75%<\/b>[\s\S]*?<b>85%<\/b>/);
  });

  it('trends: says so with fewer than two keyed runs, and leaves heuristic-only runs to the loader', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS });
    expect(section(html, 'trends')).toContain('One keyed run so far');
    const unkeyed = renderReport({ report: report({ summaries: current.summaries, run: manifest('h', { flags: { judges: false, model: false, gate: true } }) }), rows: [], cases: {}, metrics: METRICS });
    expect(section(unkeyed, 'trends')).toContain('No keyed run is recorded yet');
  });

  it('calibration: agreement, lenient and harsh counts per judge, the disagreements, and the trend by judge version', () => {
    const rows = [
      calRow('pass-ok', 'scoutRationale', true, true),
      calRow('fail-ok', 'scoutRationale', false, false),
      calRow('leak', 'scoutRationale', true, false),
      calRow('too-strict', 'envoyDraft', false, true),
    ];
    const calibration: NonNullable<EvalReport['calibration']> = {
      judgeVersion: '0.05',
      nCases: 4,
      judges: [
        { judge: 'scoutRationale', n: 3, nErrored: 0, agreement: 2 / 3, dimensions: { grounded: { n: 3, agreement: 2 / 3 } } },
        { judge: 'envoyDraft', n: 1, nErrored: 0, agreement: 0, dimensions: {} },
      ],
    };
    const earlier = historyEntry('run-1', '2026-10-08T11:00:00.000Z', {
      calibration: { judgeVersion: '0.04', nCases: 4, judges: [{ judge: 'scoutRationale', n: 3, nErrored: 0, agreement: 1 / 3, dimensions: {} }] },
      calibrationRows: [calRow('a', 'scoutRationale', true, false), calRow('b', 'scoutRationale', true, false), calRow('c', 'scoutRationale', true, true)],
    });
    const html = renderReport({ report: { ...current, calibration }, rows: [], cases: {}, metrics: METRICS, history: [earlier], calibrationRows: rows });
    const cal = section(html, 'calibration');
    expect(cal).toContain('judge prompt <code>0.05</code>, 4 labelled outputs');
    // scoutRationale: agreed pass 1, agreed fail 1, lenient 1, harsh 0, errored 0, graded 3.
    expect(cal).toMatch(/scoutRationale<\/th><td class="t-bad"><b>67%<\/b><\/td><td class="t-good"[^>]*>1<\/td><td class="t-good"[^>]*>1<\/td><td class="t-bad"[^>]*>1<\/td><td class="t-none"[^>]*>0<\/td><td class="none">0<\/td><td class="none">3<\/td>/);
    expect(cal).toContain('2 disagreements');
    expect(cal).toContain('<code>leak</code> <span class="pill fail">lenient</span>');
    expect(cal).toContain('<code>too-strict</code> <span class="pill fail">harsh</span>');
    expect(cal).toContain('because &lt;reasons&gt;');
    // The trend: judge 0.04 (33%, 2 lenient) then 0.05 (67%, 1 lenient).
    const trend = cal.slice(cal.indexOf('Across judge versions'));
    expect(trend).toContain('<small>judge 0.04</small>');
    expect(trend).toContain('<small>judge 0.05</small>');
    expect(trend).toMatch(/<b>33%<\/b><small><span class="t-bad">2 lenient<\/span>/);
    expect(trend).toMatch(/<b>67%<\/b><small><span class="t-bad">1 lenient<\/span> · <span class="">0 harsh<\/span>/);
  });

  it('calibration: one callout when no run ever had judges, still above the run material; a hint when only this run lacks them', () => {
    const none = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS });
    const noneCal = section(none, 'calibration');
    expect(noneCal).toContain('<div id="judges"><aside class="callout amber"><strong>The judges ran but were not calibrated this run, so there is no calibration for this run.</strong> No run has calibrated a judge yet:');
    const skipped = renderReport({ report: { ...current, judgesRan: false }, rows: [], cases: {}, metrics: METRICS });
    expect(section(skipped, 'calibration')).toContain('<strong>Judges did not run this time, so there is no calibration for this run.</strong>');
    expect(noneCal).not.toContain('judge-card');
    expect(none).toContain('<div id="runs" class="runs">');
    expect(none).toContain('id="score-h"');
    const earlier = historyEntry('run-1', '2026-10-08T11:00:00.000Z', {
      calibration: { judgeVersion: '0.04', nCases: 1, judges: [{ judge: 'scoutRationale', n: 1, nErrored: 0, agreement: 1, dimensions: {} }] },
    });
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, history: [earlier] });
    expect(section(html, 'calibration')).toContain('so there is no calibration for this run.</strong> The trend below is from earlier keyed runs.');
  });
});

describe('triage, per-check rates, scatter and latency charts', () => {
  const judged = (caseId: string, source: 'template' | 'model', score: number, dims: Record<string, number>): GraderResult =>
    grade({ caseId, metric: 'envoyDraft', grader: 'judge', source, isCorrect: score >= 1, score, dimensions: dims });

  const input = () => ({
    report: report({
      judgesRan: true,
      modelCallsRan: true,
      summaries: [
        summaryFor('scoutRouting', { nHeuristic: 2, heuristicPassRate: 0.5, nModel: 2, modelPassRate: 0.5 }),
        summaryFor('envoyDraft', { nJudge: 3, judgePassRate: 2 / 3, judgeMeanScore: 0.8, nModelJudge: 3, modelJudgePassRate: 2 / 3, modelJudgeMeanScore: 0.8 }),
      ],
    }),
    rows: [
      // The fallback is wrong on one case; the model is wrong on the other.
      { caseId: 'r-1', metric: 'scoutRouting', grades: [grade({ caseId: 'r-1', isCorrect: false, score: 0, reasoning: 'bucket=A (expected B), hitlTier=L3 (expected L3)', dimensions: { bucketMatch: 0, tierMatch: 1 } }), grade({ caseId: 'r-1', grader: 'model', dimensions: { bucketMatch: 1, tierMatch: 1 } })] },
      { caseId: 'r-2', metric: 'scoutRouting', grades: [grade({ caseId: 'r-2', dimensions: { bucketMatch: 1, tierMatch: 1 } }), grade({ caseId: 'r-2', grader: 'model', isCorrect: false, score: 0, reasoning: 'bucket=C (expected D), hitlTier=L3 (expected L3)', dimensions: { bucketMatch: 0, tierMatch: 1 } })] },
      // Template text fails alone, model text fails alone, both fail.
      { caseId: 'e-1', metric: 'envoyDraft', grades: [judged('e-1', 'template', 0.5, { appropriate: 0, grounded: 1 }), judged('e-1', 'model', 1, { appropriate: 1, grounded: 1 })] },
      { caseId: 'e-2', metric: 'envoyDraft', grades: [judged('e-2', 'template', 1, { appropriate: 1, grounded: 1 }), judged('e-2', 'model', 0.2, { appropriate: 0, grounded: 0 })] },
      { caseId: 'e-3', metric: 'envoyDraft', grades: [judged('e-3', 'template', 0.5, { appropriate: 1, grounded: 0 }), judged('e-3', 'model', 0.5, { appropriate: 1, grounded: 0 })] },
    ] as GradedRow[],
    cases: {},
    metrics: METRICS,
  });

  const section = (html: string, id: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</section>', html.indexOf(`id="${id}"`)));

  it('buckets every failing verdict by what it means, in fix order, each linking to its case', () => {
    const html = renderReport(input());
    const t = section(html, 'triage-h');
    const order = ['Fallback gives the wrong answer', 'Judge fails the fallback text, passes the model text', 'Judge fails both texts', 'Model disagrees with the spec', 'Judge fails the model text, passes the fallback text'];
    const positions = order.map((h) => t.indexOf(h));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(t).not.toContain('No verdict');
    expect(t).toContain('5 failing or errored verdicts');
    expect(t).toContain('href="#case-scoutRouting-r-1"');
    expect(t).toContain('bucket: got A, expected B');
    expect(t).not.toContain('hitlTier: got');
    expect(t).toContain('0.50 · review');
    expect(t).toContain('0.20 · clear fail');
    // The both-fail row carries the model text's verdict beside the template's.
    expect(t).toContain('model 0.50: grounded');
    expect(html).toContain('id="case-scoutRouting-r-1"');
  });

  it('says there is nothing to fix when every verdict passed', () => {
    const html = renderReport({ report: report({ summaries: [summaryFor('scoutRouting', { nHeuristic: 1, heuristicPassRate: 1 })] }), rows: [{ caseId: 'ok', metric: 'scoutRouting', grades: [grade({ caseId: 'ok' })] }], cases: {}, metrics: METRICS });
    expect(section(html, 'triage-h')).toContain('Nothing. Every verdict in this run passed.');
  });

  it('tables the pass rate per check, weakest first, per path, and skips checks that never lost', () => {
    const html = renderReport(input());
    const c = section(html, 'checks-h');
    expect(c.indexOf('<code>bucketMatch</code>')).toBeLessThan(c.indexOf('<code>tierMatch</code>'));
    expect(c).toContain('1 / 2');
    expect(c).toContain('2 / 2');
    const envoy = c.slice(c.indexOf('envoyDraft'));
    expect(envoy.indexOf('<code>grounded</code>')).toBeLessThan(envoy.indexOf('<code>appropriate</code>'));
    const clean = renderReport({ report: report({ summaries: [summaryFor('scoutRouting', { nHeuristic: 1, heuristicPassRate: 1 })] }), rows: [{ caseId: 'ok', metric: 'scoutRouting', grades: [grade({ caseId: 'ok', dimensions: { bucketMatch: 1 } })] }], cases: {}, metrics: METRICS });
    expect(section(clean, 'checks-h')).toContain('No check lost a case on either path.');
    expect(section(clean, 'checks-h')).toContain('scoutRouting</a> (1)');
  });

  it('draws one judge-score scatter per prose metric with the better/worse/tie count and stacked points', () => {
    const html = renderReport(input());
    const cmp = section(html, 'cmp-h');
    expect(cmp.match(/<figure class="scatter">/g)).toHaveLength(1);
    expect(cmp).toContain('model better <b class="t-good">1</b> · worse <b class="t-bad">1</b> · tie 1');
    expect(cmp).toContain('class="pt better"');
    expect(cmp).toContain('class="pt worse"');
    expect(cmp).toContain('e-1 — fallback 0.50, model 1.00');
  });

  it('charts agent latency apart from judge latency, slowest first, and keeps the full table', () => {
    const group = (role: 'agent' | 'judge', agent: string, promptVersion: string, p50Ms: number) => ({
      role, agent, model: 'm', promptVersion, n: 3, nFailed: 0, failures: {}, p50Ms, p95Ms: p50Ms * 2, maxMs: p50Ms * 2, meanInputTokens: 10, meanOutputTokens: 5,
    });
    const html = renderReport({
      report: report({ latency: [group('agent', 'scout', 'scout-routing-0.05', 1_000), group('agent', 'architect', 'architect-plan-0.04', 4_000), group('judge', 'scout', 'judge:scoutRationale@0.05', 7_000)] }),
      rows: [], cases: {}, metrics: {},
    });
    const lat = section(html, 'lat-h');
    expect(lat.match(/<figure class="latency-chart">/g)).toHaveLength(2);
    const agents = lat.slice(lat.indexOf('Agent calls — seconds per case'), lat.indexOf('Judge calls — seconds per batch'));
    expect(agents.indexOf('architect · architect-plan-0.04')).toBeLessThan(agents.indexOf('scout · scout-routing-0.05'));
    expect(agents).toContain('p50 4.0s · p95 8.0s');
    expect(agents).not.toContain('judge:scoutRationale');
    expect(lat).toContain('<td>7.0s</td><td>14.0s</td>');
  });
});

describe('overview — one screen: status by path, counts beside rates, dumbbell, trend, judge trust, evidence', () => {
  // The run the stakeholder note described: every gate green while the model path sits at
  // 25/29 and a judge is calibrated on three outputs. One green headline would hide both.
  const calibration = {
    judgeVersion: '0.05',
    nCases: 8,
    judges: [
      { judge: 'scoutRationale', n: 5, nErrored: 0, agreement: 1, dimensions: {} },
      { judge: 'architectCharter', n: 3, nErrored: 0, agreement: 2 / 3, dimensions: {} },
    ],
  };
  const current = report({
    generatedAt: '2026-10-08T12:00:00.000Z',
    nCases: 60,
    judgesRan: true,
    modelCallsRan: true,
    models: { agent: 'gemini', judge: 'gpt' },
    summaries: [
      summaryFor('scoutRouting', { nHeuristic: 29, heuristicPassRate: 1, nModel: 29, modelPassRate: 25 / 29 }),
      summaryFor('scoutRationale', { nJudge: 29, judgePassRate: 28 / 29, judgeMeanScore: 0.98, nModelJudge: 29, modelJudgePassRate: 25 / 29, modelJudgeMeanScore: 0.9 }),
      summaryFor('architectCharter', { nJudge: 23, judgePassRate: 17 / 23, judgeMeanScore: 0.8, nModelJudge: 23, modelJudgePassRate: 15 / 23, modelJudgeMeanScore: 0.8 }),
      summaryFor('pulseHealth', { nHeuristic: 29, heuristicPassRate: 1 }),
    ],
    calibration,
    run: manifest('run-2', { promptVersions: { scout: 'scout-routing-0.05', judge: '0.05' }, fixtures: { scoutRouting: 'fff' }, git: { commit: 'e218651', dirty: true } }),
  });
  const targets = { scout_routing_pass_rate: 1, pulse_health_pass_rate: 1 };
  const overview = (html: string) => section(html, 'overview');

  it('shows passed/graded beside every rate, under the plain metric name', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets });
    const row = (metric: string) => {
      const o = overview(html);
      const start = o.indexOf(`<code class="mname">${metric}</code>`);
      return o.slice(start, o.indexOf('</tr>', start));
    };
    expect(overview(html)).toContain('<a href="#scoutRouting">Routing accuracy</a> <code class="mname">scoutRouting</code>');
    expect(row('scoutRouting')).toContain('<b>100%</b> <span class="n">29/29</span>');
    expect(row('scoutRouting')).toContain('<b>86%</b> <span class="n">25/29</span>');
    expect(row('scoutRouting')).toContain('decision · exact match');
    expect(row('architectCharter')).toContain('writing · judge');
    expect(row('architectCharter')).toContain('<b>74%</b> <span class="n">17/23</span>');
    // A path the metric does not have is a dash, not a zero.
    expect(row('pulseHealth')).toContain('No such path for this metric');
  });

  it('draws the dumbbell: fallback filled, model open, the bar at the gate or soft at 90% when ungated', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets });
    const o = overview(html);
    const routing = o.slice(o.indexOf('mname">scoutRouting'), o.indexOf('</tr>', o.indexOf('mname">scoutRouting')));
    expect(routing).toContain('fallback 100% · model 86% · gate 100%');
    expect(routing).toContain('class="bar" x1="144.0"');
    expect(routing).toContain('<circle class="dot template t-fill-good" cx="144.0"');
    expect(routing).toContain('<circle class="dot model t-stroke-warn" cx="125.0"');
    expect(routing).toContain('<line class="gap" x1="144.0" x2="125.0"');
    const charter = o.slice(o.indexOf('mname">architectCharter'), o.indexOf('</tr>', o.indexOf('mname">architectCharter')));
    expect(charter).toContain('bar 90%');
    expect(charter).toContain('class="bar soft"');
    const pulse = o.slice(o.indexOf('mname">pulseHealth'), o.indexOf('</tr>', o.indexOf('mname">pulseHealth')));
    expect(pulse).toContain('model not measured');
    expect(pulse).not.toContain('class="gap"');
  });

  it('sparkline: a dash before the second keyed run; then both lanes with a tick where prompts or fixture changed', () => {
    const alone = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets });
    expect(overview(alone)).toContain('Appears after the second keyed run');
    const older = historyEntry('run-0', '2026-10-07T11:00:00.000Z', {
      promptVersions: { scout: 'scout-routing-0.04', judge: '0.05' },
      summaries: [summaryFor('scoutRouting', { nHeuristic: 20, heuristicPassRate: 0.9, nModel: 20, modelPassRate: 0.5 })],
    });
    const previous = historyEntry('run-1', '2026-10-08T11:00:00.000Z', {
      promptVersions: { scout: 'scout-routing-0.05', judge: '0.05' },
      fixtures: { scoutRouting: 'old' },
      summaries: [summaryFor('scoutRouting', { nHeuristic: 20, heuristicPassRate: 1, nModel: 20, modelPassRate: 0.75 })],
    });
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets, history: [older, previous] });
    const o = overview(html);
    const routing = o.slice(o.indexOf('mname">scoutRouting'), o.indexOf('</tr>', o.indexOf('mname">scoutRouting')));
    expect(routing).toContain('3 keyed runs, oldest first · fallback 90% → 100% → 100% · model 50% → 75% → 86% · 2 breaks');
    // run-1 changed the scout prompt, run-2 changed the fixture: a tick on each, none on run-0.
    expect(routing.match(/<line class="break"/g)).toHaveLength(2);
    expect(routing).toContain('<path class="line template" d="M4.0 4.6L48.0 3.0L92.0 3.0"/>');
    expect(routing).toContain('<path class="line model" d="M4.0 11.0L48.0 7.0L92.0 5.2"/>');
    // A metric only this run measured is one point, not a line: "new", with the line promised.
    const pulse = o.slice(o.indexOf('mname">pulseHealth'), o.indexOf('</tr>', o.indexOf('mname">pulseHealth')));
    expect(pulse).toContain('<td class="ov none" title="Measured in one keyed run so far; the line appears with the next">new</td>');
    // A lane with nothing in any run emits no path at all.
    const rationale = o.slice(o.indexOf('mname">scoutRationale'), o.indexOf('</tr>', o.indexOf('mname">scoutRationale')));
    expect(rationale).toContain('new</td>');
    expect(o).not.toContain('d=""');
  });

  it('puts the judge’s agreement beside its rates, muted under the ten-output floor, a dash on unjudged metrics', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets });
    const o = overview(html);
    const charter = o.slice(o.indexOf('mname">architectCharter'), o.indexOf('</tr>', o.indexOf('mname">architectCharter')));
    expect(charter).toContain('<td class="ov t-none thin" title="2 of 3 labelled outputs agreed with the hand label — under the 10-output floor');
    expect(charter).toContain('<b>2/3</b> <span class="n">67%</span><small>under floor</small>');
    const routing = o.slice(o.indexOf('mname">scoutRouting'), o.indexOf('</tr>', o.indexOf('mname">scoutRouting')));
    expect(routing).toContain('No judge on this metric');
    const full = renderReport({
      report: { ...current, calibration: { ...calibration, judges: [{ judge: 'architectCharter', n: 12, nErrored: 2, agreement: 0.9, dimensions: {} }] } },
      rows: [],
      cases: {},
      metrics: METRICS,
      targets,
    });
    const fo = overview(full);
    const fc = fo.slice(fo.indexOf('mname">architectCharter'), fo.indexOf('</tr>', fo.indexOf('mname">architectCharter')));
    expect(fc).toContain('<td class="ov t-good" title="9 of 10 labelled outputs agreed with the hand label"><b>9/10</b>');
    const sr = fo.slice(fo.indexOf('mname">scoutRationale'), fo.indexOf('</tr>', fo.indexOf('mname">scoutRationale')));
    expect(sr).toContain('not calibrated');
  });

  it('needs attention names metrics plainly with counts, and the evidence line says offline, full or partial, prompts and commit', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets });
    const o = overview(html);
    // Red lanes only: the 74% template judge is amber and stays out; the 65% model judge is red and names its fallback twin.
    expect(o).not.toContain('<strong>Charter quality</strong>: template · judge');
    expect(o).toContain('<strong>Charter quality</strong>: model · judge at 15/23 · 65% (fallback 17/23 · 74%)');
    expect(o).not.toContain('architectCharter</strong>');
    expect(o).toContain('<strong>Offline evaluation</strong> over 60 hand-written cases — not live traffic');
    expect(o).toContain('full run · prompts scout 0.05, judge 0.05 · commit <code>e218651*</code> with uncommitted changes · agent <code>gemini</code>, judge <code>gpt</code>');
    const partial = renderReport({ report: { ...current, modelCallsRan: false }, rows: [], cases: {}, metrics: METRICS, targets });
    expect(overview(partial)).toContain('<strong>partial run</strong> (judges)');
    const fallbackOnly = renderReport({ report: { ...current, judgesRan: false, modelCallsRan: false }, rows: [], cases: {}, metrics: METRICS, targets });
    expect(overview(fallbackOnly)).toContain('<strong>partial run</strong> (fallback only)');
  });

  it('names no person anywhere, and ships light only: navy header, no dark-mode block', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets, calibrationRows: [], readiness: { kappaSheets: 0, judgeCiJob: false } });
    expect(html).not.toMatch(/Ramsey|Tony|Karthik/);
    expect(html).not.toContain('Owner');
    expect(html).toContain('<header class="doc-header">');
    expect(html).not.toContain('prefers-color-scheme');
    expect(html).not.toContain('color-scheme');
  });

  it('lays the page out as tabs: overview, one per agent, calibration; every nav link resolves; nothing external', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets });
    const nav = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>'));
    const hrefs = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['overview', 'scout', 'architect', 'pulse', 'calibration']);
    for (const id of hrefs) expect(html).toContain(`<div class="tab" id="tab-${id}"`);
    for (const gone of ['tab-judges', 'tab-runs', 'tab-method']) expect(html).not.toContain(`id="${gone}"`);
    expect(nav).not.toContain('>Method<');
    // Agent tabs are derived from the metrics present, not a fixed roster.
    expect(html).not.toContain('id="tab-envoy"');
    // The evidence panels all still exist, each on its tab, and the old anchors with them.
    const tab = (id: string) => html.slice(html.indexOf(`id="tab-${id}"`), html.indexOf('<div class="tab"', html.indexOf(`id="tab-${id}"`) + 1));
    for (const id of ['id="overview"', 'id="triage-h"', 'id="actions"']) expect(tab('overview')).toContain(id);
    for (const id of ['id="calibration"', 'id="judges"', 'id="runs"', 'id="score-h"', 'id="trends"', 'id="cmp-h"']) expect(tab('calibration')).toContain(id);
    // The old #judges, #runs and #method hashes resolve: each is a real element id on the tab that now holds it, so route() opens that tab.
    for (const id of ['id="judges"', 'id="runs"']) expect(tab('calibration')).toContain(id);
    for (const id of ['id="method"', 'id="readiness"', '<details class="glossary" id="glossary">']) expect(tab('overview')).toContain(id);
    for (const id of ['id="judges"', 'id="runs"', 'id="method"', 'id="readiness"', 'id="glossary"']) expect(html.match(new RegExp(` ${id}`, 'g'))).toHaveLength(1);
    // The method block is collapsed to its head and first paragraph; the run material sits in collapsed details.
    const method = tab('overview').slice(tab('overview').indexOf('id="method"'));
    expect(method).toContain('<h2 id="method-h">How to read this page</h2>');
    expect(method).toContain('<details class="method-body"><summary>');
    expect(method).not.toContain('<details class="method-body" open');
    expect(method.indexOf('<details class="method-body">')).toBeLessThan(method.indexOf('id="readiness"'));
    expect(tab('calibration')).toContain('<details class="review fold"><summary>Scoreboard');
    expect(tab('calibration')).not.toContain('<details class="review fold" open');
    expect(tab('overview')).toContain('readiness steps done');
    expect(tab('overview')).toContain('see <a href="#readiness">How to read this page</a>.');
    for (const id of ['id="scoutRouting"', 'id="scoutRationale"', 'id="agent-scout"']) expect(tab('scout')).toContain(id);
    expect(html.indexOf('id="overview"')).toBeLessThan(html.indexOf('id="triage-h"'));
    // Self-contained: one inline script, a JSON blob, no external script, style, font or link target.
    expect(html).not.toContain('<script src');
    expect(html).not.toContain('<link ');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain('<script type="application/json" id="case-data">');
  });

  it('opens the overview with the claim and caveat, four stat cards, the roster and both charts', () => {
    const html = renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets });
    const o = overview(html);
    expect(o).toContain('<aside class="callout teal frame"><p><strong>Claim.</strong> <span class="t-good">Every gated fallback is certified</span> — 2 of 2 gates pass');
    expect(o).toContain('<p><strong>Caveat.</strong> The gate certifies the deterministic fallback only.');
    expect(o).not.toContain('Owner');
    expect(o).toContain('<div class="num">2<small> / 2</small></div><div class="label">Gated metrics passing</div>');
    expect(o).toContain('<div class="num">0<small> / 3</small></div><div class="label">Model metrics at the 90% bar</div>');
    expect(o).toContain('<div class="num">0<small> / 2</small></div><div class="label">Judges trusted</div>');
    expect(o).toContain('<div class="num">0</div><div class="label">Open P1 actions</div>');
    expect(o.match(/<a class="stat-card /g)).toHaveLength(4);
    // Roster: one row per agent, pooled passed/graded per path, gates, judges.
    const roster = o.slice(o.indexOf('<table class="fields roster">'), o.indexOf('</table>', o.indexOf('<table class="fields roster">')));
    expect(roster.match(/<tr class="/g)).toHaveLength(3);
    expect(roster).toContain('<a href="#scout">Scout</a>');
    expect(roster).toContain('<b>98%</b> <span class="n">57/58</span>');
    expect(roster).toContain('<b>86%</b> <span class="n">50/58</span>');
    expect(roster).toContain('<span class="t-good">1 of 1 pass</span>');
    expect(roster).toContain('0 of 1 trusted');
    // Agent × path bars with a legend and the 90% line; the run line waits for a second keyed run.
    expect(o).toContain('<svg class="gbars"');
    expect(o).toContain('<title>Scout — Fallback (gated): 98% (57/58)</title>');
    expect(o).toContain('<ul class="legend-row"><li><i class="sw s-0"></i>Fallback (gated)</li>');
    expect(o).toContain('<title>target 90%</title>');
    expect(o).toContain('Appears after the second keyed run (1 so far)');
    const older = historyEntry('run-0', '2026-10-07T11:00:00.000Z', { promptVersions: { scout: 'scout-routing-0.04', judge: '0.05' }, summaries: current.summaries });
    const two = overview(renderReport({ report: current, rows: [], cases: {}, metrics: METRICS, targets, history: [older] }));
    expect(two).toContain('<svg class="linechart"');
    expect(two).toContain('<title>prompt change: scout → 0.05</title>');
    expect(two).toContain('Fallback 94%</text>');
    expect(two).toContain('Model 80%</text>');
    // The full metric table is still there, one disclosure down.
    expect(o).toContain('<details class="metric-table" id="metric-table" open>');
  });
});

describe('stakeholder sections — section pattern, readiness ladder, review queues, actions, calibration cards, fixture profile', () => {
  // A run with one of everything: a wrong fallback on a gated metric, a template text the
  // judge fails, a judge that passed a planted fault, and two judges short of the floor.
  const judged = (metric: string, caseId: string, source: 'template' | 'model', score: number, dims: Record<string, number>, reasoning = ''): GraderResult =>
    grade({ caseId, metric, grader: 'judge', source, isCorrect: score >= 1, score, dimensions: dims, reasoning });
  const calibration: NonNullable<EvalReport['calibration']> = {
    judgeVersion: '0.05',
    nCases: 14,
    judges: [
      { judge: 'scoutRationale', n: 11, nErrored: 0, agreement: 10 / 11, dimensions: {} },
      { judge: 'envoyDraft', n: 3, nErrored: 0, agreement: 2 / 3, dimensions: {} },
    ],
  };
  const calRows: CalibrationResult[] = [
    ...Array.from({ length: 10 }, (_, i) => calRow(`sr-ok-${i}`, 'scoutRationale', i % 2 === 0, i % 2 === 0)),
    calRow('sr-leak', 'scoutRationale', true, false),
    calRow('ed-ok', 'envoyDraft', true, true),
    calRow('ed-ok-2', 'envoyDraft', false, false),
    calRow('ed-strict', 'envoyDraft', false, true),
  ];
  const current = report({
    generatedAt: '2026-10-08T12:00:00.000Z',
    nCases: 50,
    judgesRan: true,
    modelCallsRan: true,
    summaries: [
      summaryFor('scoutRouting', { nHeuristic: 2, heuristicPassRate: 0.5, nModel: 2, modelPassRate: 1 }),
      summaryFor('scoutRationale', { nJudge: 2, judgePassRate: 1, judgeMeanScore: 1, nModelJudge: 2, modelJudgePassRate: 1, modelJudgeMeanScore: 1 }),
      summaryFor('envoyDraft', { nJudge: 1, judgePassRate: 0, judgeMeanScore: 0.5, nModelJudge: 1, modelJudgePassRate: 1, modelJudgeMeanScore: 1 }),
      summaryFor('pulseHealth', { nHeuristic: 1, heuristicPassRate: 1 }),
    ],
    calibration,
    run: manifest('run-9'),
  });
  const rows: GradedRow[] = [
    { caseId: 'r-1', metric: 'scoutRouting', grades: [grade({ caseId: 'r-1', isCorrect: false, score: 0, reasoning: 'bucket=A (expected B), hitlTier=L3 (expected L3)', dimensions: { bucketMatch: 0, tierMatch: 1 } }), grade({ caseId: 'r-1', grader: 'model', dimensions: { bucketMatch: 1, tierMatch: 1 } })] },
    { caseId: 'r-2', metric: 'scoutRouting', grades: [grade({ caseId: 'r-2', dimensions: { bucketMatch: 1, tierMatch: 1 } }), grade({ caseId: 'r-2', grader: 'model', dimensions: { bucketMatch: 1, tierMatch: 1 } })] },
    { caseId: 'e-1', metric: 'envoyDraft', grades: [judged('envoyDraft', 'e-1', 'template', 0.5, { appropriate: 0, grounded: 1 }, 'The kickoff email promises a dashboard. The plan has none.'), judged('envoyDraft', 'e-1', 'model', 1, { appropriate: 1, grounded: 1 })] },
  ];
  const cases = {
    scoutRouting: [
      { id: 'r-1', input: {}, expected: { bucket: 'B', composite_signal: 'Ready', hitlTier: 'L2' }, note: 'a clear ML case' },
      { id: 'r-2', input: {}, expected: { bucket: 'B', composite_signal: 'Ready', hitlTier: 'L3' }, note: 'the same, L3' },
    ],
    scoutRationale: [
      { id: 'r-1', input: {}, expected: { bucket: 'B', composite_signal: 'Ready', hitlTier: 'L2' } },
      { id: 'r-2', input: {}, expected: { bucket: 'B', composite_signal: 'Ready', hitlTier: 'L3' } },
    ],
    envoyDraft: [{ id: 'e-1', input: {}, expected: { mentionsCadence: true } }],
    pulseHealth: Array.from({ length: 20 }, (_, i) => ({ id: `p-${i}`, input: {}, expected: { status: i < 15 ? 'on_track' : 'at_risk' } })),
  };
  const targets = { scout_routing_pass_rate: 1, pulse_health_pass_rate: 1 };
  const render = (over: Partial<Parameters<typeof renderReport>[0]> = {}) => renderReport({ report: current, rows, cases, metrics: METRICS, targets, calibrationRows: calRows, ...over });
  const section = (html: string, id: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</section>', html.indexOf(`id="${id}"`)));

  it('every section opens with the tab name, a question and an answering lead', () => {
    const html = render();
    expect(html).toContain('<div class="section-header"><span class="num">Overview</span>');
    expect(html).toContain('<h2 id="overview-h">Is each agent ready to ship behind its gate?</h2>');
    expect(section(html, 'overview')).toContain('<p class="lead">Scope: offline, 50 hand-written cases, fallback + judges + model path — not live traffic.</p>');
    expect(section(html, 'readiness')).toContain('<div class="section-header sub"><span class="num">Overview</span>');
    expect(html).toContain('<h3 id="readiness-h">How far are we from gating the agents on prose quality?</h3>');
    expect(html).not.toContain('class="eyebrow"');
    expect(html).toContain('<h2 id="triage-h">What do we fix first?</h2>');
    expect(html).toContain('<h2 id="actions-h">What do we do before the next run?</h2>');
    expect(html).toContain('<h2 id="cal-h">Can the AI judges be trusted, and how does this run compare with the last?</h2>');
    expect(html).toContain('<h3 id="fixtures-h">What do the hand-written cases actually cover?</h3>');
    expect(html).toContain('<span class="num">Calibration</span>\n    <h2 id="score-h">');
    expect(html).not.toContain('<span class="num">Judges</span>');
    expect(html).not.toContain('<span class="num">Runs</span>');
    expect(html).not.toContain('<span class="num">Method</span>');
    // Sections come in reading order: overview, review, actions, method (ladder, fixtures) on the overview; judges then runs on calibration.
    const order = ['id="overview"', 'id="triage-h"', 'id="actions"', 'id="method"', 'id="readiness"', 'id="fixtures"', 'id="cal-h"', 'id="judges"', 'id="runs"', 'id="score-h"'];
    const at = order.map((m) => html.indexOf(m));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // A partial run gets an amber callout on the overview; a full run does not.
    const partial = renderReport({ report: { ...current, modelCallsRan: false }, rows: [], cases: {}, metrics: METRICS, targets });
    expect(section(partial, 'overview')).toContain('<aside class="callout amber"><strong>Partial run.</strong> The model path did not run');
    expect(section(html, 'overview')).not.toContain('callout amber');
  });

  it('readiness ladder: each rung derived from the run, the first undone rung is the blocker, outside facts come from the caller', () => {
    const html = render();
    const ladder = section(html, 'readiness');
    // Fixtures: scoutRouting (2), envoyDraft (1) are under the 20-case floor; pulseHealth (20) is at it.
    expect(ladder).toContain('Fixtures written');
    expect(ladder).toContain('<code>scoutRouting</code> 2, <code>envoyDraft</code> 1 under 20.');
    // Fallback gated: scoutRouting fails its gate, pulseHealth passes, grounding metrics absent from this run.
    expect(ladder).toContain('2 of 2 gated, <span class="t-bad">1 failing</span>.');
    expect(ladder).toContain('<span class="rung done">Done</span></td><td>This run judged 2 metrics.');
    // Calibrated: scoutRationale at 91% on 11 is trusted; envoyDraft at 67% on 3 needs 7 more labels.
    expect(ladder).toContain('1 of 2 judges trusted; short: envoyDraft (67% on 3, needs 7 more labels).');
    expect(ladder).toContain('0 of 2 judge metrics have a threshold in targets.yaml.');
    expect(ladder).toContain('Not checked — rater sheets live in <code>reports/output/kappa/</code>.');
    expect(ladder).toContain('Only the heuristic job runs in CI; judge runs are manual.');
    // The lede names the first undone rung as the blocker, and that row is marked.
    expect(ladder).toContain('<strong>2 of 8</strong> steps done. The current blocker is <strong>fixtures written</strong>:');
    expect(ladder).toMatch(/<tr class="rung-partial blocker"><td class="num">1<\/td><th scope="row">Fixtures written/);
    expect(ladder).toContain('<aside class="callout teal"><strong>Rule.</strong> A judge is trusted at 80%+ agreement');
    // The ladder names the kind of fix per step, never a person.
    expect(ladder).toContain('<th>#</th><th>Step</th><th>Status</th><th>Evidence</th><th>Where</th>');
    expect(ladder).toContain('<td>Fixture / rubric</td></tr>');
    const outside = render({ readiness: { kappaSheets: 2, judgeCiJob: true } });
    expect(section(outside, 'readiness')).toContain('2 rater sheets in <code>reports/output/kappa/</code>; two are needed for κ.');
    expect(section(outside, 'readiness')).toContain('<span class="rung done">Done</span></td><td>A workflow runs the judges.');
    expect(section(outside, 'readiness')).toContain('<strong>4 of 8</strong> steps done.');
  });

  it('review queues: sized per bucket with the human decision, the first items inline as expected vs got, judge disagreements as a queue', () => {
    const html = render();
    const t = section(html, 'triage-h');
    expect(t).toContain('<h3>Review queues <span class="count">4</span></h3>');
    expect(t).toContain('<th scope="row">Wrong fallback</th><td class="num">1</td><td>Is the fixture right? Yes → fix the code. No → fix the fixture.</td>');
    expect(t).toContain('<th scope="row">Fallback text fails</th><td class="num">1</td>');
    expect(t).toContain('<th scope="row">Judge disagrees with a hand label</th><td class="num">2</td><td>Is the hand label right? Yes → tighten the rubric line. No → relabel the output.</td>');
    expect(t).not.toContain('<th scope="row">No verdict</th>');
    // Examples: the exact-match row shows the mismatched field both ways and the fixture note; the judge row shows the lost dimension and the judge's first sentence.
    expect(t).toContain('<td><code>bucket</code> B</td><td><code>bucket</code> A</td><td class="why">a clear ML case</td>');
    expect(t).toContain('<td>every rubric dimension met</td><td>lost <code>appropriate</code> · score 0.50</td><td class="why">The kickoff email promises a dashboard.</td>');
    // The lenient disagreement is a leak and gets the amber callout; the harsh one is listed beside it.
    expect(t).toContain('<aside class="callout amber"><strong>1 lenient verdict.</strong>');
    expect(t).toContain('<span class="pill fail">lenient</span></td><td>scoutRationale<br><a href="#calibration"><code>sr-leak</code></a></td><td>reader: fail on <code>grounded</code></td><td>judge: pass</td>');
    expect(t).toContain('<code>ed-strict</code></a></td><td>reader: pass</td><td>judge: fail on <code>grounded</code></td>');
    // The bucketed lists still follow the queues.
    expect(t.indexOf('Review queues')).toBeLessThan(t.indexOf('Every failing verdict, by what it means'));
    // Nothing failing and every judge agreeing: no queue at all.
    const clean = renderReport({ report: report({ summaries: [summaryFor('scoutRouting', { nHeuristic: 1, heuristicPassRate: 1 })] }), rows: [{ caseId: 'ok', metric: 'scoutRouting', grades: [grade({ caseId: 'ok' })] }], cases: {}, metrics: METRICS });
    expect(section(clean, 'triage-h')).toContain('No review queue: every verdict passed and every judge agreed with its labels.');
  });

  it('actions: one row per kind of fix × metric derived from the queues and the ladder, priority 1 for anything that blocks a gate', () => {
    const html = render();
    const a = section(html, 'actions');
    expect(a).toContain('<strong>5 actions</strong>, 2 at priority 1.');
    const rowsOf = a.slice(a.indexOf('<tbody>'), a.indexOf('</tbody>')).split('</tr>').filter((r) => r.includes('<tr'));
    expect(rowsOf).toHaveLength(5);
    // Sorted by priority: the wrong fallback (gated) and the lenient judge first.
    expect(a).toContain('<th>#</th><th>Where</th><th>Action</th><th>Expected outcome</th><th>Effort</th><th>Priority</th>');
    expect(rowsOf[0]).toContain('<td>Code</td><td>Fix the fallback for <strong>Routing accuracy</strong> on <code>bucket</code>: <code>r-1</code>.</td><td>Gate for Routing accuracy passes.</td><td class="num">S</td><td class="num">P1</td>');
    expect(rowsOf[1]).toContain('<td>Rubric</td><td>Tighten the <strong>scoutRationale</strong> rubric on <code>grounded</code>: it passed <code>sr-leak</code>.</td><td>No lenient verdict; scoutRationale trusted at 80%+.</td>');
    expect(a).toContain('<td>Rubric</td><td>Check the <strong>envoyDraft</strong> labels or soften its rubric: it failed <code>ed-strict</code> that a reader passed.</td>');
    expect(a).toContain('<td>Fallback text</td><td>Revise the fallback text for <strong>Email quality</strong> on <code>appropriate</code>: <code>e-1</code>.</td><td>Fallback judge rate on Email quality rises by 1 case.</td><td class="num">S</td><td class="num">P2</td>');
    expect(a).toContain('<td>Readiness: fixtures written — <code>scoutRouting</code> 2, <code>envoyDraft</code> 1 under 20.</td><td>The next rung of the <a href="#readiness">ladder</a> turns green.</td>');
    expect(a).not.toContain('<td>Prompt</td>');
    // A clean run with a complete ladder has no table.
    const clean = renderReport({
      report: report({ judgesRan: true, modelCallsRan: true, summaries: [summaryFor('pulseHealth', { nHeuristic: 20, heuristicPassRate: 1 })], calibration: { judgeVersion: '0.05', nCases: 0, judges: [] } }),
      rows: [],
      cases: { pulseHealth: cases.pulseHealth },
      metrics: { pulseHealth: METRICS.pulseHealth },
      targets,
      readiness: { kappaSheets: 2, judgeCiJob: true },
    });
    expect(section(clean, 'actions')).toContain('Nothing to do from this run');
    expect(section(clean, 'actions')).not.toContain('<table');
  });

  it('calibration: one card per judge with a strip plot split by hand label against the pass line, and the sample card against the floor', () => {
    const html = render({ calibrationCases: [{ id: 'sr-ok-0', judge: 'scoutRationale', caseId: 'r-1', expected: { isCorrect: true, failed: [] } }, { id: 'sr-leak', judge: 'scoutRationale', caseId: 'r-1', patch: { rationale: 'x' }, expected: { isCorrect: false, failed: ['grounded'] } }] });
    const cal = section(html, 'calibration');
    expect(cal).toContain('<strong>1 of 2</strong> judges trusted (80%+ agreement on 10+ outputs).');
    expect(cal).toContain('<aside class="callout amber"><strong>1 judge under the 10-output floor</strong> (envoyDraft on 3).');
    const cards = cal.slice(cal.indexOf('<div class="judge-cards">'), cal.indexOf('<p class="legend chart-note">'));
    expect(cards.match(/<div class="judge-card /g)).toHaveLength(2);
    const card = cards.slice(cards.indexOf('<div class="judge-card tone-good">'), cards.indexOf('<div class="judge-card tone-warn">'));
    expect(card).toContain('<h3>scoutRationale <span class="pill pass">trusted</span></h3>');
    expect(card).toContain('<span class="num t-good">91%</span><span class="label">agreement with hand labels</span>');
    expect(card).toContain('<div class="fill good" style="width:91%"></div><div class="target" style="left:80%"></div>');
    expect(card).toContain('<b class="t-good">11 of 10</b> labelled outputs toward the floor · <span class="t-bad">1 lenient</span> · <span class="">0 harsh</span>');
    expect(card).toContain('<span class="t-bad">1 reader-failed output at the pass mark</span> — lenient');
    const plot = card.slice(card.indexOf('<figure class="stripplot">'), card.indexOf('</figure>'));
    // Two rails, one per hand label, and the pass threshold drawn through both at score 1.
    expect(plot).toContain('>Reader: pass</text>');
    expect(plot).toContain('>Reader: fail</text>');
    expect(plot).toContain('<line class="pass-line" x1="310.0" x2="310.0"');
    expect(plot).toContain('<title>pass threshold 1</title>');
    // calRow gives a passing verdict score 1 and a failing one 0: labelled passes sit on the line in green, the leak sits on the line in red with a ring.
    expect(plot).toContain('<circle class="dot label-pass agreed" cx="310.0"');
    expect(plot).toContain('<circle class="dot label-fail agreed" cx="78.0"');
    expect(plot).toContain('<circle class="dot label-fail lenient" cx="310.0"');
    expect(plot).toContain('<title>sr-leak — reader: fail; judge: pass (score 1.00) — lenient</title>');
    const thinCard = cards.slice(cards.indexOf('<div class="judge-card tone-warn">'));
    expect(thinCard).toContain('<h3>envoyDraft <span class="pill borderline">under the floor</span></h3>');
    expect(thinCard).toContain('<b class="t-warn">3 of 10</b> labelled outputs toward the floor');
    expect(thinCard).toContain('<span class="t-warn">1 reader-passed output under it</span> — harsh');
    expect(cal).toContain('<h4>Why the labelled set is 14 outputs</h4>');
    // The fixture says one untouched and one planted for scoutRationale; envoyDraft falls back to the rows' labels.
    expect(cal).toContain('<th scope="row">scoutRationale</th><td class="num">11</td><td class="num">1</td><td class="num">1</td><td class="num">11</td><td><span class="t-good">at the floor</span></td>');
    expect(cal).toContain('<tr class="thin"><th scope="row">envoyDraft</th><td class="num">3</td><td class="num">2</td><td class="num">1</td><td class="num">3</td><td><span class="t-warn">7 more to reach the floor</span></td>');
  });

  it('fixture profile: one group per fixture file, cases split per short expected field, leaning fields and thin files flagged', () => {
    const html = render();
    const f = section(html, 'fixtures');
    expect(f).toContain('<strong>3 fixture files</strong>, <span class="t-warn">2 under the 20-case floor</span>; 1 field where one value covers 70%+ of the cases.');
    // scoutRouting serves two metrics and is listed once; its hitlTier splits evenly, bucket has one value and is not tabled.
    expect(f).toContain('<code>scoutRouting</code><span class="role">2 cases · <span class="t-warn">under the 20-case floor</span> · graded by Routing accuracy, Rationale quality</span>');
    expect(f).toContain('<th scope="row"><code>hitlTier</code></th><td><span class="pv"><code>L2</code> 1 <small>50%</small></span> <span class="pv"><code>L3</code> 1 <small>50%</small></span></td><td class="why">2 values, none above 70%.</td>');
    expect(f).not.toContain('<code>bucket</code></th>');
    expect(f).toContain('<code>pulseHealth</code><span class="role">20 cases · graded by Health status</span>');
    expect(f).toContain('<span class="t-warn">75% of cases share one value</span> — a rate on this field is mostly that value.');
    expect(f).toContain('<code>envoyDraft</code><span class="role">1 case');
    expect(f).toContain('No short-valued expected field to split on.');
  });

  it('scoreboard and check tables carry a "what it means" column derived from the gate, the model gap and the judge', () => {
    const html = render();
    const s = section(html, 'score-h');
    expect(s).toContain('<th>Gate</th><th>What it means</th>');
    expect(s).toContain('<td class="why"><span class="t-bad">Blocks a deploy</span>: 50% is below the 100% target. Model 50 pts ahead of the fallback.</td>');
    expect(s).toContain('<td class="why">Reported only; no threshold yet. Model matches the fallback. Judge trusted.</td>');
    expect(s).toContain('<td class="why">Reported only; no threshold yet. Model 100 pts ahead of the fallback. Judge calibrated on 3: indicative.</td>');
    expect(s).toContain('<td class="why">Fallback certified by the gate.</td>');
    const c = section(html, 'checks-h');
    expect(c).toContain('<th>Model</th><th>What it means</th>');
    expect(c).toContain('<td class="why">The fallback rule that sets this field is wrong on 1 of 2 cases — this is what fails the gate.</td>');
    expect(c).toContain('<td class="why">The fallback text misses this rubric line; the model meets it — a string fix.</td>');
    expect(c).toContain('<td class="why">Holds on both paths.</td>');
  });
});

describe('agent tabs — cases, the filter bar, the dimension chart, page weight', () => {
  const judged = (metric: string, caseId: string, source: 'template' | 'model', score: number, dims: Record<string, number>, output: string): GraderResult =>
    grade({ caseId, metric, grader: 'judge', source, isCorrect: score >= 1, score, dimensions: dims, output, reasoning: score >= 1 ? 'Grounded and on cadence.' : 'Promises a dashboard the plan does not have.' });
  const input = () => ({
    report: report({
      judgesRan: true,
      modelCallsRan: true,
      summaries: [summaryFor('envoyDraft', { nJudge: 2, judgePassRate: 0.5, judgeMeanScore: 0.75, nModelJudge: 2, modelJudgePassRate: 1, modelJudgeMeanScore: 1 })],
    }),
    rows: [
      { caseId: 'e-ok', metric: 'envoyDraft', grades: [judged('envoyDraft', 'e-ok', 'template', 1, { appropriate: 1, grounded: 1 }, 'Hi <team>, see you Thursday'), judged('envoyDraft', 'e-ok', 'model', 1, { appropriate: 1, grounded: 1 }, 'Hi <team>, see you Thursday')] },
      { caseId: 'e-bad', metric: 'envoyDraft', grades: [judged('envoyDraft', 'e-bad', 'template', 0.5, { appropriate: 0, grounded: 1 }, 'We will ship a dashboard'), judged('envoyDraft', 'e-bad', 'model', 1, { appropriate: 1, grounded: 1 }, 'We will ship a plan')] },
    ] as GradedRow[],
    cases: { envoyDraft: [{ id: 'e-ok', input: {}, expected: { mentionsCadence: true }, note: 'a clean kickoff' }, { id: 'e-bad', input: {}, expected: { mentionsCadence: true } }] },
    metrics: METRICS,
  });

  it('renders a failing case inline and a passing case from the blob, with identical outputs stored once', () => {
    const html = renderReport(input());
    const bad = caseBlock(html, 'e-bad');
    expect(bad).toContain('data-state="fail" data-search="e-bad" data-lanes="judge" data-dims="appropriate"');
    expect(bad).toContain('<div class="case-body"><div class="expected">');
    expect(bad).toContain('<li class="miss"><span>appropriate</span>');
    expect(bad).toContain('Judge’s reasoning:</span> Promises a dashboard the plan does not have.');
    expect(bad).toContain('<pre data-o="0"></pre>');
    const ok = caseBlock(html, 'e-ok');
    expect(ok).toContain('data-state="pass" data-search="e-ok"><summary>');
    expect(ok).toContain('<span class="note">a clean kickoff</span>');
    expect(ok).toContain('<span class="pill pass">Judge on fallback: pass 1.00</span>');
    expect(ok).not.toContain('case-body');
    const blob = JSON.parse(html.slice(html.indexOf('id="case-data">') + 'id="case-data">'.length, html.indexOf('</script>', html.indexOf('id="case-data">')))) as {
      outputs: unknown[];
      expected: unknown[];
      cases: Record<string, { e?: number; g: Array<Record<string, unknown>> }>;
    };
    // Failing cases render first, so their outputs are stored first; the passing pair shares one entry.
    expect(blob.outputs).toEqual(['We will ship a dashboard', 'We will ship a plan', 'Hi &lt;team&gt;, see you Thursday']);
    expect(blob.expected).toEqual([[['mentionsCadence', 'true']]]);
    expect(Object.keys(blob.cases)).toEqual(['envoyDraft:e-ok']);
    expect(blob.cases['envoyDraft:e-ok']).toEqual({
      e: 0,
      g: [
        { l: 'judge', c: 1, d: { appropriate: 1, grounded: 1 }, r: 'Grounded and on cadence.', o: 2 },
        { l: 'modelJudge', c: 1, d: { appropriate: 1, grounded: 1 }, r: 'Grounded and on cadence.', o: 2 },
      ],
    });
  });

  it('gzips the blob once it is large, and the page inflates it to the same records', () => {
    const many = Array.from({ length: 150 }, (_, i) => `e-${i}`);
    const html = renderReport({
      ...input(),
      rows: many.map((id) => ({ caseId: id, metric: 'envoyDraft', grades: [judged('envoyDraft', id, 'template', 1, { appropriate: 1, grounded: 1 }, `Grounded, on cadence and specific about the ${id} kickoff and its follow-up. `.repeat(4))] })) as GradedRow[],
    });
    const raw = html.slice(html.indexOf('id="case-data">') + 'id="case-data">'.length, html.indexOf('</script>', html.indexOf('id="case-data">')));
    expect(raw.startsWith('{"gzip":"')).toBe(true);
    expect(raw).not.toContain('<');
    const inflated = JSON.parse(gunzipSync(Buffer.from((JSON.parse(raw) as { gzip: string }).gzip, 'base64')).toString('utf-8')) as { outputs: string[]; cases: Record<string, { g: Array<{ o: number }> }> };
    expect(Object.keys(inflated.cases)).toHaveLength(150);
    expect(inflated.outputs[inflated.cases['envoyDraft:e-7'].g[0].o]).toContain('the e-7 kickoff');
    expect(raw.length).toBeLessThan(JSON.stringify(inflated).length / 4);
  });

  it('puts one filter bar on the tab with the lanes and dimensions a case can lose on, and a per-dimension chart on the metric', () => {
    const html = renderReport(input());
    const tab = html.slice(html.indexOf('id="tab-envoy"'), html.indexOf('id="tab-calibration"'));
    expect(tab.match(/<div class="filter-bar" data-filter-bar>/g)).toHaveLength(1);
    expect(tab).toContain('<option value="judge">Fallback · judge</option><option value="modelJudge">Model · judge</option>');
    expect(tab).toContain('<option value="appropriate">appropriate</option><option value="grounded">grounded</option>');
    expect(tab).toContain('<button type="button" class="chip" data-filter="fail" aria-pressed="false">Failing</button>');
    // Dimension × path, weakest first, each bar titled with rate and counts, legend beside.
    const chart = tab.slice(tab.indexOf('<div class="dim-chart">'), tab.indexOf('</div>', tab.indexOf('<div class="dim-chart">')));
    expect(chart).toContain('<title>appropriate — Fallback: 50% (1/2)</title>');
    expect(chart).toContain('<title>grounded — Model: 100% (2/2)</title>');
    expect(chart.indexOf('appropriate — Fallback')).toBeLessThan(chart.indexOf('grounded — Fallback'));
    expect(tab).toContain('<p class="dim-why">Weakest check: <code>appropriate</code> at 50% on the fallback, 100% on the model.</p>');
    expect(tab).toContain('<p><strong>Claim.</strong> Envoy has no gated metric yet');
  });

  // Run 2 (2026-10-08, 325 cases, every lane) is the size fixture, when it is on disk. Pinned
  // to that run rather than the largest on disk: a sampled run (EVAL_MODEL_SAMPLES) carries
  // several model rows per case and would move the bar under the gate.
  const runsDir = resolve(__dirname, '..', '..', 'reports', 'output', 'runs');
  const SIZE_RUN_PREFIX = '2026-10-08T13-50-30-780Z';
  const biggest = existsSync(runsDir)
    ? readdirSync(runsDir)
        .filter((id) => id.startsWith(SIZE_RUN_PREFIX))
        .map((id) => ({ id, size: existsSync(resolve(runsDir, id, 'graded.jsonl')) ? statSync(resolve(runsDir, id, 'graded.jsonl')).size : 0 }))[0]
    : undefined;
  it.skipIf(!biggest || biggest.size === 0)('renders run 2 (325 cases, every lane) under 600 KB', () => {
    const dir = resolve(runsDir, biggest!.id);
    const run = evalReportSchema.parse(JSON.parse(readFileSync(resolve(dir, 'summary.json'), 'utf-8')));
    const rows = readFileSync(resolve(dir, 'graded.jsonl'), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => gradedRowSchema.parse(JSON.parse(l)) as GradedRow);
    const cases: Record<string, EvalCase[]> = {};
    for (const [name, def] of Object.entries(METRICS)) cases[name] = loadFixtures(def);
    const html = renderReport({ report: run, rows, cases, metrics: METRICS });
    expect(rows.length).toBeGreaterThan(100);
    expect(Buffer.byteLength(html, 'utf-8')).toBeLessThan(600_000);
  });
});
