import { z } from 'zod';

export const ENVOY_OCCASIONS = [
  'kickoff',
  'check_in',
  'milestone_reached',
  'at_risk_follow_up',
  'wrap_up',
] as const;

export const envoyDraftSchema = z.object({
  engagementId: z.string(),
  occasion: z.enum(ENVOY_OCCASIONS),
  subject: z.string().min(1),
  body: z.string().min(1),
  hitlTier: z.literal('L3'),
});

export type EnvoyDraftPayload = z.infer<typeof envoyDraftSchema>;

export const envoyModelSchema = envoyDraftSchema.omit({
  engagementId: true,
  occasion: true,
  hitlTier: true,
});

export function buildEnvoyPrompt(input: {
  occasion: string;
  orgName: string;
  planTitle?: string;
  cadence?: string;
  concerns?: string[];
}): string {
  return [
    'You are Envoy, drafting a message from a volunteer data-science programme to a nonprofit partner organisation.',
    'The draft is reviewed and sent by a human — write it as a finished message, not as advice about what to write.',
    '',
    'Write warmly and plainly. Do not invent facts: no dates, deliverables, metrics, or names',
    'beyond those given below. If something is not stated here, do not mention it.',
    '',
    `Occasion: ${input.occasion}`,
    `Partner organisation: ${input.orgName}`,
    `Project: ${input.planTitle || '(no linked plan)'}`,
    `Agreed cadence: ${input.cadence || '(none agreed)'}`,
    input.concerns?.length
      ? `Concerns to raise gently: ${input.concerns.join('; ')}`
      : 'Concerns to raise: (none)',
    '',
    'Return a subject line and a message body.',
  ].join('\n');
}
