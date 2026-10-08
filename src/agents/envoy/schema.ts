import { z } from 'zod';
import { PARTNER_DATA_NOTICE, field, partnerDataBlock } from '../../guardrails/partnerData';
import { envoyDraftSchema, ENVOY_OCCASIONS } from '../../schemas/envoy';

// Re-exported so the agent's tests and prompt builders keep one import site.
export { envoyDraftSchema, ENVOY_OCCASIONS };

/**
 * The model's half of a draft: subject and body, bounded. The caps sit on the model-facing
 * schema, not the wire schema, so a stored draft reads back uncapped while an over-long
 * answer fails validation and the occasion template is saved (fallback contract rule 2).
 */
export const ENVOY_SUBJECT_MAX = 200;
export const ENVOY_BODY_MAX = 4_000;

export const envoyModelSchema = envoyDraftSchema
  .omit({
    engagementId: true,
    occasion: true,
    hitlTier: true,
  })
  .extend({
    subject: z.string().min(1).max(ENVOY_SUBJECT_MAX),
    body: z.string().min(1).max(ENVOY_BODY_MAX),
  });

/**
 * What each occasion's draft must do (`.claude/specs/platform/agents/envoy.md`). 0.01 left
 * this to the model; its misses were the two occasion rules — concerns stated as
 * observations instead of questions, and a wrap-up that never asked before publishing.
 * 0.03 wraps the partner-supplied values in the data delimiter (guardrails/partnerData.ts);
 * the instructions are unchanged. 0.04 fixes the sign-off and stops the no-concern
 * follow-up proposing a cause (run 1, 2026-10-08: the model signed as "Envoy" and wrote
 * "we may have missed an update on our end" when nothing was inferred).
 */
const OCCASION_GUIDANCE: Record<(typeof ENVOY_OCCASIONS)[number], string> = {
  kickoff:
    'Welcome them and name the project if one is given. If a cadence is given, confirm it; if not, propose agreeing one together — do not suggest a specific rhythm.',
  check_in:
    'Keep it short and ask one specific question they can answer in a line or two, rather than a general "how is it going".',
  milestone_reached:
    'Acknowledge the milestone using only what is given here, and say what the next step is only if it is given.',
  at_risk_follow_up:
    'If concerns are listed, raise each one as a question, never as an observation or accusation ("Has anything changed on your side since…?", not "We noticed…"): they are inferred from recorded activity, and the partner may have been working without anything being logged. If none are listed, ask an open question; do not propose a cause, ours or theirs.',
  wrap_up:
    'Thank them, and explicitly ask their permission before anything about the engagement is written up or shared publicly. Consent is not assumed.',
};

export function buildEnvoyPrompt(input: {
  occasion: string;
  orgName: string;
  planTitle?: string;
  cadence?: string;
  concerns?: string[];
}): string {
  const guidance = OCCASION_GUIDANCE[input.occasion as keyof typeof OCCASION_GUIDANCE];
  return [
    'You are Envoy, drafting a message from a volunteer data-science programme to a nonprofit partner organisation.',
    'The draft is reviewed and sent by a human — write it as a finished message, not as advice about what to write.',
    '',
    'Write warmly and plainly. Do not invent facts: no dates, deliverables, metrics, or names',
    'beyond those given below. If something is not stated here, do not mention it.',
    '',
    `Occasion: ${input.occasion}`,
    ...(guidance ? [`What this occasion's message must do: ${guidance}`] : []),
    '',
    PARTNER_DATA_NOTICE,
    '',
    ...partnerDataBlock([
      field('Partner organisation', input.orgName),
      field('Project', input.planTitle || '(no linked plan)'),
      field('Agreed cadence', input.cadence || '(none agreed)'),
      input.concerns?.length
        ? field('Concerns to raise, as questions', input.concerns.join('; '))
        : 'Concerns to raise: (none)',
    ]),
    '',
    'Sign off exactly as `Best regards, The DSSG team` on two lines. Never sign with an agent or person name.',
    'Return a subject line and a message body.',
  ].join('\n');
}
