import { z } from 'zod';

export const chronicleDraftSchema = z.object({
  engagementId: z.string(),
  readiness: z.enum(['ready', 'thin', 'not_ready']),
  headline: z.string(),
  narrative: z.string(),
  outcomes: z.array(z.string()),
  hitlTier: z.literal('L3'),
});

export type ChronicleDraftPayload = z.infer<typeof chronicleDraftSchema>;

export const chronicleModelSchema = chronicleDraftSchema.omit({
  engagementId: true,
  readiness: true,
  hitlTier: true,
});

export function buildChroniclePrompt(input: {
  orgName: string;
  objectives?: string[];
  successCriteria?: string[];
  eventCount: number;
}): string {
  return [
    'You are Chronicle, writing a short impact story about a completed volunteer data-science engagement with a nonprofit.',
    'A human reviews this before anything is published.',
    '',
    'Ground every sentence in the material below. Do not invent metrics, quotes, dates, or',
    'named people, and do not describe an outcome that is not listed. If the material is',
    'thin, write something shorter rather than filling the gap.',
    '',
    `Partner organisation: ${input.orgName}`,
    `Objectives: ${input.objectives?.length ? input.objectives.join('; ') : '(none recorded)'}`,
    `Success criteria: ${input.successCriteria?.length ? input.successCriteria.join('; ') : '(none recorded)'}`,
    `Recorded activity: ${input.eventCount} events`,
    '',
    'Return a headline, a short narrative, and a list of outcomes.',
  ].join('\n');
}
