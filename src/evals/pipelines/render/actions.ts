import type { CalibrationResult, EvalReport, GradedRow, GraderResult } from '../../types';
import { parseComparisons } from './cases';
import { readinessRungs } from './readiness';
import { callout, caseAnchor, escapeHtml, JUDGE_TRUST_AGREEMENT, laneOfGrade, metricLink, nameOf, pct, PILL_LABEL, plural, sectionHead } from './views';
import type { Lane, LaneKey, MetricView, RenderInput, Tone } from './views';

export type TriageKey = 'fallbackWrong' | 'modelWrong' | 'templateTextFails' | 'modelTextFails' | 'bothTextsFail' | 'errored';

export const TRIAGE_ORDER: TriageKey[] = ['fallbackWrong', 'templateTextFails', 'bothTextsFail', 'modelWrong', 'modelTextFails', 'errored'];

/** What each bucket means for the person fixing it. The order is the order to fix in. */
export const TRIAGE: Record<TriageKey, { title: string; means: string; tone: Tone }> = {
  fallbackWrong: {
    title: 'Fallback gives the wrong answer',
    means: 'The deterministic path disagrees with the fixture. A code bug or a wrong fixture — this is what the gate guards, so fix it first.',
    tone: 'bad',
  },
  templateTextFails: {
    title: 'Judge fails the fallback text, passes the model text',
    means: 'The fallback prose misses a rubric dimension the model prose meets on the same case. Fix the fallback string — or, if the dimension recurs across cases, the judge is harsh on it (check calibration).',
    tone: 'bad',
  },
  bothTextsFail: {
    title: 'Judge fails both texts',
    means: 'Fallback and model prose miss the rubric on the same case. Either the rubric asks for something the input cannot support, or the fixture is wrong. Read the case before changing anything.',
    tone: 'warn',
  },
  modelWrong: {
    title: 'Model disagrees with the spec',
    means: 'The fallback gets these right; the model does not. Check the fixture note first — an ambiguous case is a fixture problem, a clear one is a prompt problem.',
    tone: 'warn',
  },
  modelTextFails: {
    title: 'Judge fails the model text, passes the fallback text',
    means: 'A prompt gap, or model variance. One case is noise; the same dimension across several cases is the prompt.',
    tone: 'warn',
  },
  errored: {
    title: 'No verdict',
    means: 'The grader call failed, so these cases are in no rate. Rerun before trusting a gated rate that excludes them.',
    tone: 'none',
  },
};

export interface TriageItem {
  view: MetricView;
  row: GradedRow;
  lane: Lane;
  grade: GraderResult;
}

/** Stable id for one case's block, so the triage can link straight to it. */

export function triage(views: MetricView[]): Map<TriageKey, TriageItem[]> {
  const out = new Map<TriageKey, TriageItem[]>(TRIAGE_ORDER.map((k) => [k, []]));
  const push = (key: TriageKey, item: TriageItem) => out.get(key)!.push(item);
  for (const view of views) {
    const laneByKey = new Map(view.lanes.map((l) => [l.key, l]));
    for (const row of view.rows) {
      const byLane = new Map(row.grades.map((g) => [laneOfGrade(g), g]));
      const failed = (key: LaneKey) => {
        const g = byLane.get(key);
        return g && g.status === 'graded' && !g.isCorrect ? g : undefined;
      };
      const item = (key: LaneKey, grade: GraderResult): TriageItem => ({ view, row, lane: laneByKey.get(key)!, grade });
      for (const g of row.grades) if (g.status === 'errored') push('errored', item(laneOfGrade(g), g));
      const h = failed('heuristic');
      if (h) push('fallbackWrong', item('heuristic', h));
      const m = failed('model');
      if (m) push('modelWrong', item('model', m));
      const tj = failed('judge');
      const mj = failed('modelJudge');
      if (tj && mj) push('bothTextsFail', item('judge', tj));
      else if (tj) push('templateTextFails', item('judge', tj));
      else if (mj) push('modelTextFails', item('modelJudge', mj));
    }
  }
  return out;
}

