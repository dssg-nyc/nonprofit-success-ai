import { routeScoutIntake, scoreReadiness } from "../../../agents/scout/routing";
import type { ScoutResult, ScoutRoutingInput } from "../../../types";
import type { EvalCase } from "../../types";
import { LLMJudge } from "./base";

interface Expected {
  bucket?: string | null;
  composite_signal?: string;
}

/**
 * The prose half of Scout: the `rationale` string. bucket/composite_signal/hitlTier are
 * exact-matched by `graders/heuristic/scoutRouting.ts` — this judge instead asks whether
 * the rationale a human reviewer reads actually explains, and is consistent with, the
 * routing decision it sits beside.
 *
 * Grades the scoutRouting fixtures (registry `fixture: 'scoutRouting'`) rather than a set
 * of its own, so a routing case and its rationale are always the same intake. Their
 * `expected` routing is passed as reference facts: on the template path it agrees with
 * the decision by construction, but on the model path the decision itself can be wrong,
 * and a rationale arguing persuasively for the wrong bucket must not read as accurate.
 *
 * The reference carries bucket and signal, not the tier, and says the rationale need not
 * state them. The 0.03 judge read the tier as a fact to check for and failed `accurate` on
 * rationales that never mentioned `L2` or `Conditional` — 5 of the model path's 13
 * misses in the baseline run were that, not a contradiction.
 *
 * It also carries the readiness block — the three scores and the signal, from the same
 * `scoreReadiness()` the model path computes before its call — so a rationale that
 * restates a score it was handed is grounded, not invented (0.06; run 2 failed
 * `grounded` on rationales for repeating the rubric's own readiness facts).
 */
export class ScoutRationaleJudge extends LLMJudge<ScoutResult> {
  metric = "scoutRationale";
  agent = "scout" as const;
  dimensions = ['accurate', 'grounded', 'clear'] as const;
  systemPrompt = `\
You evaluate the rationale text produced by a nonprofit-consulting intake router. A staff
reviewer reads it beside the routing decision to decide whether to accept the routing.
Given the intake, the routing decision (bucket, confidence, composite_signal) and the
rationale string explaining it, judge whether the rationale is:
- accurate: nothing in it contradicts the decision shown, and it argues for the bucket
  that was chosen. When a reference routing is listed and the decision's bucket differs
  from it, a rationale that argues for the decision's bucket is not accurate. A rationale
  that describes the org as readier, or less ready, than the decision's composite_signal
  is not accurate. It is NOT required to mention the composite_signal, the confidence or
  a review tier, and it is not inaccurate for leaving one out: the decision is shown
  beside it. Judge what it says, not what it omits.
- grounded: it cites at least one concrete detail from this intake that bears on the
  decision — a phrase from the problem description, the stated primary need, the org's
  scale or systems, the contact or timeline. Restating the bucket name or a routing rule
  with no detail from this intake is not grounded. One sentence can be grounded.
- clear: a reviewer understands why this bucket without re-deriving it from the intake.
  Form-question labels (Q6, Q7) that the reader must decode count against clarity.

Return isCorrect=true only if all three hold. dimensions: accurate, grounded, clear.`;

  template(evalCase: EvalCase): ScoutResult {
    return routeScoutIntake(evalCase.input as unknown as ScoutRoutingInput);
  }

  formatUserMessage(evalCase: EvalCase, result: ScoutResult): string {
    return (
      `Intake:\n${JSON.stringify(evalCase.input, null, 2)}\n\n` +
      `Routing decision: bucket=${result.bucket}, confidence=${result.confidence}, composite_signal=${result.composite_signal}\n\n` +
      `Rationale to evaluate:\n${result.rationale}`
    );
  }

  expectedFacts(evalCase: EvalCase): string[] {
    const expected = evalCase.expected as Expected;
    const facts: string[] = [];
    if (expected.bucket !== undefined) {
      facts.push(
        `Reference routing for this intake: bucket=${expected.bucket}, ` +
          `composite_signal=${expected.composite_signal}. ` +
          "The rationale need not state these; it fails accurate only by contradicting them.",
      );
    }
    const readiness = scoreReadiness(evalCase.input as unknown as ScoutRoutingInput);
    facts.push(
      "Readiness the router was given (scored from the intake by rule, not by the router): " +
        `poc_score=${readiness.poc_score}, clarity_score=${readiness.clarity_score}, ` +
        `foothold_score=${readiness.foothold_score}, composite_signal=${readiness.composite_signal}. ` +
        "A rationale that restates these is grounded; one that gives different scores or signal is not accurate.",
    );
    return facts;
  }
}
