/**
 * The Calibration tab: can the AI judges be trusted, and how does this run compare with
 * the last? Opens SA-style — one card per judge with its scores split by hand label on a
 * strip plot against the pass threshold — then the agreement table, the disagreements
 * with the judge's reasoning, and the trend across judge versions. The run material
 * (scoreboard, trend, checks, comparison, latency) follows, each in a collapsed details.
 */

import type { CalibrationCase, CalibrationResult, EvalReport } from '../../types';
import { judgeConfusion } from '../history';
import type { RunHistoryEntry } from '../history';
import { renderChecks, renderComparison } from './agent';
import { stripPlot } from './charts';
import { calibrationTable, calibrationTrend, disagreementList, sampleCard } from './judges';
import { withCurrent } from './keyed';
import { renderLatency, renderScoreboard, renderTrends, runClaim, runFacts } from './runs';
import { CALIBRATION_FLOOR, callout, escapeHtml, frame, JUDGE_TRUST_AGREEMENT, pct, plural, sectionHead, toneFor } from './views';
import type { MetricView } from './views';

/** The judge's pass mark: a verdict passes only when every rubric dimension is met. */
export const JUDGE_PASS_THRESHOLD = 1;

type JudgeSummary = NonNullable<EvalReport['calibration']>['judges'][number];

/** How well the judge separates the two labels, from where the misses fall against the pass mark. */
export function separationNote(lenient: number, harsh: number, graded: number): string {
  if (graded === 0) return 'No verdict graded, so nothing to separate.';
  if (lenient === 0 && harsh === 0) return 'Clean separation: every reader-failed output scored under the pass mark and every reader-passed output reached it.';
  const parts: string[] = [];
  if (lenient) parts.push(`<span class="t-bad">${plural(lenient, 'reader-failed output')} at the pass mark</span> — lenient: a bad output like it would pass the gate.`);
  if (harsh) parts.push(`<span class="t-warn">${plural(harsh, 'reader-passed output')} under it</span> — harsh: noise, not a leak.`);
  return parts.join(' ');
}

/** One card per judge: agreement against the bar, labels against the floor, the strip plot, the separation note. */
export function judgeCard(j: JudgeSummary, rows: CalibrationResult[]): string {
  const graded = j.n - j.nErrored;
  const c = judgeConfusion(rows, j.judge);
  const atFloor = graded >= CALIBRATION_FLOOR;
  const tone = j.agreement === null ? 'none' : !atFloor ? 'warn' : toneFor(j.agreement, JUDGE_TRUST_AGREEMENT);
  const trusted = atFloor && j.agreement !== null && j.agreement >= JUDGE_TRUST_AGREEMENT;
  const fill = j.agreement === null ? 0 : Math.round(j.agreement * 100);
  const plot = rows.length ? stripPlot(j.judge, rows, JUDGE_PASS_THRESHOLD) : '';
  const counts = rows.length
    ? `<span class="${c.lenient ? 't-bad' : ''}">${c.lenient} lenient</span> · <span class="${c.harsh ? 't-warn' : ''}">${c.harsh} harsh</span>${c.errored ? ` · <span class="t-err">${c.errored} errored</span>` : ''}`
    : `${graded} graded${j.nErrored ? ` · <span class="t-err">${j.nErrored} errored</span>` : ''}`;
  return `<div class="judge-card tone-${tone}">
    <h3>${escapeHtml(j.judge)} <span class="pill ${trusted ? 'pass' : atFloor ? 'fail' : 'borderline'}">${trusted ? 'trusted' : atFloor ? 'not trusted' : 'under the floor'}</span></h3>
    <div class="agree"><span class="num t-${tone}">${pct(j.agreement)}</span><span class="label">agreement with hand labels</span></div>
    <div class="track thin" title="${pct(JUDGE_TRUST_AGREEMENT)} bar"><div class="fill ${tone}" style="width:${fill}%"></div><div class="target" style="left:${JUDGE_TRUST_AGREEMENT * 100}%"></div></div>
    <p class="counts"><b class="${atFloor ? 't-good' : 't-warn'}">${graded} of ${CALIBRATION_FLOOR}</b> labelled outputs toward the floor · ${counts}</p>
    ${plot}
    <p class="note">${separationNote(c.lenient, c.harsh, graded)}</p>
  </div>`;
}

const LEGEND =
  '<p class="legend chart-note">Each dot is one hand-labelled output at the score the judge gave it: the top rail holds outputs a reader passed (<span class="t-good">green</span>), the bottom rail outputs a reader failed (<span class="t-bad">red</span>). The dashed line is the pass mark, so a red dot on the line is a lenient verdict and a green dot left of it is a harsh one. Dots stack where scores tie; hover for the output.</p>';

