import { generateEnvoyDraft } from "../../../agents/envoy/draft";
import type { EnvoyDraft, EnvoyInput } from "../../../types";
import type { EvalCase } from "../../types";
import { LLMJudge } from "./base";

interface Expected {
  mentionsCadence?: boolean;
  mentionsConcerns?: boolean;
  mentionsConsent?: boolean;
}

/**
 * Judge-only, like `scoutRationale`: a partner-facing message has no meaningful
 * exact-match grader — many different drafts are correct and one wrong sentence matters
 * more than any word count.
 *
 * The dimension that carries the weight is `grounded`. Envoy writes to a named partner
 * organisation, so a fabricated date, metric, or deliverable is not a quality problem but
 * a credibility one.
 *
 * The fixture `expected` flags are rendered as plain-language facts rather than raw keys:
 * `mentionsCadence: false` means "no cadence was agreed, so none may be stated", which a
 * judge reading the bare boolean could take as "the draft forgot to mention one".
 */
export class EnvoyDraftJudge extends LLMJudge<EnvoyDraft> {
  metric = "envoyDraft";
  agent = "envoy" as const;
  dimensions = ['grounded', 'appropriate', 'clear'] as const;
  systemPrompt = `\
You evaluate a draft message written by a volunteer data-science programme to a nonprofit
partner organisation. A human reviews the draft before it is sent.

Given the occasion and the facts available to the drafter, judge whether the draft is:
- grounded: states no fact absent from the inputs — no invented dates, metrics,
  deliverables, or names. This is the dimension that matters most; a single fabricated
  detail makes the draft incorrect regardless of how well it reads.
- appropriate: the tone and content fit the stated occasion
- clear: a partner could read it once and know what, if anything, is being asked of them

When reference facts are listed, a draft that contradicts one is not grounded or not
appropriate (whichever fits).

Return isCorrect=true only if all three hold. score is 0.0-1.0 reflecting overall
quality. dimensions should include grounded/appropriate/clear as 0 or 1 each.`;

  template(evalCase: EvalCase): EnvoyDraft {
    return generateEnvoyDraft(evalCase.input as unknown as EnvoyInput);
  }

  formatUserMessage(evalCase: EvalCase, draft: EnvoyDraft): string {
    const input = evalCase.input as unknown as EnvoyInput;
    return (
      `Facts available to the drafter:\n${JSON.stringify(input, null, 2)}\n\n` +
      `Occasion: ${input.occasion}\n\n` +
      `Draft to evaluate:\nSubject: ${draft.subject}\n\n${draft.body}`
    );
  }

  expectedFacts(evalCase: EvalCase): string[] {
    const input = evalCase.input as unknown as EnvoyInput;
    const expected = evalCase.expected as Expected;
    const facts: string[] = ["The sign-off must be 'Best regards, The DSSG team' — never an agent's or a person's name."];
    if (expected.mentionsCadence === true) {
      facts.push(`The draft should reflect the agreed cadence ("${input.cadence}").`);
    } else if (expected.mentionsCadence === false) {
      facts.push("No cadence was agreed: the draft must not state one (proposing to agree one is fine).");
    }
    if (expected.mentionsConcerns === true) {
      facts.push(
        `The draft should raise the supplied concerns (${(input.concerns ?? []).join("; ")}) ` +
          "as a question, not an accusation.",
      );
    } else if (expected.mentionsConcerns === false) {
      facts.push("No concerns were supplied: the draft must not name a specific reason for following up.");
    }
    if (expected.mentionsConsent === true) {
      facts.push("The draft should ask the partner before anything is written up or shared publicly.");
    }
    return facts;
  }
}
