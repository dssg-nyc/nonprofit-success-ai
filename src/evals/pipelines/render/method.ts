import type { EvalCase, EvalReport } from '../../types';
import { renderReadiness } from './readiness';
import { CALIBRATION_FLOOR, escapeHtml, FIXTURE_FLOOR, JUDGE_TRUST_AGREEMENT, nameOf, pct, plural, sectionHead, subHead } from './views';
import type { MetricView, RenderInput } from './views';


export const PROFILE_MAX_VALUES = 8;
export const PROFILE_LEAN = 0.7;

/** Per expected field with few distinct short values, how the cases split across them. */
export function profileFields(cases: EvalCase[]): Array<{ field: string; values: Array<[string, number]> }> {
  const counts = new Map<string, Map<string, number>>();
  for (const c of cases) {
    for (const [k, v] of Object.entries(c.expected)) {
      if (!(typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number')) continue;
      const text = String(v);
      if (text.length > 40) continue;
      const m = counts.get(k) ?? new Map<string, number>();
      m.set(text, (m.get(text) ?? 0) + 1);
      counts.set(k, m);
    }
  }
  return [...counts.entries()]
    .filter(([, m]) => m.size > 1 && m.size <= PROFILE_MAX_VALUES)
    .map(([field, m]) => ({ field, values: [...m.entries()].sort((a, b) => b[1] - a[1]) }));
}

export function renderFixtureProfile(views: MetricView[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  let thin = 0;
  let leaning = 0;
  for (const v of views) {
    const key = v.def.fixture ?? v.def.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const cases = [...v.cases.values()];
    if (cases.length === 0) continue;
    const metrics = views.filter((x) => (x.def.fixture ?? x.def.name) === key).map((x) => escapeHtml(nameOf(x))).join(', ');
    const fields = profileFields(cases);
    const under = cases.length < FIXTURE_FLOOR;
    if (under) thin += 1;
    const rows = fields
      .map(({ field, values }) => {
        const top = values[0][1] / cases.length;
        const lean = top >= PROFILE_LEAN && values.length > 1;
        if (lean) leaning += 1;
        const dist = values.map(([val, n]) => `<span class="pv"><code>${escapeHtml(val)}</code> ${n} <small>${pct(n / cases.length)}</small></span>`).join(' ');
        return `<tr><th scope="row"><code>${escapeHtml(field)}</code></th><td>${dist}</td><td class="why">${lean ? `<span class="t-warn">${pct(top)} of cases share one value</span> — a rate on this field is mostly that value.` : `${values.length} values, none above ${pct(PROFILE_LEAN)}.`}</td></tr>`;
      })
      .join('');
    blocks.push(`<tr class="group"><th colspan="3"><code>${escapeHtml(key)}</code><span class="role">${plural(cases.length, 'case')}${under ? ` · <span class="t-warn">under the ${FIXTURE_FLOOR}-case floor</span>` : ''} · graded by ${metrics}</span></th></tr>${rows || '<tr><td colspan="3" class="muted">No short-valued expected field to split on.</td></tr>'}`);
  }
  if (blocks.length === 0) return '';
  const lede = `<strong>${plural(seen.size, 'fixture file')}</strong>${thin ? `, <span class="t-warn">${thin} under the ${FIXTURE_FLOOR}-case floor</span>` : ', all at the floor'}${leaning ? `; ${plural(leaning, 'field')} where one value covers ${pct(PROFILE_LEAN)}+ of the cases` : ''}. Every case is hand-written with its expectation taken from the agent's spec, never from the code, and carries a note saying why it exists.`;
  return `<section class="section-block" id="fixtures" aria-labelledby="fixtures-h">
    ${subHead('fixtures-h', 'Overview', 'What do the hand-written cases actually cover?', lede)}
    <div class="fields-wrap"><table class="fields score-table profile"><thead><tr><th>Expected field</th><th>Cases per value</th><th>What it means</th></tr></thead><tbody>${blocks.join('')}</tbody></table></div>
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Per-case detail
// ---------------------------------------------------------------------------------------


export const GLOSSARY: Array<[string, string]> = [
  ['Fallback path', 'The agent’s deterministic path: plain code, no AI. It is what runs when the model call fails, so it must always be right.'],
  ['Model path', 'The same agent asking Gemini for the answer. Measured on the same cases, reported but never gated — model output varies between runs.'],
  ['Exact match', 'A heuristic grader: compares structured fields (bucket, tier, shape…) with the expected answer written in the fixture. All fields must match.'],
  ['Judge', 'An AI from a different vendor (OpenAI) that scores written prose 0–1 against a rubric and decides pass/fail, with its reasoning.'],
  ['Mean score', 'The judge’s average 0–1 score across cases — finer-grained than pass rate.'],
  ['Fixture / case', 'A hand-written test input with its expected answer and a note on why the case exists.'],
  ['Gated', 'targets.yaml sets a minimum pass rate; `npm run eval:grade -- --gate` fails below it.'],
  ['Ungated', 'No threshold yet, usually because the rate has not been measured often enough. Informational — not a failure.'],
  ['Errored', 'The grader could not produce a verdict (e.g. the judge call failed). Neither pass nor fail; excluded from the rate. A gated metric with errors cannot pass.'],
  ['Not evaluated', 'The path exists but was skipped this run (no API key), so there is no verdict — not a zero.'],
  ['Not applicable', 'The metric has no such path: an exact-match metric has no judge, a judge metric has no exact match.'],
  ['Evaluation error', 'Every grader call on the path failed, so there is no rate to show. Rerun before reading anything into it.'],
  ['Colours', 'Green: at or above the gate target, or ≥ 90% when ungated. Amber: 70% up to that. Red: below 70%.'],
  ['Keyed run', 'A grade run that called a judge or a model (an API key was set). Only these are logged and compared; heuristic-only runs are deterministic.'],
  ['Δ / pts', 'The change in percentage points against the previous keyed run. † beside it: the fixture changed in between, so the two rates graded different cases.'],
  ['Lenient / harsh', 'Judge calibration: lenient = the judge passed a hand-labelled bad output (a leak past the gate); harsh = it failed a good one (noise).'],
  ['Trusted judge', `A judge at ${pct(JUDGE_TRUST_AGREEMENT)}+ agreement with hand labels over ${CALIBRATION_FLOOR}+ labelled outputs. Until then its rates are indicative and never gate.`],
  ['Readiness ladder', 'The steps between this run and gating the agents on prose quality, each derived from the run; the first step not done is the current blocker.'],
  ['Review queue', 'Verdicts grouped by the human decision they need, sized, with the first items shown inline: expected beside got.'],
];


/** Relative to `reports/output/report.html`, where the page is written. */
const SPECS = [
  ['../../../../.claude/specs/platform/infra/eval-harness.md', 'eval-harness.md', 'the harness spec: lanes, gates, judge calibration, the keyed-run protocol'],
  ['../../README.md', 'src/evals/README.md', 'how to run, what each output file holds, how this page is generated'],
  ['../../targets.yaml', 'targets.yaml', 'the gate thresholds; a commented-out metric is UNGATED'],
  ['../../../../.claude/specs/design-system.md', 'design-system.md §2', 'the four-rule fallback contract every agent path meets'],
] as const;

/**
 * The method block at the foot of the Overview: how to read a verdict, the gate rule, how to
 * regenerate, where the rules live, the readiness ladder, the fixture profile, the glossary.
 * Collapsed to its header and first paragraph; `#method` opens it, `#readiness` and
 * `#glossary` open it from the inside.
 */
export function renderMethodSection(views: MetricView[], report: EvalReport, input: RenderInput): string {
  const specs = SPECS.map(([href, name, what]) => `<li><a href="${href}"><code>${name}</code></a> — ${what}</li>`).join('');
  return `<section class="section-block method" id="method" aria-labelledby="method-h" data-open-inner>
    ${sectionHead('method-h', 'Overview', 'How to read this page', 'Every number on this page is an offline measurement over hand-written fixtures. The gate reads one lane — the deterministic fallback — and nothing else certifies a deploy. Fixtures are small; a rate over 20 cases moves 5 points per case, and a judge rate is only as good as that judge’s calibration sample. Nothing in this block changes per run except the readiness table and the fixture profile.')}
    <details class="method-body"><summary>Verdict states, the gate rule, how to regenerate, where the rules live, readiness, fixtures, glossary</summary>
    <div class="method-grid">
      <div class="card"><h3>Four verdict states</h3><dl class="states">
        <dt><span class="pill pass">pass</span></dt><dd>the output met every check (exact match) or every rubric dimension (judge)</dd>
        <dt><span class="pill fail">fail</span></dt><dd>a verdict was produced and at least one check was lost — counted in the rate</dd>
        <dt><span class="pill errored">errored</span></dt><dd>the grader call failed (timeout, bad JSON): no verdict, left out of the rate, never a fail</dd>
        <dt><span class="pill absent">not evaluated</span></dt><dd>no verdict was sought: the path was skipped (no model key) or the metric has no such path (not applicable) — not a zero</dd>
      </dl></div>
      <div class="card"><h3>The gate rule</h3><ul>
        <li>A metric is gated when <code>targets.yaml</code> holds a threshold for it; the rate must be at or above it.</li>
        <li>The gate reads the fallback judge when it ran, the heuristic otherwise — never the model path.</li>
        <li>An errored verdict cannot certify: a gated metric with errors is marked, not passed.</li>
        <li>A judge is trusted at ${pct(JUDGE_TRUST_AGREEMENT)}+ agreement on ${CALIBRATION_FLOOR}+ labelled outputs; a metric is gated over ${FIXTURE_FLOOR}+ cases.</li>
      </ul></div>
      <div class="card"><h3>How to regenerate</h3><ol>
        <li><code>npm run eval:grade</code> — fallback lanes; add <code>-- --judges</code> and <code>-- --model</code> with keys set for a keyed run, <code>-- --gate</code> to fail on a gate.</li>
        <li><code>npm run eval:report</code> — rewrites this page from the latest run; <code>EVAL_RUN=&lt;id&gt;</code> renders an earlier one.</li>
        <li>Runs are experiments: never overwrite or delete one; label a run with <code>EVAL_LABEL</code>.</li>
      </ol></div>
      <div class="card"><h3>Where the rules live</h3><ul>${specs}</ul></div>
    </div>
    ${renderReadiness(views, report, input)}
    ${renderFixtureProfile(views)}
    <details class="glossary" id="glossary"><summary>Glossary and legend</summary>
      <div class="glossary-grid">${GLOSSARY.map(([k, v]) => `<div class="glossary-card"><b>${escapeHtml(k)}</b><p>${escapeHtml(v)}</p></div>`).join('')}</div>
    </details>
    </details>
  </section>`;
}