/** The judge half: the cards, the thin-sample warning, the table, the disagreements, the sample card — or why there is none. */
function judgesPanel(report: EvalReport, rows: CalibrationResult[], history: RunHistoryEntry[], cases: CalibrationCase[]): string {
  const cal = report.calibration;
  if (!cal) {
    const earlier = withCurrent(report, history).some((h) => h.calibration);
    const why = report.judgesRan ? 'The judges ran but were not calibrated this run, so there is no calibration for this run.' : 'Judges did not run this time, so there is no calibration for this run.';
    const how = earlier ? 'The trend below is from earlier keyed runs.' : 'No run has calibrated a judge yet: set <code>OPENAI_API_KEY</code> and run <code>npm run eval:grade -- --judges</code>; the calibration set is graded alongside the fixtures.';
    return `<div id="judges">${callout('amber', `<strong>${why}</strong> ${how}`)}</div>`;
  }
  const thin = cal.judges.filter((j) => j.n - j.nErrored < CALIBRATION_FLOOR);
  return `<div id="judges">
    <h3>This run — judge prompt <code>${escapeHtml(cal.judgeVersion)}</code>, ${plural(cal.nCases, 'labelled output')}</h3>
    <div class="judge-cards">${cal.judges.map((j) => judgeCard(j, rows.filter((r) => r.judge === j.judge))).join('')}</div>
    ${rows.length ? LEGEND : ''}
    ${thin.length ? callout('amber', `<strong>${plural(thin.length, 'judge')} under the ${CALIBRATION_FLOOR}-output floor</strong> (${thin.map((j) => `${escapeHtml(j.judge)} on ${j.n - j.nErrored}`).join(', ')}). Agreement on so few outputs is a hint, not evidence; the sample card below says how many labels each judge still needs.`) : ''}
    ${calibrationTable(cal, rows)}
    ${disagreementList(rows)}
    ${sampleCard(report, cases, rows)}
  </div>`;
}

const fold = (summary: string, body: string): string => (body ? `<details class="review fold"><summary>${summary}</summary>${body}</details>` : '');

export function renderCalibrationTab(views: MetricView[], report: EvalReport, rows: CalibrationResult[], history: RunHistoryEntry[], cases: CalibrationCase[]): string {
  const cal = report.calibration;
  const judges = cal?.judges ?? [];
  const trusted = judges.filter((j) => j.n - j.nErrored >= CALIBRATION_FLOOR && j.agreement !== null && j.agreement >= JUDGE_TRUST_AGREEMENT);
  const thin = judges.filter((j) => j.n - j.nErrored < CALIBRATION_FLOOR);
  const judgeClaim = !report.judgesRan
    ? 'The judges did not run, so no prose rate on this page was produced this run.'
    : !cal
      ? 'The judges ran but were not calibrated this run, so their rates are indicative only.'
      : trusted.length === judges.length
        ? `<span class="t-good">Every judge is trusted</span>: ${judges.length} of ${judges.length} at ${pct(JUDGE_TRUST_AGREEMENT)}+ agreement on ${CALIBRATION_FLOOR}+ labelled outputs.`
        : `<span class="t-${trusted.length ? 'warn' : 'bad'}">${trusted.length} of ${judges.length} judges trusted</span>${thin.length ? `; ${thin.length} under the ${CALIBRATION_FLOOR}-output floor` : ''}.`;
  const caveat = `A judge is trusted at ${pct(JUDGE_TRUST_AGREEMENT)}+ agreement with hand labels over ${CALIBRATION_FLOOR}+ labelled outputs. Under the floor, a percentage is a count in disguise: 2 of 3 is not 67%. Lenient verdicts are the risk — they let a bad output pass a gate. Runs are experiments: none is overwritten, and a rate is only comparable with another run on the same fixture and prompt version.`;
  const answer = cal ? `<strong>${trusted.length} of ${judges.length}</strong> judges trusted (${pct(JUDGE_TRUST_AGREEMENT)}+ agreement on ${CALIBRATION_FLOOR}+ outputs). ` : '';
  const lede =
    answer +
    'Each judge also grades a fixed set of hand-labelled outputs: template outputs left alone (they must pass) and outputs with one planted fault — an invented date, a wrong bucket argued for, an overclaim on a thin record (they must fail). <strong>Agreement</strong> is how often the judge’s pass/fail matched the label. <strong>Lenient</strong> verdicts are the ones that matter: the judge passed an output a careful reader failed, so a bad agent output would pass the gate. <strong>Harsh</strong> verdicts fail good outputs — noise. Judge rates elsewhere on this page are only as trustworthy as these numbers.';
  return `<section class="section-block" id="calibration" aria-labelledby="cal-h">
    ${sectionHead('cal-h', 'Calibration', 'Can the AI judges be trusted, and how does this run compare with the last?', lede)}
    ${frame(`${judgeClaim} ${runClaim(report, history)}`, caveat)}
    ${judgesPanel(report, rows, history, cases)}
    ${calibrationTrend(report, rows, history)}
    <div id="runs" class="runs">
      <h3>This run against the last</h3>
      ${runFacts(report, history)}
      ${fold('Scoreboard — every metric, every lane, with the change since the previous keyed run', renderScoreboard(views, report, history))}
      ${fold('Trend — the same rates across keyed runs', renderTrends(views, report, history))}
      ${fold('Checks — which field or rubric line each metric loses on', renderChecks(views))}
      ${fold('Template vs model — where the model falls short of the fallback', renderComparison(views))}
      ${fold('Latency and tokens — p50 / p95 per agent and judge', renderLatency(report))}
    </div>
  </section>`;
}
