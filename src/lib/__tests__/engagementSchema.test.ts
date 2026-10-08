import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSIONS,
  engagementTransitionRequestSchema,
  engagementTransitionResponseSchema,
} from '../../schemas';

const BUSINESS_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
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
    engagementId: 'aaaaaaaa-0000-0000-0000-000000000002',
    fromStage: null,
    toStage: 'initial_meeting',
    transitionedAt: '2026-10-07T12:00:00.000Z',
    eventId: 'aaaaaaaa-0000-0000-0000-000000000003',
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
