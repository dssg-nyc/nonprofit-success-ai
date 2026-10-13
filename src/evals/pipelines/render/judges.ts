import type { CalibrationCase, CalibrationResult, CalibrationSummary, EvalReport } from '../../types';
import { judgeConfusion } from '../history';
import type { JudgeConfusion, RunHistoryEntry } from '../history';
import { shortStamp, TREND_WINDOW, withCurrent } from './keyed';
import { CALIBRATION_FLOOR, escapeHtml, FIXTURE_FLOOR, pct, plural, toneFor } from './views';
import type { Tone } from './views';

/**
 * Judge calibration helpers: the confusion cells, the per-judge table, the disagreement
 * list, the trend across judge versions and the sample card. `calibration.ts` composes
 * them into the tab.
 */

export function confusionCells(c: JudgeConfusion): string {
  const graded = c.tp + c.lenient + c.harsh + c.tn;
  const cell = (n: number, tone: Tone, title: string) => `<td class="t-${n > 0 ? tone : 'none'}" title="${escapeHtml(title)}">${n}</td>`;
  return (
    cell(c.tp, 'good', 'Judge passed an output the reader also passed') +
    cell(c.tn, 'good', 'Judge failed an output the reader also failed') +
    cell(c.lenient, 'bad', 'Judge passed an output the reader failed — a bad output would pass the gate') +
    cell(c.harsh, 'warn', 'Judge failed an output the reader passed — noise, not a leak') +
    `<td class="${c.errored ? 't-err' : 'none'}">${c.errored}</td>` +
    `<td class="none">${graded}</td>`
  );
}

/**
 * Per judge this run: agreement, the four confusion cells (or the graded count when the
 * rows are not on disk), and agreement per rubric dimension.
 */
