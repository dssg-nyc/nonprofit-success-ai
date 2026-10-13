import { computePulseSignal } from "../../../agents/pulse/health";
import type { PulseInput } from "../../../types/pulse";
import type { EvalCase, GraderResult } from "../../types";

/**
 * Exact-match grader over golden fixtures, mirroring `scoutRouting.ts`.
 *
 * Grades `status` strictly. `reasons` is checked only for the presence of an expected
 * substring when the fixture asks for one — the wording is deliberately not pinned here,
 * because a reason string is prose for staff and pinning it exactly would make every
 * copy edit an eval failure. `tests/pulseHealth.test.ts` is where the wording is pinned.
 */
export function grade(evalCase: EvalCase): GraderResult {
  const input = evalCase.input as unknown as PulseInput;
  const expected = evalCase.expected as {
    status: string;
    reasonContains?: string;
  };

  const result = computePulseSignal(input);

  const statusMatch = result.status === expected.status;
  const reasonMatch =
    expected.reasonContains === undefined ||
    result.reasons.some((reason) =>
      reason.includes(expected.reasonContains as string),
    );
  const isCorrect = statusMatch && reasonMatch;

  return {
    caseId: evalCase.id,
    metric: "pulseHealth",
    grader: "heuristic",
    status: "graded",
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    reasoning: `status=${result.status} (expected ${expected.status}), reasons=[${result.reasons.join(" | ")}]${
      expected.reasonContains
        ? ` (expected one containing "${expected.reasonContains}")`
        : ""
    }`,
    dimensions: {
      statusMatch: statusMatch ? 1 : 0,
      reasonMatch: reasonMatch ? 1 : 0,
    },
  };
}
