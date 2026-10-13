import { describe, expect, it } from 'vitest';
import { deriveHitlTier } from '../hitl';

describe('deriveHitlTier — scout', () => {
  const cases = [
    { confidence: 'High', compositeSignal: 'Ready', tier: 'L2' },
    { confidence: 'High', compositeSignal: 'Conditional', tier: 'L3' },
    { confidence: 'High', compositeSignal: 'Not Ready', tier: 'L3' },
    { confidence: 'Medium', compositeSignal: 'Ready', tier: 'L3' },
    { confidence: 'Low', compositeSignal: 'Ready', tier: 'L3' },
    { confidence: null, compositeSignal: 'Ready', tier: 'L3' },
  ] as const;

  for (const { confidence, compositeSignal, tier } of cases) {
    it(`${confidence} + ${compositeSignal} → ${tier}`, () => {
      expect(deriveHitlTier('scout', { confidence, compositeSignal })).toBe(tier);
    });
  }
});

describe('deriveHitlTier — draft-only agents', () => {
  it.each(['architect', 'envoy', 'chronicle'] as const)('%s is always L3', (agent) => {
    expect(deriveHitlTier(agent)).toBe('L3');
  });
});

describe('deriveHitlTier — pulse', () => {
  // pulse.md §5 "L2, always", matching PulseSignal.hitlTier. Pinned so a change is
  // deliberate: L1 vs L2 changes who is notified.
  it('is always L2 (pulse.md §5)', () => {
    expect(deriveHitlTier('pulse')).toBe('L2');
  });
});