export function calibrationTable(cal: CalibrationSummary, rows: CalibrationResult[]): string {
  const body = cal.judges
    .map((j) => {
      const c = judgeConfusion(rows, j.judge);
      const dims = Object.entries(j.dimensions)
        .map(([d, x]) => `${escapeHtml(d)} <b class="t-${toneFor(x.agreement)}">${pct(x.agreement)}</b> <span class="muted">(${x.n})</span>`)
        .join(' · ');
      return `<tr><th scope="row">${escapeHtml(j.judge)}</th><td class="t-${toneFor(j.agreement)}"><b>${pct(j.agreement)}</b></td>${
        rows.length ? confusionCells(c) : `<td colspan="6" class="none">${j.n - j.nErrored} graded${j.nErrored ? `, ${j.nErrored} errored` : ''}</td>`
      }<td class="dims-cell">${dims || '<span class="muted">no dimensions</span>'}</td></tr>`;
    })
    .join('');
  return `<div class="fields-wrap"><table class="fields cal-table"><thead><tr><th>Judge</th><th>Agreement</th><th>Agreed pass</th><th>Agreed fail</th><th>Lenient</th><th>Harsh</th><th>Errored</th><th>Graded</th><th>Per dimension</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Every verdict that missed its label, or errored, with the judge's own reasoning. */
export function disagreementList(rows: CalibrationResult[]): string {
  const disagreements = rows.filter((r) => r.agreed === false || r.verdict.status !== 'graded');
  if (disagreements.length === 0) return '<p class="muted">The judge agreed with every label.</p>';
  const list = disagreements
    .map((r) => {
      const label = r.expected.isCorrect ? 'pass' : `fail: ${r.expected.failed.join(', ')}`;
      const said =
        r.verdict.status !== 'graded'
          ? `errored (${r.verdict.error ?? 'no code'})`
          : r.verdict.isCorrect
            ? 'pass'
            : `fail: ${Object.entries(r.verdict.dimensions).filter(([, x]) => x === 0).map(([d]) => d).join(', ') || 'no dimension'}`;
      const kind = r.verdict.status !== 'graded' ? 'errored' : r.verdict.isCorrect ? 'lenient' : 'harsh';
      return `<li class="cal-${kind}"><code>${escapeHtml(r.id)}</code> <span class="pill ${kind === 'errored' ? 'errored' : 'fail'}">${kind}</span> <span class="muted">${escapeHtml(r.judge)}</span> — reader: <b>${escapeHtml(label)}</b>; judge: <b>${escapeHtml(said)}</b>${
        r.verdict.reasoning ? `<p class="reasoning">${escapeHtml(r.verdict.reasoning)}</p>` : ''
      }</li>`;
    })
    .join('');
  return `<h4>${plural(disagreements.length, 'disagreement')}</h4><ul class="cal-list">${list}</ul>`;
}

/** Agreement per judge across the last keyed runs that calibrated one; empty under two such runs. */
export function calibrationTrend(report: EvalReport, rows: CalibrationResult[], history: RunHistoryEntry[]): string {
  const earlier = withCurrent(report, history).filter((h) => h.calibration);
  if (earlier.length < 2) return '';
  const window = earlier.slice(-TREND_WINDOW);
  const judges: string[] = [];
  for (const h of window) for (const j of h.calibration?.judges ?? []) if (!judges.includes(j.judge)) judges.push(j.judge);
  const head = window
    .map(
      (h) =>
        `<th class="${h.id === report.run?.id ? 'current' : ''}" title="${escapeHtml(h.id)}"><time datetime="${escapeHtml(h.generatedAt)}">${escapeHtml(shortStamp(h.generatedAt))}</time><small>judge ${escapeHtml(h.calibration?.judgeVersion ?? '?')}</small></th>`,
    )
    .join('');
  const body = judges
    .map((judge) => {
      const cells = window
        .map((h) => {
          const j = h.calibration?.judges.find((x) => x.judge === judge);
          if (!j) return '<td class="none">Not evaluated</td>';
          const c = h.id === report.run?.id && rows.length ? judgeConfusion(rows, judge) : h.calibrationRows.length ? judgeConfusion(h.calibrationRows, judge) : null;
          const sub = c ? `<small><span class="${c.lenient ? 't-bad' : ''}">${c.lenient} lenient</span> · <span class="${c.harsh ? 't-warn' : ''}">${c.harsh} harsh</span></small>` : `<small>${j.n - j.nErrored} graded</small>`;
          return `<td class="t-${toneFor(j.agreement)} ${h.id === report.run?.id ? 'current' : ''}"><b>${pct(j.agreement)}</b>${sub}</td>`;
        })
        .join('');
      return `<tr><th scope="row">${escapeHtml(judge)}</th>${cells}</tr>`;
    })
    .join('');
  return `<h3>Across judge versions</h3>
    <p class="muted small">Agreement per judge per keyed run. A new judge prompt should move lenient toward zero without pushing harsh up; the labelled set is the same unless the fixture hash changed.</p>
    <div class="fields-wrap"><table class="fields trend-table"><thead><tr><th>Judge</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------


/**
 * Why the labelled set is the size it is, and what it is made of: untouched fallback
 * outputs that must pass, and outputs with one planted fault that must fail. The card
 * says per judge how far the sample is from the floor, so "agreement 67%" is read next
 * to "on 3 outputs".
 */
export function sampleCard(report: EvalReport, cases: CalibrationCase[], rows: CalibrationResult[]): string {
  const cal = report.calibration;
  if (!cal) return '';
  const judges = cal.judges.map((j) => {
    const own = cases.filter((c) => c.judge === j.judge);
    const fromRows = rows.filter((r) => r.judge === j.judge);
    const planted = own.length ? own.filter((c) => c.patch).length : fromRows.filter((r) => !r.expected.isCorrect).length;
    const untouched = own.length ? own.length - planted : fromRows.filter((r) => r.expected.isCorrect).length;
    const graded = j.n - j.nErrored;
    const short = Math.max(0, CALIBRATION_FLOOR - graded);
    return `<tr class="${short ? 'thin' : ''}"><th scope="row">${escapeHtml(j.judge)}</th><td class="num">${j.n}</td><td class="num">${untouched}</td><td class="num">${planted}</td><td class="num">${graded}</td><td>${
      short ? `<span class="t-warn">${short} more to reach the floor</span>` : `<span class="t-good">at the floor</span>`
    }</td></tr>`;
  });
  return `<div class="sample-card">
    <h4>Why the labelled set is ${plural(cal.nCases, 'output')}</h4>
    <p>Every judge is scored against outputs a careful reader labelled by hand: the agent's own fallback output left as it is (it must pass) and the same output with one planted fault — an invented date, a wrong bucket argued for, an overclaim on a thin record (it must fail). Labels are written by a person, never by a model, and the set only grows; a judge's agreement is read beside the number of outputs it was measured on. ${CALIBRATION_FLOOR} per judge is the floor before agreement counts as evidence; ${FIXTURE_FLOOR} is the target.</p>
    <div class="fields-wrap"><table class="fields"><thead><tr><th>Judge</th><th>Labelled</th><th>Untouched (must pass)</th><th>Planted fault (must fail)</th><th>Graded</th><th>Against the ${CALIBRATION_FLOOR}-output floor</th></tr></thead><tbody>${judges.join('')}</tbody></table></div>
  </div>`;
}
