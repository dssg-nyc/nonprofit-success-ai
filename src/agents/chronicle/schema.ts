import { z } from 'zod';
import { PARTNER_DATA_NOTICE, field, partnerDataBlock } from '../../guardrails/partnerData';
import { chronicleDraftSchema } from '../../schemas/chronicle';

// Re-exported so the agent's tests and prompt builders keep one import site.
export { chronicleDraftSchema };

/**
 * The model's half of a draft. Prose is bounded here, in the model-facing schema, not in
 * the wire schema: a stored draft reads back uncapped, but an over-long model answer is a
 * `model_parse_error` and the template is saved instead (fallback contract rule 2). The
 * caps are generous for a short story and far below `DEFAULT_MAX_OUTPUT_TOKENS`.
 */
export const CHRONICLE_HEADLINE_MAX = 200;
export const CHRONICLE_NARRATIVE_MAX = 4_000;

export const chronicleModelSchema = chronicleDraftSchema
  .omit({
    engagementId: true,
    readiness: true,
    hitlTier: true,
    // Not asked for: nothing in `ChronicleInput` records an achievement (roadmap D46), so
    // every outcome a model listed was invented or a criterion restated. `model.ts` sets
    // `outcomes: []`, as the template does, until achieved outcomes are read from
    // `engagement_events`.
    outcomes: true,
  })
  .extend({
    headline: z.string().min(1).max(CHRONICLE_HEADLINE_MAX),
    narrative: z.string().min(1).max(CHRONICLE_NARRATIVE_MAX),
  });

/**
 * 0.06 stops asking for outcomes at all: the input holds no achievement (D46), so the
 * list was either empty or invented, and `model.ts` now sets it to `[]` in code (run 2,
 * 2026-10-08: the judge's `grounded` still failed the ready branch on restated criteria).
 * 0.05 separates outcomes from success criteria: the ready branch lists under outcomes
 * only what the record states was achieved, and the schema description says the same
 * (run 1, 2026-10-08: the model restated criteria as achieved outcomes, and the judge's
 * `grounded` failed it). 0.04 wraps the partner-supplied values in the data delimiter (guardrails/partnerData.ts);
 * the instructions are unchanged. 0.03 asks for success/failure factors. 0.02 passes the derived readiness in. 0.01 told the model only "if the material is thin,
 * write something shorter" without saying whether it was — and a thin record (one event)
 * came back as an assured "completed" story.
 */
export function buildChroniclePrompt(input: {
  orgName: string;
  objectives?: string[];
  successCriteria?: string[];
  eventCount: number;
  readiness: "thin" | "ready";
}): string {
  return [
    'You are Chronicle, writing a short impact story about a completed volunteer data-science engagement with a nonprofit.',
    'A human reviews this before anything is published.',
    '',
    'Ground every sentence in the material below. Do not invent metrics, quotes, dates, or',
    'named people, and do not describe an outcome that is not listed.',
    '',
    input.readiness === 'thin'
      ? [
          'The record is THIN: too little activity or no plan to show what was achieved. Write it as',
          'provisional — what the engagement set out to do ("set out to", "began", "aimed to"), not',
          'what it accomplished. Keep it short rather than filling the gap.',
        ].join('\n')
      : [
          'The record is complete enough to describe what happened. Claim only what the objectives,',
          'success criteria and activity support. The record states no achieved outcome, so do not',
          'present a success criterion, or anything else, as achieved.',
        ].join('\n'),
    '',
    PARTNER_DATA_NOTICE,
    '',
    ...partnerDataBlock([
      field('Partner organisation', input.orgName),
      field('Objectives', input.objectives?.length ? input.objectives.join('; ') : '(none recorded)'),
      field('Success criteria', input.successCriteria?.length ? input.successCriteria.join('; ') : '(none recorded)'),
      `Recorded activity: ${input.eventCount} events`,
    ]),
    '',
    'Also list up to five success factors and up to five failure factors: what helped the',
    'engagement land and what got in its way. Ground each in the objectives, success criteria',
    'or recorded activity above. Return an empty list when the record does not support one.',
    '',
    'Return a headline, a short narrative, and the two factor lists.',
  ].join('\n');
}
