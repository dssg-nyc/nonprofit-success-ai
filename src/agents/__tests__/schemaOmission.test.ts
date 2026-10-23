import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { architectEnrichmentSchema } from '../architect/schema';
import { chronicleModelSchema } from '../chronicle/schema';
import { envoyModelSchema } from '../envoy/schema';
import { scoutModelSchema } from '../scout/schema';
import {
  architectPlanResponseSchema,
  chronicleDraftResponseSchema,
  envoyDraftResponseSchema,
  pulseSignalSchema,
  scoutResultSchema,
} from '../../schemas';

// K1's keyless half: a model's output can never carry a privileged field, because the
// schema it is parsed with has no such key. `z.object` strips unknown keys, so each is
// either rejected or gone from the parsed result; a model that "sets" hitlTier or
// approvedBy has set nothing.

const PRIVILEGED = [
  'hitlTier',
  'readiness',
  'approvedBy',
  'approved_by',
  'reviewerId',
  'runId',
  // Also derived in code or by the database, never model-supplied.
  'composite_signal',
  'source',
  'approvalId',
] as const;

interface ModelSchemaCase {
  name: string;
  schema: z.ZodType;
  valid: Record<string, unknown>;
}

const MODEL_SCHEMAS: ModelSchemaCase[] = [
  {
    name: 'scoutModelSchema',
    schema: scoutModelSchema,
    valid: { bucket: 'Analytics & Insight', confidence: 'High', rationale: 'Because.', flags: [] },
  },
  {
    name: 'architectEnrichmentSchema',
    schema: architectEnrichmentSchema,
    valid: { background: null, scopeStatement: null, risks: [], successCriteria: [], milestones: [] },
  },
  {
    name: 'envoyModelSchema',
    schema: envoyModelSchema,
    valid: { subject: 'Hello', body: 'A message.' },
  },
  {
    name: 'chronicleModelSchema',
    schema: chronicleModelSchema,
    valid: { headline: 'H', narrative: 'N', outcomes: [], successFactors: [], failureFactors: [] },
  },
];

describe.each(MODEL_SCHEMAS)('$name', ({ schema, valid }) => {
  it('accepts a valid model object', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(PRIVILEGED)('a model-supplied %s is rejected or stripped, never kept', (key) => {
    for (const value of ['L2', 'Ready', 'someone', 'x']) {
      const result = schema.safeParse({ ...valid, [key]: value });
      if (result.success) {
        expect(result.data).not.toHaveProperty(key);
      }
    }
  });
});

describe('wire response schemas pin the tier', () => {
  const rejects = (schema: z.ZodType, values: unknown[]) =>
    values.forEach((v) => expect(schema.safeParse(v).success, String(v)).toBe(false));

  it('envoy, chronicle and architect responses are exactly L3', () => {
    for (const schema of [
      envoyDraftResponseSchema.shape.hitlTier,
      chronicleDraftResponseSchema.shape.hitlTier,
      architectPlanResponseSchema.shape.hitlTier,
    ]) {
      expect(schema.safeParse('L3').success).toBe(true);
      rejects(schema, ['L1', 'L2', 'L4', 'l3', undefined, null]);
    }
  });

  it('pulse is exactly L2', () => {
    const tier = pulseSignalSchema.shape.hitlTier;
    expect(tier.safeParse('L2').success).toBe(true);
    rejects(tier, ['L1', 'L3', 'L4', undefined, null]);
  });

  it('scout is L2 or L3 and nothing else', () => {
    const tier = scoutResultSchema.shape.hitlTier;
    expect(tier.safeParse('L2').success).toBe(true);
    expect(tier.safeParse('L3').success).toBe(true);
    rejects(tier, ['L1', 'L4', undefined, null]);
  });
});
