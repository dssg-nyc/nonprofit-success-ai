import { describe, expect, it } from 'vitest';
import { Constants } from '../database.types';
import {
  STAGE_ORDER,
  classifyTransition,
  deriveCurrentStage,
  isEarlier,
  nextStage,
} from '../lifecycle';
import type { StageRow } from '../lifecycle';

const row = (stage: StageRow['stage'], status: StageRow['status']): StageRow => ({ stage, status });

describe('STAGE_ORDER', () => {
  it('matches the engagement_stage enum, in order', () => {
    expect([...STAGE_ORDER]).toEqual([...Constants.public.Enums.engagement_stage]);
  });
});

describe('deriveCurrentStage (lifecycle.md §3)', () => {
  it('is null with no rows', () => {
    expect(deriveCurrentStage([])).toBeNull();
  });

  it('is null when every row is pending', () => {
    expect(deriveCurrentStage([row('initial_meeting', 'pending'), row('budget_check', 'pending')])).toBeNull();
  });

  it('is the in_progress row', () => {
    const rows = [row('initial_meeting', 'completed'), row('budget_check', 'in_progress')];
    expect(deriveCurrentStage(rows)?.stage).toBe('budget_check');
    expect(deriveCurrentStage(rows)?.row).toBe(rows[1]);
  });

  it('with no in_progress row, is the furthest completed row', () => {
    // Pinned in supabase/tests/rpcs.test.sql as well: the TS and SQL derivations must not drift.
    const rows = [row('budget_check', 'completed'), row('initial_meeting', 'completed')];
    expect(deriveCurrentStage(rows)?.stage).toBe('budget_check');
  });

  it('lets in_progress win over a later completed row (§3: the rule is by status)', () => {
    const rows = [row('initial_meeting', 'in_progress'), row('budget_check', 'completed')];
    expect(deriveCurrentStage(rows)?.stage).toBe('initial_meeting');
  });

  it('ignores pending rows when a completed row exists', () => {
    const rows = [row('initial_meeting', 'completed'), row('scoping', 'pending')];
    expect(deriveCurrentStage(rows)?.stage).toBe('initial_meeting');
  });

  it('takes the furthest of several in_progress orphans', () => {
    const rows = [row('initial_meeting', 'in_progress'), row('scoping', 'in_progress')];
    expect(deriveCurrentStage(rows)?.stage).toBe('scoping');
  });
});

describe('nextStage / isEarlier', () => {
  it('walks the pipeline and ends at membership', () => {
    expect(nextStage('initial_meeting')).toBe('budget_check');
    expect(nextStage('hackathon_ready')).toBe('membership');
    expect(nextStage('membership')).toBeNull();
  });

  it('orders strictly', () => {
    expect(isEarlier('budget_check', 'scoping')).toBe(true);
    expect(isEarlier('scoping', 'scoping')).toBe(false);
    expect(isEarlier('membership', 'initial_meeting')).toBe(false);
  });
});

describe('classifyTransition (lifecycle.md §4)', () => {
  it('first: no current stage, target initial_meeting', () => {
    expect(classifyTransition(null, 'initial_meeting')).toBe('first');
  });

  it('skip: no current stage, any other target', () => {
    expect(classifyTransition(null, 'budget_check')).toBe('skip');
  });

  it('advance: the immediate successor', () => {
    expect(classifyTransition('budget_check', 'data_ethics_committee')).toBe('advance');
    expect(classifyTransition('hackathon_ready', 'membership')).toBe('advance');
  });

  it('skip: further than the immediate successor', () => {
    expect(classifyTransition('initial_meeting', 'scoping')).toBe('skip');
  });

  it('reversal: any strictly earlier stage', () => {
    expect(classifyTransition('scoping', 'budget_check')).toBe('reversal');
    expect(classifyTransition('hackathon_ready', 'initial_meeting')).toBe('reversal');
  });

  it('same: the current stage again', () => {
    expect(classifyTransition('scoping', 'scoping')).toBe('same');
  });

  it('terminal: nothing leaves membership, whatever the target', () => {
    for (const to of STAGE_ORDER) expect(classifyTransition('membership', to)).toBe('terminal');
  });
});