/** The checks a verdict lost on: mismatched fields for an exact match, rubric dimensions under 1 for a judge. */
export function lostChecks(lane: Lane, g: GraderResult): string[] {
  if (lane.kind === 'exact') {
    const pairs = parseComparisons(g.reasoning);
    const norm = (s: string) => s.replace(/^\[|\]$/g, '').trim();
    if (pairs) return pairs.filter((p) => norm(p.got) !== norm(p.expected) && !(p.got === '[]' && p.expected === 'none')).map((p) => `${p.field}: got ${p.got}, expected ${p.expected}`);
    return Object.entries(g.dimensions).filter(([, v]) => v < 1).map(([k]) => k);
  }
  return Object.entries(g.dimensions).filter(([, v]) => v < 1).map(([k]) => k);
}

export function triageRow(key: TriageKey, item: TriageItem): string {
  const { view, row, lane, grade } = item;
  const metric = view.summary.metric;
  const lost = lostChecks(lane, grade);
  const what = grade.status === 'errored' ? `<code>${escapeHtml(grade.error ?? 'unknown')}</code>` : lost.length ? lost.map((l) => `<code>${escapeHtml(l)}</code>`).join(' ') : '<span class="muted">no check named</span>';
  // A judge score of 0.5 is one dimension short — worth a human read; 0.2 or below is two or more.
  const severity =
    lane.kind === 'judge' && grade.status === 'graded'
      ? grade.score >= 0.5
        ? `<span class="pill borderline" title="one rubric dimension short">${grade.score.toFixed(2)} · review</span>`
        : `<span class="pill fail" title="two or more rubric dimensions short">${grade.score.toFixed(2)} · clear fail</span>`
      : key === 'errored'
        ? '<span class="pill errored">errored</span>'
        : '<span class="pill fail">fail</span>';
  const twin = key === 'bothTextsFail' ? row.grades.find((g) => laneOfGrade(g) === 'modelJudge') : undefined;
  const twinNote = twin && twin.status === 'graded' ? ` <small class="muted">model ${twin.score.toFixed(2)}: ${escapeHtml(lostChecks(lane, twin).join(', ') || 'none lost')}</small>` : '';
  return `<tr><td>${metricLink(view)}<br><small class="muted">${escapeHtml(PILL_LABEL[lane.key])}</small></td>` +
    `<td><a href="#${escapeHtml(caseAnchor(metric, row.caseId))}"><code>${escapeHtml(row.caseId)}</code></a></td>` +
    `<td>${what}${twinNote}</td><td>${severity}</td></tr>`;
}

/**
 * Every failing verdict in the run, bucketed by what it says about the agent rather than by
 * metric: a wrong fallback is a code bug, a failing fallback text is a string to fix, a
 * failing model text is a prompt. Each row links to its case. Empty buckets are omitted.
 */
