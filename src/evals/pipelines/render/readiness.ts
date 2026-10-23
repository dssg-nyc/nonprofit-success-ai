import type { EvalReport } from '../../types';
import { CALIBRATION_FLOOR, callout, escapeHtml, FIXTURE_FLOOR, JUDGE_TRUST_AGREEMENT, nameOf, pct, plural, subHead } from './views';
import type { MetricView, RenderInput } from './views';

// Readiness ladder — the steps between this run and a judge-gated deploy, in order
// ---------------------------------------------------------------------------------------

export type RungStatus = 'done' | 'partial' | 'todo';

export interface Rung {
  step: string;
  question: string;
  status: RungStatus;
  evidence: string;
  /** The kind of fix that moves the step: code, a template string, a prompt, a fixture or rubric line, or infrastructure. */
  where: string;
}

export const RUNG_TEXT: Record<RungStatus, string> = { done: 'Done', partial: 'In progress', todo: 'Not started' };

/** Distinct fixture files behind the metrics, with the case count each holds. */
export function fixtureCounts(views: MetricView[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of views) {
    const key = v.def.fixture ?? v.def.name;
    if (!out.has(key)) out.set(key, v.cases.size);
  }
  return out;
}

/**
 * Each rung is derived from the run and the registry, never typed in: a rung that reads
 * "done" is a fact the page can show, and the first rung that is not done is the blocker.
 */
export function readinessRungs(views: MetricView[], report: EvalReport, input: RenderInput): Rung[] {
  const rungs: Rung[] = [];
  const fx = fixtureCounts(views);
  const thinFixtures = [...fx.entries()].filter(([, n]) => n < FIXTURE_FLOOR);
  rungs.push({
    step: 'Fixtures written',
    question: `Does every metric have at least ${FIXTURE_FLOOR} hand-written cases?`,
    status: fx.size === 0 ? 'todo' : thinFixtures.length === 0 ? 'done' : 'partial',
    evidence:
      fx.size === 0
        ? 'No fixture loaded.'
        : thinFixtures.length === 0
          ? `${plural(fx.size, 'fixture file')}, ${Math.min(...fx.values())}–${Math.max(...fx.values())} cases each.`
          : `${thinFixtures.map(([k, n]) => `<code>${escapeHtml(k)}</code> ${n}`).join(', ')} under ${FIXTURE_FLOOR}.`,
    where: 'Fixture / rubric',
  });

  const heuristic = views.filter((v) => v.def.heuristic);
  const hGated = heuristic.filter((v) => v.gate.kind !== 'ungated');
  const hFailing = hGated.filter((v) => v.gate.kind === 'failed');
  rungs.push({
    step: 'Fallback gated',
    question: 'Is every deterministic path gated in targets.yaml and passing?',
    status: heuristic.length === 0 ? 'todo' : hGated.length === heuristic.length && hFailing.length === 0 ? 'done' : 'partial',
    evidence: `${hGated.length} of ${heuristic.length} gated${hFailing.length ? `, <span class="t-bad">${hFailing.length} failing</span>` : ''}${
      hGated.length < heuristic.length ? `; ungated: ${heuristic.filter((v) => v.gate.kind === 'ungated').map((v) => escapeHtml(nameOf(v))).join(', ')}` : ''
    }.`,
    where: 'Code',
  });

  const judged = views.filter((v) => v.def.judgeCls);
  rungs.push({
    step: 'Judges run',
    question: 'Has a keyed run graded the prose metrics?',
    status: report.judgesRan ? 'done' : 'todo',
    evidence: report.judgesRan ? `This run judged ${plural(judged.filter((v) => v.lanes.some((l) => l.kind === 'judge' && l.ran && l.rate !== null)).length, 'metric')}.` : 'This run had no judge key.',
    where: 'Infrastructure',
  });

  const cal = report.calibration;
  const judgesAll = judged.map((v) => v.summary.metric);
  const calibrated = (cal?.judges ?? []).filter((j) => j.n - j.nErrored >= CALIBRATION_FLOOR && j.agreement !== null && j.agreement >= JUDGE_TRUST_AGREEMENT);
  const short = judgesAll.filter((name) => !calibrated.some((j) => j.judge === name));
  rungs.push({
    step: 'Judges calibrated',
    question: `Does every judge agree with hand labels at ${pct(JUDGE_TRUST_AGREEMENT)}+ on ${CALIBRATION_FLOOR}+ labelled outputs?`,
    status: !cal ? 'todo' : short.length === 0 ? 'done' : calibrated.length ? 'partial' : 'todo',
    evidence: !cal
      ? 'Not calibrated this run.'
      : `${calibrated.length} of ${judgesAll.length} judges trusted${
          short.length
            ? `; short: ${short
                .map((name) => {
                  const j = cal.judges.find((x) => x.judge === name);
                  if (!j) return `${escapeHtml(name)} (not calibrated)`;
                  const graded = j.n - j.nErrored;
                  return `${escapeHtml(name)} (${j.agreement === null ? 'all errored' : `${pct(j.agreement)} on ${graded}`}${graded < CALIBRATION_FLOOR ? `, needs ${CALIBRATION_FLOOR - graded} more labels` : ''})`;
                })
                .join(', ')}`
            : ''
        }.`,
    where: 'Rubric',
  });

  const jGated = judged.filter((v) => v.gate.kind !== 'ungated');
  rungs.push({
    step: 'Judge metrics gated',
    question: 'Is every prose metric gated at its measured rate?',
    status: jGated.length === judged.length ? 'done' : jGated.length ? 'partial' : 'todo',
    evidence: judged.length === 0 ? 'No judge metric in this run.' : `${jGated.length} of ${judged.length} judge metrics have a threshold in targets.yaml.`,
    where: 'Code',
  });

  const modelable = views.filter((v) => v.lanes.some((l) => l.path === 'model'));
  const measured = modelable.filter((v) => v.lanes.some((l) => l.path === 'model' && l.ran && l.rate !== null));
  rungs.push({
    step: 'Model path measured',
    question: 'Has the model path been run on the same cases as the fallback?',
    status: !report.modelCallsRan ? 'todo' : measured.length === modelable.length ? 'done' : 'partial',
    evidence: report.modelCallsRan ? `${measured.length} of ${modelable.length} metrics measured; reported at a 90% bar, never gated.` : 'This run had no model key.',
    where: 'Infrastructure',
  });

  const sheets = input.readiness?.kappaSheets;
  rungs.push({
    step: 'Chronicle κ protocol (D25)',
    question: 'Have two blind raters scored 20 chronicleDraft model outputs?',
    status: sheets === undefined || sheets === 0 ? 'todo' : sheets >= 2 ? 'done' : 'partial',
    evidence: sheets === undefined ? 'Not checked — rater sheets live in <code>reports/output/kappa/</code>.' : `${plural(sheets, 'rater sheet')} in <code>reports/output/kappa/</code>; two are needed for κ.`,
    where: 'Fixture / rubric',
  });

  rungs.push({
    step: 'Judge CI job (J3)',
    question: 'Do the judges run on every PR, not only by hand?',
    status: input.readiness?.judgeCiJob ? 'done' : 'todo',
    evidence: input.readiness?.judgeCiJob ? 'A workflow runs the judges.' : 'Only the heuristic job runs in CI; judge runs are manual.',
    where: 'Infrastructure',
  });
  return rungs;
}

