/**
 * The run history behind the report's trend and calibration sections: every keyed run
 * (one that called a judge or a model), from the tracked `experiments/log.jsonl` plus any
 * local `runs/<id>/` the log does not hold yet, oldest first. Each run carries its judge
 * calibration — the summary and, when the run directory is present, the rows — so the
 * judge can be read version by version beside the agents.
 *
 * Heuristic-only runs are left out: they are deterministic, and a column of identical
 * 100%s hides the runs that move. `grade.ts` does not log them for the same reason.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { calibrationResultSchema, calibrationSummarySchema, evalReportSchema, runManifestSchema } from '../types';
import type { CalibrationResult, CalibrationSummary, EvalReport, MetricSummary, RunManifest } from '../types';

export interface RunHistoryEntry {
  id: string;
  label: string | null;
  generatedAt: string;
  promptVersions: Record<string, string>;
  /** Hash per fixture file; null on the backfilled baseline. */
  fixtures: Record<string, string> | null;
  drift: string[];
  flags: RunManifest['flags'];
  git: RunManifest['git'];
  models: EvalReport['models'];
  summaries: MetricSummary[];
  /** `log`: in the tracked experiment log. `local`: only in `runs/<id>/` on this machine. */
  source: 'log' | 'local';
  backfilled: boolean;
  /** Judge-vs-label agreement for the run; null when it ran no judges or predates calibration. */
  calibration: CalibrationSummary | null;
  /** The labelled rows behind `calibration`, when the run directory is on this machine. */
  calibrationRows: CalibrationResult[];
}

/** One line of the experiment log. Lenient on the fields the backfilled baseline lacks. */
const logEntrySchema = runManifestSchema.extend({
  generatedAt: z.string(),
  models: evalReportSchema.shape.models,
  summaries: evalReportSchema.shape.summaries,
  calibration: calibrationSummarySchema.optional(),
});

function readJsonl<T>(path: string, schema: z.ZodType<T>): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => schema.parse(JSON.parse(line)));
}

/** A run worth a column: it called a model, and it graded every metric (a `--only` run did not). */
const keyed = (flags: RunManifest['flags']): boolean =>
  (flags.judges || flags.model) && !flags.only;

/** The run directories under `runsDir` that hold a tracked summary, with that summary. */
function localRuns(runsDir: string): Map<string, EvalReport & { run: RunManifest }> {
  const out = new Map<string, EvalReport & { run: RunManifest }>();
  if (!existsSync(runsDir)) return out;
  for (const name of readdirSync(runsDir)) {
    const summaryPath = resolve(runsDir, name, 'summary.json');
    if (!existsSync(summaryPath)) continue;
    const report = evalReportSchema.parse(JSON.parse(readFileSync(summaryPath, 'utf-8')));
    if (report.run) out.set(report.run.id, { ...report, run: report.run });
  }
  return out;
}

export function loadRunHistory(input: { logPath: string; runsDir: string }): RunHistoryEntry[] {
  const local = localRuns(input.runsDir);
  const rowsFor = (id: string): CalibrationResult[] =>
    readJsonl(resolve(input.runsDir, id, 'calibration.jsonl'), calibrationResultSchema);

  const entries = new Map<string, RunHistoryEntry>();
  for (const entry of readJsonl(input.logPath, logEntrySchema)) {
    if (!keyed(entry.flags)) continue;
    const dir = local.get(entry.id);
    const calibration = entry.calibration ?? dir?.calibration ?? null;
    entries.set(entry.id, {
      id: entry.id,
      label: entry.label,
      generatedAt: entry.generatedAt,
      promptVersions: entry.promptVersions,
      fixtures: entry.fixtures,
      drift: entry.drift,
      flags: entry.flags,
      git: entry.git,
      models: entry.models,
      summaries: entry.summaries,
      source: 'log',
      backfilled: entry.backfilled ?? false,
      calibration,
      calibrationRows: calibration ? rowsFor(entry.id) : [],
    });
  }
  for (const [id, report] of local) {
    if (entries.has(id) || !keyed(report.run.flags)) continue;
    entries.set(id, {
      id,
      label: report.run.label,
      generatedAt: report.generatedAt,
      promptVersions: report.run.promptVersions,
      fixtures: report.run.fixtures,
      drift: report.run.drift,
      flags: report.run.flags,
      git: report.run.git,
      models: report.models,
      summaries: report.summaries,
      source: 'local',
      backfilled: report.run.backfilled ?? false,
      calibration: report.calibration ?? null,
      calibrationRows: report.calibration ? rowsFor(id) : [],
    });
  }
  return [...entries.values()].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

/**
 * The judge's verdicts against the hand labels, as a confusion count. `lenient` is the
 * failure that matters most: the judge passed an output a careful reader failed, so a
 * bad agent output would pass the gate. `harsh` fails good outputs — noise, not a leak.
 */
export interface JudgeConfusion {
  /** Judge passed, label pass. */
  tp: number;
  /** Judge passed, label fail. */
  lenient: number;
  /** Judge failed, label pass. */
  harsh: number;
  /** Judge failed, label fail. */
  tn: number;
  errored: number;
}

export function judgeConfusion(rows: CalibrationResult[], judge?: string): JudgeConfusion {
  const out: JudgeConfusion = { tp: 0, lenient: 0, harsh: 0, tn: 0, errored: 0 };
  for (const row of rows) {
    if (judge !== undefined && row.judge !== judge) continue;
    if (row.verdict.status !== 'graded') {
      out.errored += 1;
      continue;
    }
    const said = row.verdict.isCorrect;
    const label = row.expected.isCorrect;
    if (said && label) out.tp += 1;
    else if (said && !label) out.lenient += 1;
    else if (!said && label) out.harsh += 1;
    else out.tn += 1;
  }
  return out;
}
