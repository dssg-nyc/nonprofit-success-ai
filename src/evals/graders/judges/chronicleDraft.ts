import { assessChronicleReadiness, generateChronicleDraft } from "../../../agents/chronicle/draft";
import type { ChronicleDraft, ChronicleInput } from "../../../types";
import type { EvalCase } from "../../types";
import { LLMJudge } from "./base";

const READINESS_FACT: Record<string, string> = {
  ready: "The record is complete enough for a confident story (readiness: ready).",
  thin: "The record is thin (readiness: thin): the story must read as provisional, not assured.",
  not_ready:
    "The record is not ready (readiness: not_ready): the correct output is no story at all — " +
    "an empty headline, narrative and outcomes list.",
};

/**
 * Judge-only, like `envoyDraft`. The dimension under real scrutiny here is
 * `proportionate`: Chronicle's failure mode is a confident public story about a named
 * organisation that the record does not support, and that failure reads as *good* prose.
 * A judge scoring only fluency would reward exactly the thing this agent must not do.
 *
 * The fixture's `expected.readiness` is passed as a fact because it is what
 * `proportionate` is measured against. It matches the draft's own derived readiness by
 * construction (both come from `assessChronicleReadiness()`), so it does not change what
 * the judge sees for a correct agent — it is the reference if the derivation regresses.
 *
 * The engagement `status` and the readiness derived from the record go beside it (0.06):
 * they are facts the drafter was given, so a story that says the engagement is completed,
 * or that its record is thin, restates its input rather than inventing it.
 */
export class ChronicleDraftJudge extends LLMJudge<ChronicleDraft> {
  metric = "chronicleDraft";
  agent = "chronicle" as const;
  dimensions = ['grounded', 'proportionate', 'clear'] as const;
  systemPrompt = `\
You evaluate a draft impact story about a completed volunteer data-science engagement with
a nonprofit. A human reviews it before anything is published.

Given the record available to the drafter, judge whether the draft is:
- grounded: every claim traces to the supplied objectives, success criteria, or recorded
  activity. No invented metrics, quotes, dates, or named people.
- proportionate: the confidence of the story matches the thinness of the record. A story
  drawn from a sparse record must read as provisional rather than assured. Overclaiming on
  thin evidence is the primary failure — mark it incorrect even if the prose is excellent.
- clear: a reader unfamiliar with the engagement understands what happened.

An empty draft is correct when the record is not ready; judge it as grounded and
proportionate, and as clear if nothing is claimed.

Return isCorrect=true only if all three hold. score is 0.0-1.0 reflecting overall
quality. dimensions should include grounded/proportionate/clear as 0 or 1 each.`;

  template(evalCase: EvalCase): ChronicleDraft {
    return generateChronicleDraft(evalCase.input as unknown as ChronicleInput);
  }

  formatUserMessage(evalCase: EvalCase, draft: ChronicleDraft): string {
    const input = evalCase.input as unknown as ChronicleInput;
    return (
      `Record available to the drafter:\n${JSON.stringify(input, null, 2)}\n\n` +
      `Derived readiness: ${draft.readiness}\n\n` +
      `Draft to evaluate:\nHeadline: ${draft.headline || "(empty)"}\n\n${draft.narrative || "(empty)"}\n\n` +
      `Outcomes claimed as achieved: ${draft.outcomes.join("; ") || "(none)"}`
    );
  }

  expectedFacts(evalCase: EvalCase): string[] {
    const input = evalCase.input as unknown as ChronicleInput;
    const readiness = (evalCase.expected as { readiness?: string }).readiness;
    const facts = readiness && READINESS_FACT[readiness] ? [READINESS_FACT[readiness]] : [];
    facts.push(
      `The drafter was told the engagement status is "${input.status}" and derived readiness ` +
        `${assessChronicleReadiness(input)} from the record (plan ${input.hasPlan ? "present" : "absent"}, ` +
        `${input.eventCount} recorded event(s)). A story that restates these is grounded.`,
    );
    return facts;
  }
}
