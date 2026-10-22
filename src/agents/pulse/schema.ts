import { z } from 'zod';

export const pulseSignalSchema = z.object({
  engagementId: z.string(),
  status: z.enum(['on_track', 'at_risk', 'stalled']),
  reasons: z.array(z.string()),
  daysSinceLastEvent: z.number().nullable().nonoptional(),
  daysInStage: z.number(),
  hasPlan: z.boolean(),
  hitlTier: z.literal('L2'),
});

export type PulseSignalPayload = z.infer<typeof pulseSignalSchema>;
