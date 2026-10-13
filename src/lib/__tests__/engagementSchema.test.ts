import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSIONS,
  engagementTransitionRequestSchema,
  engagementTransitionResponseSchema,
} from '../../schemas';

const BUSINESS_ID = '52c36b93-0c74-5222-b593-86c0c5ec460a';
const valid = {
  businessId: BUSINESS_ID,
  toStage: 'budget_check',
  idempotencyKey: 'transition-0001',
};

describe('engagementTransitionRequestSchema', () => {
  it('accepts the minimal request', () => {
    expect(engagementTransitionRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('trims the reason', () => {
    const parsed = engagementTransitionRequestSchema.parse({ ...valid, reason: '  budget withdrawn  ' });
    expect(parsed.reason).toBe('budget withdrawn');
  });

  it('rejects an unknown stage, a short key, a non-uuid business and an oversize reason', () => {
    for (const bad of [
      { ...valid, toStage: 'kickoff' },
      { ...valid, idempotencyKey: 'short' },
      { ...valid, idempotencyKey: 'k'.repeat(129) },
      { ...valid, businessId: 'not-a-uuid' },
      { ...valid, reason: 'x'.repeat(2001) },
    ]) {
      expect(engagementTransitionRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts evidence as a free-form record', () => {
    expect(engagementTransitionRequestSchema.safeParse({ ...valid, evidence: { note: 1 } }).success).toBe(true);
  });
});

describe('engagementTransitionResponseSchema', () => {
  const response = {
    engagementId: 'b9dbb27e-99ef-5699-9131-bffc84050f64',
    fromStage: null,
    toStage: 'initial_meeting',
    transitionedAt: '2026-10-07T12:00:00.000Z',
    eventId: '443dded6-f9ab-5606-a710-39ad1fefad7d',
    approvalId: null,
    replayed: false,
  };

  it('accepts a first transition (null fromStage, null approval)', () => {
    expect(engagementTransitionResponseSchema.safeParse(response).success).toBe(true);
  });

  it('accepts a Postgres timestamptz rendering with an offset', () => {
    const r = engagementTransitionResponseSchema.safeParse({ ...response, transitionedAt: '2026-10-07T12:00:00.123456+00:00' });
    expect(r.success).toBe(true);
  });

  it('rejects a missing replayed flag', () => {
    const rest: Record<string, unknown> = { ...response };
    delete rest.replayed;
    expect(engagementTransitionResponseSchema.safeParse(rest).success).toBe(false);
  });
});

describe('SCHEMA_VERSIONS', () => {
  it('registers engagement-transition at v1', () => {
    expect(SCHEMA_VERSIONS['engagement-transition']).toBe('v1');
  });
});