export function renderTriage(views: MetricView[], report: EvalReport, calibrationRows: CalibrationResult[]): string {
  const buckets = triage(views);
  const total = [...buckets.values()].reduce((a, b) => a + b.length, 0);
  if (total === 0) {
    return `<section class="section-block" aria-labelledby="triage-h">
    ${sectionHead('triage-h', 'Overview', 'What do we fix first?', '<span class="t-good">Nothing. Every verdict in this run passed.</span>')}
    ${renderQueues(views, calibrationRows)}
  </section>`;
  }
  const blocks = TRIAGE_ORDER.filter((k) => buckets.get(k)!.length > 0)
    .map((k) => {
      const items = buckets.get(k)!;
      const meta = TRIAGE[k];
      return `<div class="triage tone-${meta.tone}">
        <h3>${escapeHtml(meta.title)} <span class="count">${items.length}</span></h3>
        <p class="means">${escapeHtml(meta.means)}</p>
        <div class="fields-wrap"><table class="fields"><thead><tr><th>Metric · lane</th><th>Case</th><th>What it lost on</th><th>Verdict</th></tr></thead>
        <tbody>${items.map((it) => triageRow(k, it)).join('')}</tbody></table></div>
      </div>`;
    })
    .join('');
  const lede = `<strong>${plural(total, 'failing or errored verdict')}</strong> out of ${views.reduce((a, v) => a + v.rows.reduce((b, r) => b + r.grades.length, 0), 0)} this run, sorted by what each one means. Buckets are in the order to work them: a wrong fallback is a code bug and is gated; a failing template string is the next cheapest fix; model-only failures are prompt work and are never gated. <strong>review</strong> marks a judge verdict one rubric dimension short (score 0.5) — worth a human read before a fix; <strong>clear fail</strong> is two or more.`;
  return `<section class="section-block" aria-labelledby="triage-h">
    ${sectionHead('triage-h', 'Overview', 'What do we fix first?', lede)}
    ${renderQueues(views, calibrationRows)}
    <h3>Every failing verdict, by what it means</h3>
    ${blocks}
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Pass rate per check — which field or rubric dimension a metric loses on
// ---------------------------------------------------------------------------------------

export type QueueKey = TriageKey | 'judgeDisagreement';

/** The decision a human makes on an item of each queue — the question, not the fix. */
export const HUMAN_DECISION: Record<QueueKey, string> = {
  fallbackWrong: 'Is the fixture right? Yes → fix the code. No → fix the fixture.',
  templateTextFails: 'Read the fallback text: is the judge right? Yes → fix the string. No → the judge is harsh on this dimension.',
  bothTextsFail: 'Can this input support the rubric? No → relax the fixture or the rubric line. Yes → both texts need work.',
  modelWrong: 'Is the case ambiguous? Yes → fixture. No → prompt.',
  modelTextFails: 'Same dimension across cases → prompt. One case → noise, leave it.',
  errored: 'None. Rerun; the case has no verdict.',
  judgeDisagreement: 'Is the hand label right? Yes → tighten the rubric line. No → relabel the output.',
};

export const QUEUE_TITLE: Record<QueueKey, string> = {
  fallbackWrong: 'Wrong fallback',
  templateTextFails: 'Fallback text fails',
  bothTextsFail: 'Both texts fail',
  modelWrong: 'Model disagrees with spec',
  modelTextFails: 'Model text fails',
  errored: 'No verdict',
  judgeDisagreement: 'Judge disagrees with a hand label',
};

export const QUEUE_SAMPLE = 2;

/** First sentence of a judge's reasoning, as the "why queued" of an example row. */
export const WHY_MAX = 220;

/** The first sentence, cut at WHY_MAX with an ellipsis: a fixture note or a judge's reasoning can run to a paragraph. */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  const first = (m ? m[1] : text.trim()).replace(/\s+/g, ' ');
  return first.length > WHY_MAX ? `${first.slice(0, WHY_MAX - 1).trimEnd()}…` : first;
}

/** "expected B, got A" for an exact match; "lost grounded" plus the judge's first sentence for a judge. */
export function expectedVsGot(item: TriageItem): { expected: string; got: string; why: string } {
  const { lane, grade, row, view } = item;
  if (grade.status === 'errored') return { expected: '<span class="muted">not applicable</span>', got: `<code>${escapeHtml(grade.error ?? 'unknown')}</code>`, why: 'The grader call failed; the case is in no rate.' };
  if (lane.kind === 'exact') {
    const pairs = (parseComparisons(grade.reasoning) ?? []).filter((p) => p.got.replace(/^\[|\]$/g, '').trim() !== p.expected.replace(/^\[|\]$/g, '').trim() && !(p.got === '[]' && p.expected === 'none'));
    if (pairs.length) {
      return {
        expected: pairs.map((p) => `<code>${escapeHtml(p.field)}</code> ${escapeHtml(p.expected)}`).join('<br>'),
        got: pairs.map((p) => `<code>${escapeHtml(p.field)}</code> ${escapeHtml(p.got)}`).join('<br>'),
        why: escapeHtml(firstSentence(view.cases.get(row.caseId)?.note ?? '')) || 'Field mismatch.',
      };
    }
    return { expected: escapeHtml(JSON.stringify(view.cases.get(row.caseId)?.expected ?? {})), got: escapeHtml(grade.reasoning || 'no reasoning recorded'), why: 'Field mismatch.' };
  }
  const lost = Object.entries(grade.dimensions).filter(([, v]) => v < 1).map(([k]) => k);
  return {
    expected: 'every rubric dimension met',
    got: lost.length ? `lost ${lost.map((d) => `<code>${escapeHtml(d)}</code>`).join(', ')} · score ${grade.score.toFixed(2)}` : `score ${grade.score.toFixed(2)}`,
    why: escapeHtml(firstSentence(grade.reasoning)) || 'no reasoning recorded',
  };
}

export function queueExampleRow(key: QueueKey, item: TriageItem): string {
  const { expected, got, why } = expectedVsGot(item);
  return `<tr><td>${escapeHtml(QUEUE_TITLE[key])}</td><td>${metricLink(item.view)}<br><a href="#${escapeHtml(caseAnchor(item.view.summary.metric, item.row.caseId))}"><code>${escapeHtml(item.row.caseId)}</code></a></td><td>${expected}</td><td>${got}</td><td class="why">${why}</td></tr>`;
}

export function disagreementExampleRow(r: CalibrationResult): string {
  const label = r.expected.isCorrect ? 'pass' : `fail on ${r.expected.failed.map((d) => `<code>${escapeHtml(d)}</code>`).join(', ')}`;
  const said =
    r.verdict.status !== 'graded'
      ? `errored (${escapeHtml(r.verdict.error ?? 'no code')})`
      : r.verdict.isCorrect
        ? 'pass'
        : `fail on ${Object.entries(r.verdict.dimensions).filter(([, x]) => x < 1).map(([d]) => `<code>${escapeHtml(d)}</code>`).join(', ') || 'no dimension'}`;
  const kind = r.verdict.status !== 'graded' ? 'errored' : r.verdict.isCorrect ? 'lenient' : 'harsh';
  return `<tr><td>${escapeHtml(QUEUE_TITLE.judgeDisagreement)}<br><span class="pill ${kind === 'errored' ? 'errored' : 'fail'}">${kind}</span></td><td>${escapeHtml(r.judge)}<br><a href="#calibration"><code>${escapeHtml(r.id)}</code></a></td><td>reader: ${label}</td><td>judge: ${said}</td><td class="why">${escapeHtml(firstSentence(r.verdict.reasoning)) || '—'}</td></tr>`;
}

/**
 * The queues a human works through after a run, sized, each with the decision it asks
 * for and its first items shown in full — expected beside got, with the reason it was
 * queued — so a reviewer sees what the work is before opening a case.
 */
export function renderQueues(views: MetricView[], calibrationRows: CalibrationResult[]): string {
  const buckets = triage(views);
  const disagreements = calibrationRows.filter((r) => r.agreed === false || r.verdict.status !== 'graded');
  const queues: Array<{ key: QueueKey; n: number }> = TRIAGE_ORDER.map((k) => ({ key: k, n: buckets.get(k)!.length })).filter((q) => q.n > 0);
  if (disagreements.length) queues.splice(queues.findIndex((q) => q.key === 'errored') === -1 ? queues.length : queues.findIndex((q) => q.key === 'errored'), 0, { key: 'judgeDisagreement', n: disagreements.length });
  if (queues.length === 0) return '<p class="t-good">No review queue: every verdict passed and every judge agreed with its labels.</p>';
  const lenient = disagreements.filter((r) => r.verdict.status === 'graded' && r.verdict.isCorrect).length;
  const rows = queues
    .map((q) => `<tr><th scope="row">${escapeHtml(QUEUE_TITLE[q.key])}</th><td class="num">${q.n}</td><td>${escapeHtml(HUMAN_DECISION[q.key])}</td></tr>`)
    .join('');
  const examples = queues
    .flatMap((q) =>
      q.key === 'judgeDisagreement'
        ? disagreements.slice(0, QUEUE_SAMPLE).map(disagreementExampleRow)
        : buckets.get(q.key)!.slice(0, QUEUE_SAMPLE).map((it) => queueExampleRow(q.key, it)),
    )
    .join('');
  const total = queues.reduce((a, q) => a + q.n, 0);
  return `<h3>Review queues <span class="count">${total}</span></h3>
    <p class="means">Each queue is sized and names the decision a human makes per item. The first ${QUEUE_SAMPLE} of each are shown below with what was expected beside what came back; the full lists follow.</p>
    ${lenient ? callout('amber', `<strong>${plural(lenient, 'lenient verdict')}.</strong> The judge passed a hand-labelled bad output. Until the rubric line is tightened, a bad agent output of the same kind would pass the gate — work this queue before trusting any judge rate.`) : ''}
    <div class="fields-wrap"><table class="fields queues"><thead><tr><th>Queue</th><th>Items</th><th>Human decision</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h4>First items of each queue</h4>
    <div class="fields-wrap"><table class="fields queue-sample"><thead><tr><th>Queue</th><th>Metric · case</th><th>Expected</th><th>Got</th><th>Why queued</th></tr></thead><tbody>${examples}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------
// Actions — what to do next, derived from the queues and the ladder, each naming the kind of fix
// ---------------------------------------------------------------------------------------

export interface Action {
  /** The kind of fix: code, fallback text, prompt, fixture / rubric, infrastructure. */
  where: string;
  action: string;
  outcome: string;
  effort: 'S' | 'M' | 'L';
  priority: 1 | 2 | 3;
}

/** Actions shown open on the overview; the rest sit under a disclosure. */
export const ACTIONS_SHOWN = 5;

export const effortFor = (n: number): Action['effort'] => (n <= 2 ? 'S' : n <= 5 ? 'M' : 'L');

export const ACTION_WHERE: Record<QueueKey, string> = {
  fallbackWrong: 'Code',
  templateTextFails: 'Fallback text',
  bothTextsFail: 'Fixture / rubric',
  modelWrong: 'Prompt',
  modelTextFails: 'Prompt',
  errored: 'Infrastructure',
  judgeDisagreement: 'Rubric',
};

/** Group triage items by metric and name the checks they lost on, for one action line per metric. */
export function itemsByMetric(items: TriageItem[]): Array<{ view: MetricView; cases: string[]; checks: string[] }> {
  const out = new Map<string, { view: MetricView; cases: string[]; checks: string[] }>();
  for (const it of items) {
    const g = out.get(it.view.summary.metric) ?? { view: it.view, cases: [], checks: [] };
    g.cases.push(it.row.caseId);
    for (const c of lostChecks(it.lane, it.grade)) {
      const name = c.split(':')[0];
      if (!g.checks.includes(name)) g.checks.push(name);
    }
    out.set(it.view.summary.metric, g);
  }
  return [...out.values()];
}

export function actionsFor(views: MetricView[], report: EvalReport, calibrationRows: CalibrationResult[], input: RenderInput): Action[] {
  const buckets = triage(views);
  const actions: Action[] = [];
  const list = (cases: string[]) => (cases.length <= 3 ? cases.map((c) => `<code>${escapeHtml(c)}</code>`).join(', ') : `${cases.slice(0, 2).map((c) => `<code>${escapeHtml(c)}</code>`).join(', ')} and ${cases.length - 2} more`);
  const checks = (c: string[]) => (c.length ? ` on ${c.map((x) => `<code>${escapeHtml(x)}</code>`).join(', ')}` : '');
  const name = (v: MetricView) => `<strong>${escapeHtml(nameOf(v))}</strong>`;

  for (const g of itemsByMetric(buckets.get('fallbackWrong')!)) {
    actions.push({ where: ACTION_WHERE.fallbackWrong, action: `Fix the fallback for ${name(g.view)}${checks(g.checks)}: ${list(g.cases)}.`, outcome: g.view.gate.kind === 'ungated' ? 'Fallback rate back to 100%.' : `Gate for ${escapeHtml(nameOf(g.view))} passes.`, effort: effortFor(g.cases.length), priority: 1 });
  }
  for (const g of itemsByMetric(buckets.get('errored')!)) {
    actions.push({ where: ACTION_WHERE.errored, action: `Rerun ${plural(g.cases.length, 'errored grader call')} on ${name(g.view)}: ${list(g.cases)}.`, outcome: 'Every case has a verdict; the rate counts them.', effort: 'S', priority: g.view.gate.kind === 'ungated' ? 3 : 1 });
  }
  const lenient = calibrationRows.filter((r) => r.agreed === false && r.verdict.status === 'graded' && r.verdict.isCorrect);
  const harsh = calibrationRows.filter((r) => r.agreed === false && r.verdict.status === 'graded' && !r.verdict.isCorrect);
  const byJudge = (rows: CalibrationResult[]) => {
    const m = new Map<string, CalibrationResult[]>();
    for (const r of rows) m.set(r.judge, [...(m.get(r.judge) ?? []), r]);
    return [...m.entries()];
  };
  for (const [judge, rows] of byJudge(lenient)) {
    const dims = [...new Set(rows.flatMap((r) => r.expected.failed))];
    actions.push({ where: ACTION_WHERE.judgeDisagreement, action: `Tighten the <strong>${escapeHtml(judge)}</strong> rubric${checks(dims)}: it passed ${list(rows.map((r) => r.id))}.`, outcome: `No lenient verdict; ${escapeHtml(judge)} trusted at ${pct(JUDGE_TRUST_AGREEMENT)}+.`, effort: effortFor(rows.length), priority: 1 });
  }
  for (const [judge, rows] of byJudge(harsh)) {
    actions.push({ where: ACTION_WHERE.judgeDisagreement, action: `Check the <strong>${escapeHtml(judge)}</strong> labels or soften its rubric: it failed ${list(rows.map((r) => r.id))} that a reader passed.`, outcome: 'Harsh verdicts stop costing good outputs.', effort: effortFor(rows.length), priority: 2 });
  }
  for (const g of itemsByMetric(buckets.get('templateTextFails')!)) {
    actions.push({ where: ACTION_WHERE.templateTextFails, action: `Revise the fallback text for ${name(g.view)}${checks(g.checks)}: ${list(g.cases)}.`, outcome: `Fallback judge rate on ${escapeHtml(nameOf(g.view))} rises by ${plural(g.cases.length, 'case')}.`, effort: effortFor(g.cases.length), priority: 2 });
  }
  for (const g of itemsByMetric(buckets.get('bothTextsFail')!)) {
    actions.push({ where: ACTION_WHERE.bothTextsFail, action: `Read ${list(g.cases)} on ${name(g.view)}${checks(g.checks)}: decide whether the fixture or the rubric line is wrong.`, outcome: 'The case either passes or is relabelled; nothing is tuned to it.', effort: effortFor(g.cases.length), priority: 2 });
  }
  const prompt = [...itemsByMetric(buckets.get('modelWrong')!), ...itemsByMetric(buckets.get('modelTextFails')!)];
  for (const g of prompt) {
    actions.push({ where: ACTION_WHERE.modelWrong, action: `Revise the ${escapeHtml(g.view.agent)} prompt for ${name(g.view)}${checks(g.checks)}: ${list(g.cases)}.`, outcome: `Model path on ${escapeHtml(nameOf(g.view))} at 90% or better (reported, never gated).`, effort: effortFor(g.cases.length), priority: 3 });
  }
  const blocker = readinessRungs(views, report, input).find((r) => r.status !== 'done');
  if (blocker) actions.push({ where: blocker.where, action: `Readiness: ${escapeHtml(blocker.step.toLowerCase())} — ${blocker.evidence}`, outcome: `The next rung of the <a href="#readiness">ladder</a> turns green.`, effort: 'M', priority: 2 });
  return actions.sort((a, b) => a.priority - b.priority);
}

export function renderActions(views: MetricView[], report: EvalReport, calibrationRows: CalibrationResult[], input: RenderInput): string {
  const actions = actionsFor(views, report, calibrationRows, input);
  const p1 = actions.filter((a) => a.priority === 1).length;
  const lede = actions.length
    ? `<strong>${plural(actions.length, 'action')}</strong>, ${p1} at priority 1. Each row is derived from a queue above or the readiness ladder: a wrong fallback is code, a failing fallback text is a string, a lenient judge is a rubric line, a model-only miss is a prompt. Priority 1 blocks a gate; 3 is reported-only work.`
    : 'Nothing to do from this run: every verdict passed, every judge agreed with its labels, and the ladder is complete.';
  const row = (a: Action, i: number) =>
    `<tr class="p${a.priority}"><td class="num">${i + 1}</td><td>${escapeHtml(a.where)}</td><td>${a.action}</td><td>${a.outcome}</td><td class="num">${a.effort}</td><td class="num">P${a.priority}</td></tr>`;
  const table = (rows: string) =>
    `<div class="fields-wrap"><table class="fields actions"><thead><tr><th>#</th><th>Where</th><th>Action</th><th>Expected outcome</th><th>Effort</th><th>Priority</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  // The top five sit open; the rest are one click away so the overview stays one screen.
  const top = actions.slice(0, ACTIONS_SHOWN).map(row).join('');
  const rest = actions.slice(ACTIONS_SHOWN).map((a, i) => row(a, i + ACTIONS_SHOWN)).join('');
  return `<section class="section-block" id="actions" aria-labelledby="actions-h">
    ${sectionHead('actions-h', 'Overview', 'What do we do before the next run?', lede)}
    ${actions.length ? `${table(top)}${rest ? `<details class="metric-table"><summary>${actions.length - ACTIONS_SHOWN} more actions</summary>${table(rest)}</details>` : ''}<p class="legend">Effort: S one sitting, M a day, L more. Where names the surface to change: code, a fallback string, a prompt, a fixture or rubric line, or infrastructure.</p>` : ''}
  </section>`;
}

// ---------------------------------------------------------------------------------------
// Calibration dot plot and sample card
// ---------------------------------------------------------------------------------------