/** How many steps are done and which one blocks, for the pointer on the overview. */
export function readinessSummary(views: MetricView[], report: EvalReport, input: RenderInput): { done: number; total: number; blocker: Rung | undefined } {
  const rungs = readinessRungs(views, report, input);
  return { done: rungs.filter((r) => r.status === 'done').length, total: rungs.length, blocker: rungs.find((r) => r.status !== 'done') };
}

export function renderReadiness(views: MetricView[], report: EvalReport, input: RenderInput): string {
  const rungs = readinessRungs(views, report, input);
  const done = rungs.filter((r) => r.status === 'done').length;
  const blocker = rungs.find((r) => r.status !== 'done');
  const rows = rungs
    .map(
      (r, i) =>
        `<tr class="rung-${r.status}${r === blocker ? ' blocker' : ''}"><td class="num">${i + 1}</td><th scope="row">${escapeHtml(r.step)}<small>${escapeHtml(r.question)}</small></th>` +
        `<td><span class="rung ${r.status}">${RUNG_TEXT[r.status]}</span></td><td>${r.evidence}</td><td>${escapeHtml(r.where)}</td></tr>`,
    )
    .join('');
  const lede = blocker
    ? `<strong>${done} of ${rungs.length}</strong> steps done. The current blocker is <strong>${escapeHtml(blocker.step.toLowerCase())}</strong>: ${blocker.evidence}`
    : `<strong>All ${rungs.length}</strong> steps done: every path is gated on a calibrated judge and the judges run in CI.`;
  return `<section class="section-block" id="readiness" aria-labelledby="readiness-h">
    ${subHead('readiness-h', 'Overview', 'How far are we from gating the agents on prose quality?', lede)}
    <div class="fields-wrap"><table class="fields ladder"><thead><tr><th>#</th><th>Step</th><th>Status</th><th>Evidence</th><th>Where</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${callout('teal', `<strong>Rule.</strong> A judge is trusted at ${pct(JUDGE_TRUST_AGREEMENT)}+ agreement with hand labels over ${CALIBRATION_FLOOR}+ labelled outputs; a metric is gated at its measured rate over ${FIXTURE_FLOOR}+ cases. Until a judge is trusted, its rates on this page are indicative and never gate a deploy.`)}
  </section>`;
}
