/**
 * Keyed runs: the helpers that turn the experiment log (history.ts) into what the charts
 * and tables compare against — the previous keyed run, this run as an entry, whether a
 * fixture changed in between, and the window of runs a trend shows.
 */

import type { MetricDefinition } from '../../registry';
import type { EvalReport, MetricSummary } from '../../types';
import type { RunHistoryEntry } from '../history';
import type { LaneKey } from './views';

export const LANE_ORDER: LaneKey[] = ['heuristic', 'judge', 'model', 'modelJudge'];

export function laneRateOf(summary: MetricSummary, key: LaneKey): number | null {
  switch (key) {
    case 'heuristic':
      return summary.heuristicPassRate;
    case 'judge':
      return summary.judgePassRate;
    case 'model':
      return summary.modelPassRate;
    case 'modelJudge':
      return summary.modelJudgePassRate;
  }
}

/** `scout-routing-0.05` → `0.05`; the judge's bare `0.05` stays. */
export const shortVersion = (version: string): string => version.split('-').at(-1) ?? version;

/** Short run stamp for a column head: `10-08 11:28`. */
export function shortStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(5, 16).replace('T', ' ');
}

/** The keyed run before this one — what every Δ on the page is measured against. */
export function previousKeyedRun(report: EvalReport, history: RunHistoryEntry[]): RunHistoryEntry | undefined {
  const id = report.run?.id;
  return [...history].reverse().find((h) => h.id !== id && h.generatedAt < report.generatedAt);
}

/** This run as a history entry, when it is keyed and the history does not hold it yet. */
export function withCurrent(report: EvalReport, history: RunHistoryEntry[]): RunHistoryEntry[] {
  if (!report.run || !(report.judgesRan || report.modelCallsRan) || history.some((h) => h.id === report.run?.id)) return history;
  const run = report.run;
  const current: RunHistoryEntry = {
      id: run.id,
      label: run.label,
      generatedAt: report.generatedAt,
      promptVersions: run.promptVersions,
      fixtures: run.fixtures,
      drift: run.drift,
      flags: run.flags,
      git: run.git,
      models: report.models,
      summaries: report.summaries,
      source: 'local',
      backfilled: false,
      calibration: report.calibration ?? null,
      calibrationRows: [],
  };
  return [...history, current].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

/** Whether a metric's fixture file differs between two runs — then their rates are not comparable. */
export function fixtureChanged(def: MetricDefinition, a: { fixtures: Record<string, string> | null } | undefined, b: { fixtures: Record<string, string> | null } | undefined): boolean {
  const key = def.fixture ?? def.name;
  if (!a?.fixtures || !b?.fixtures) return false;
  return a.fixtures[key] !== b.fixtures[key];
}


/** Keyed runs a trend shows, newest last. */
export const TREND_WINDOW = 10;
