import type { EngagementStage, EngagementStatus } from '../types';

/**
 * The engagement lifecycle, derived — lifecycle.md §3. `engagements` is one row per stage
 * (§0), so "where is this engagement" is a function of the rows, never a column. This is
 * the TypeScript half of one rule; `current_engagement_stage()` in 0005_lifecycle is the SQL half.
 * Both pin the same cases ("no in_progress row: furthest completed wins") in their tests.
 *
 * Pure: types-only imports, no React, no agent code (`lib/` imports nothing above it).
 */

/** The six stages in pipeline order — the `engagement_stage` enum order (0001_core). */
export const STAGE_ORDER: readonly EngagementStage[] = [
  'initial_meeting',
  'budget_check',
  'data_ethics_committee',
  'scoping',
  'hackathon_ready',
  'membership',
];

/** The minimum a stage row must carry to be classified. */
export interface StageRow {
  stage: EngagementStage;
  status: EngagementStatus;
}

export type TransitionKind = 'first' | 'advance' | 'skip' | 'reversal' | 'terminal' | 'same';

const position = (stage: EngagementStage): number => STAGE_ORDER.indexOf(stage);

/** The stage after `stage`, or null for the terminal `membership`. */
export function nextStage(stage: EngagementStage): EngagementStage | null {
  return STAGE_ORDER[position(stage) + 1] ?? null;
}

/** Strictly earlier in pipeline order. */
export function isEarlier(a: EngagementStage, b: EngagementStage): boolean {
  return position(a) < position(b);
}

/**
 * Current stage per §3: the `in_progress` row; if none, the furthest-along `completed`
 * row. `pending` rows never make a stage current. Null when neither exists.
 *
 * `in_progress` wins even when an earlier stage holds it and a later row is `completed`
 * (§3 states the rule by status, not by position) — a stale `in_progress` is a data
 * defect to repair, not something the derivation second-guesses. If more than one row is
 * `in_progress` (an orphan, §2 "Concurrency"), the furthest one wins, as in SQL.
 */
export function deriveCurrentStage<T extends StageRow>(
  rows: readonly T[],
): { stage: EngagementStage; row: T } | null {
  const furthest = (status: EngagementStatus): T | null =>
    rows
      .filter((r) => r.status === status)
      .reduce<T | null>((best, r) => (best === null || position(r.stage) > position(best.stage) ? r : best), null);
  const row = furthest('in_progress') ?? furthest('completed');
  return row ? { stage: row.stage, row } : null;
}

/**
 * What a move from `current` to `toStage` is (§4). `terminal` outranks everything: nothing
 * leaves `membership`. With no current stage only `initial_meeting` is a valid first move;
 * any other target is a `skip`.
 */
export function classifyTransition(
  current: EngagementStage | null,
  toStage: EngagementStage,
): TransitionKind {
  if (current === null) return toStage === 'initial_meeting' ? 'first' : 'skip';
  if (current === 'membership') return 'terminal';
  if (toStage === current) return 'same';
  if (isEarlier(toStage, current)) return 'reversal';
  return nextStage(current) === toStage ? 'advance' : 'skip';
}
