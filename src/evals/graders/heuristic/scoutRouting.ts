import { routeScoutIntakeWithModel } from "../../../agents/scout/model";
import { routeScoutIntake } from "../../../agents/scout/routing";
import { GatewayError } from "../../../model/errors";
import type { ScoutResult, ScoutRoutingInput } from "../../../types";
import type { EvalCase, GraderResult } from "../../types";

interface Expected {
  bucket: string | null;
  composite_signal: string;
  hitlTier: string;
}

/**
 * Exact-match against the golden bucket/composite_signal/hitlTier. Shared by the
 * deterministic grader and the model grader, so both paths are held to the same
 * fixture expectations by the same comparison — the point of grading them side by side.
 */
function compare(
  evalCase: EvalCase,
  result: ScoutResult,
  grader: "heuristic" | "model",
): GraderResult {
  const expected = evalCase.expected as unknown as Expected;
  const bucketMatch = result.bucket === expected.bucket;
  const signalMatch = result.composite_signal === expected.composite_signal;
  const tierMatch = result.hitlTier === expected.hitlTier;
  const isCorrect = bucketMatch && signalMatch && tierMatch;

  return {
    caseId: evalCase.id,
    metric: "scoutRouting",
    grader,
    status: "graded",
    isCorrect,
    score: isCorrect ? 1.0 : 0.0,
    reasoning: `bucket=${result.bucket} (expected ${expected.bucket}), composite_signal=${result.composite_signal} (expected ${expected.composite_signal}), hitlTier=${result.hitlTier} (expected ${expected.hitlTier})`,
    dimensions: {
      bucketMatch: bucketMatch ? 1 : 0,
      signalMatch: signalMatch ? 1 : 0,
      tierMatch: tierMatch ? 1 : 0,
    },
  };
}

/**
 * The deterministic fallback, `routeScoutIntake()`. Free; runs on every grade. Its
 * output is kept, like the model path's, so review can set the two paths'
 * poc/clarity/foothold scores side by side — the scores are where they disagree.
 */
export function grade(evalCase: EvalCase): GraderResult {
  const result = routeScoutIntake(evalCase.input as unknown as ScoutRoutingInput);
  return { ...compare(evalCase, result, "heuristic"), output: result };
}

/**
 * The model path, `routeScoutIntakeWithModel()`, against the same fixtures. Needs a
 * key; a failed call is `status: 'errored'`, not a wrong answer. Reported beside the
 * fallback's rate and never gated: the fixtures were written against the fallback's
 * rules, so the model's rate measures agreement with them, not correctness.
 *
 * `produce` is the model output for the case; the registry passes one shared with
 * scoutRationale, so a run calls the model once per case, not once per metric.
 */
export async function gradeWithModel(
  evalCase: EvalCase,
  produce: (evalCase: EvalCase) => Promise<ScoutResult> = async (c) =>
    (await routeScoutIntakeWithModel(c.input as unknown as ScoutRoutingInput)).result,
): Promise<GraderResult> {
  try {
    const result = await produce(evalCase);
    return { ...compare(evalCase, result, "model"), output: result };
  } catch (err) {
    const code = err instanceof GatewayError ? err.code : "model_call_failed";
    // `model_call_failed` is the catch-all; the message is the only clue to the cause.
    const detail = err instanceof Error && err.message && err.message !== code ? ` — ${err.message}` : "";
    console.error(`model scoutRouting [${evalCase.id}]: errored (${code})`);
    return {
      caseId: evalCase.id,
      metric: "scoutRouting",
      grader: "model",
      status: "errored",
      error: code,
      isCorrect: false,
      score: 0,
      reasoning: `model path errored: ${code}${detail}`,
      dimensions: {},
    };
  }
}
