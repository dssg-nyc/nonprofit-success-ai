import { generateEnvoyDraft } from "../../../agents/envoy/draft";
import type { EnvoyInput } from "../../../types/envoy";
import type { EvalCase, GraderResult } from "../../types";

/**
 * Mechanical correctness of the Envoy occasion template, graded on the `envoyDraft`
 * cases (registry `fixture: 'envoyDraft'`). Prose quality is the judge's
 * (`graders/judges/envoyDraft.ts`); this grades what code can check: the draft echoes
 * what it was asked for, is L3, names the partner, and states only the facts it was
 * given — no cadence it was not told, concerns only when supplied, and the wrap-up asks
 * before anything is written up.
 *
 * The `expected` flags are the judge's (`mentionsCadence`, `mentionsConcerns`,
 * `mentionsConsent`), read here as structural claims. An absent flag is not asserted:
 * `at_risk_follow_up` and `wrap_up` take a cadence in their input but the template never
 * quotes it, so those cases leave `mentionsCadence` unset.
 *
 * `source` and sending are out of reach of this pure function; nothing to assert there.
 */

/**
 * Consent is behaviour, not a keyword: "we will check with you before anything is shared
 * publicly" asks as surely as "may we have your permission". The pattern accepts the
 * explicit words and the template's phrasing of the same ask.
 */
const CONSENT_ASK =
  /permission|consent|check with you before|ask(?:ing)? (?:you )?before|before anything (?:is|are) (?:shared|published|written)/i;

export function grade(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as EnvoyInput;
  const expected = evalCase.expected as {
    mentionsCadence?: boolean;
    mentionsConcerns?: boolean;
    mentionsConsent?: boolean;
  };

  const draft = generateEnvoyDraft(input);
  const body = draft.body;
  const lower = body.toLowerCase();

  const dimensions: Record<string, number> = {
    echoesInput: draft.occasion === input.occasion && draft.engagementId === input.engagementId ? 1 : 0,
    tierL3: draft.hitlTier === "L3" ? 1 : 0,
    nonEmpty: draft.subject.trim() !== "" && body.trim() !== "" ? 1 : 0,
    namesOrg: body.includes(input.orgName) ? 1 : 0,
  };

  if (expected.mentionsCadence === true) {
    dimensions.cadence = input.cadence && body.includes(input.cadence) ? 1 : 0;
  } else if (expected.mentionsCadence === false) {
    // No cadence was given, so neither the word nor an invented rhythm may appear.
    dimensions.cadence = !lower.includes("cadence") && !input.cadence ? 1 : 0;
  }

  if (expected.mentionsConcerns === true) {
    const concerns = input.concerns ?? [];
    dimensions.concerns = concerns.length > 0 && concerns.every((c) => body.includes(c)) ? 1 : 0;
  } else if (expected.mentionsConcerns === false) {
    dimensions.concerns = !lower.includes("we noticed") && !(input.concerns?.length) ? 1 : 0;
  }

  if (expected.mentionsConsent === true) {
    dimensions.consent = CONSENT_ASK.test(body) ? 1 : 0;
  }

  const failed = Object.entries(dimensions).filter(([, v]) => v === 0).map(([k]) => k);
  const isCorrect = failed.length === 0;

  return {
    caseId: evalCase.id,
    metric: "envoyDraftStructure",
    grader: "heuristic",
    status: "graded",
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    reasoning: isCorrect ? "all structural checks hold" : `failed: ${failed.join(", ")}`,
    dimensions,
  };
}
