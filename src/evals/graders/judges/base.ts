import { z } from 'zod';
import { GatewayError } from '../../../model/errors';
import { callModel, hasModelKey } from '../../../model/gateway';
import type { AgentName } from '../../../model/types';
import { scheduler } from '../../scheduler';
import type { EvalCase, GraderResult, JudgedSource } from '../../types';
import { judgeCache, judgeCacheKey } from './cache';

/**
 * LLM-as-judge base: format prompt -> callModel() -> GraderResult.
 *
 * Judges go through the gateway like every other model call (CLAUDE.md: `src/model/`
 * is the single place a model is called), so they get its timeout, 429 retry, token
 * cap, error classification, and an `agent_runs` row. The gateway picks the provider
 * from the model id, so a judge on OpenAI needs no code path of its own. The row is attributed to the
 * agent being judged, with promptVersion `judge:<metric>@<version>` so judge spend is
 * separable from the agent's own.
 *
 * Failure contract: a judge that cannot return a verdict returns a result with
 * `status: 'errored'`, never null and never a fail. Errored results are excluded from
 * the pass rate and counted in `nJudgeErrored`, and grade.ts refuses to certify a
 * gated metric that has any — a silent null made a judge outage look like "fewer
 * cases" (the previous behaviour).
 *
 * What is judged is passed in, not generated inside the prompt formatter. `template()`
 * produces the agent's deterministic output for a case; `gradeModelOutput()` takes a
 * producer for the agent's model output (registry `modelOutput`) and judges that with
 * the same rubric. Previously every judge called the template generator itself, so a
 * judge could only ever see deterministic prose — the model path was never judged.
 *
 * Batching: one judge call grades up to `judgeBatchSize()` cases (default 6), each
 * headed by its case id, and returns one verdict per id. One call per case cost ~112
 * judge calls a run — five times the Gemini free tier's daily quota on its own. Groups
 * stay small so verdicts stay independent (a long list drifts toward comparing items)
 * and one failed call costs a handful of verdicts, not the metric. A case the reply
 * omits twice — the batch, then alone — is `errored` (`judge_missing_verdict`), never a
 * silent pass or fail.
 *
 * Caching: a `source: 'template'` item's verdict is kept in `cache.ts`, keyed on every
 * input to the call, so a rerun with the same agent code, fixture, judge prompt and
 * model pays only for the model-output verdicts. `EVAL_JUDGE_CACHE=0` bypasses it.
 */

/**
 * The judge is OpenAI nano, not the agents' Gemini: a judge from another vendor is less
 * inclined to favour output that reads like its own, and its calls do not spend the
 * Gemini free-tier quota the agents' model path needs. Needs OPENAI_API_KEY;
 * EVAL_JUDGE_MODEL overrides it (a `gemini-*` id puts the judge back on Google).
 */
const DEFAULT_JUDGE_MODEL = 'gpt-5.4-nano';
/**
 * 0.02: batched prompt, `dimensions` as a name/value list.
 * 0.03: a shared scoring scale and reasoning format (CALIBRATION), so a score means the
 * same thing across judges and a failed dimension names the text that failed it.
 * v4: reference facts are things an output may not contradict, not a checklist it must
 * recite (CALIBRATION); scoutRationale's reference drops the tier.
 * 0.05: BATCH_INSTRUCTIONS says a reply missing any item is invalid, and a case the batch
 * reply still omits is re-asked once on its own before it is `errored` (run 1, 2026-10-08:
 * 3 of 254 verdicts were `judge_missing_verdict`, every one from a dropped batch item).
 * The chronicle judge labels the outcome list "claimed as achieved" and the envoy judge
 * states the sign-off as a reference fact.
 * 0.06: the judge sees the facts the drafter was given, as reference facts — scoutRationale
 * lists the readiness scores and signal, chronicleDraft the engagement status and the
 * readiness derived from it — and CALIBRATION says restating one is grounded. (Run 2,
 * 2026-10-08: the judge failed `grounded` on rationales that repeated the rubric's own
 * readiness facts, and `proportionate` on thin stories for facts the status supplied.)
 */
export const JUDGE_PROMPT_VERSION = '0.06';
const DEFAULT_JUDGE_BATCH_SIZE = 6;
/** A batch is a long prompt and a several-verdict reply; judges do not run behind /api's 30s limit. */
const JUDGE_TIMEOUT_MS = 120_000;
const JUDGE_OUTPUT_TOKENS_PER_ITEM = 768;

export function judgeModel(): string {
  return process.env.EVAL_JUDGE_MODEL || DEFAULT_JUDGE_MODEL;
}

export function judgeBatchSize(): number {
  const value = Number(process.env.EVAL_JUDGE_BATCH_SIZE);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_JUDGE_BATCH_SIZE;
}

/** The judge model's provider key is set (OPENAI_API_KEY for the default). */
export function judgesAvailable(): boolean {
  return hasModelKey(judgeModel());
}

/** The thrown error's message, for the errored row — `model_call_failed` alone says nothing about why. */
function detailOf(err: unknown, code: string): string {
  return err instanceof Error && err.message && err.message !== code ? ` — ${err.message}` : '';
}

/**
 * The wire shape of a batched verdict. `dimensions` is a name/value list, not a record:
 * an open-keyed object is the JSON-schema construct structured-output modes support
 * least. `score` is clamped rather than range-checked, so one verdict scoring 1.05 does
 * not fail the parse for the whole batch.
 */
const verdictSchema = z.object({
  caseId: z.string(),
  isCorrect: z.boolean(),
  score: z.number(),
  reasoning: z.string(),
  dimensions: z.array(z.object({ name: z.string(), value: z.number() })),
});
const batchSchema = z.object({ verdicts: z.array(verdictSchema) });

/**
 * Appended to every judge's rubric. Without anchors, 0.02 scores drifted per judge (a
 * 0.7 meant "fine" to one and "flawed" to another), and verdicts whose reasoning said
 * only "generic" could not be checked by a human reviewer against the output.
 */
const CALIBRATION = `

Scoring, the same for every item:
- Each dimension is 1 (met) or 0 (not met). Use exactly the dimension names above, lowercase.
- isCorrect is true exactly when every dimension is 1.
- score: 1.0 = every dimension met and nothing a reviewer would change; 0.8 = every
  dimension met, minor nits; 0.5 = one dimension not met; 0.2 = two or more not met;
  0.0 = empty where content was required, or about the wrong case.
- Judge only the rubric. Length, tone and style count only where a dimension names them;
  a short output that meets every dimension scores 1.0.
- Reference facts, where listed, are what the output must not contradict. An output that
  leaves a reference fact unmentioned is not wrong for that; only one that states
  otherwise, or that the fact says must not be stated, fails.
- Facts the drafter was given are reference facts; restating one is grounded.
- reasoning: at most three sentences. For each dimension not met, name it and quote or
  point to the exact words (or the missing fact) that failed it. When every dimension is
  met, name the specific detail that grounds the output. Never just "generic" or "good".`;

const BATCH_INSTRUCTIONS = `

You will receive one or more items, each under a heading "### Item <caseId>". Judge every
item on its own against the rubric above: do not compare items, rank them, or let one
item's quality move another's verdict. Return exactly one verdict per "### Item", in order,
in "verdicts", with the item's id copied exactly into "caseId". A reply missing any item is
invalid. "dimensions" is a list of {name, value} pairs, one per rubric dimension.`;

export type JudgeVerdict = z.infer<typeof verdictSchema>;

/**
 * The verdict as the rubric defines it, not as the model reported it. 0.02 runs returned
 * dimensions scored 0.6, `isCorrect: true` beside a 0 dimension, and 0.85 scores with a
 * failed dimension — 9 of ~110 verdicts — so the prompt's CALIBRATION is enforced here too:
 *
 * - A dimension is met only at exactly 1; any other value, or a missing rubric
 *   dimension, is not met. Names are matched case-insensitively; extra names are dropped.
 * - `isCorrect` is true exactly when every rubric dimension is met.
 * - `score` is capped at the anchor for the number of unmet dimensions (0.5 for one,
 *   0.2 for two or more), so a failed verdict cannot outscore the scale.
 *
 * `adjusted` is true when any of this changed the model's verdict — the run counts those,
 * since a judge that needs correcting often is a prompt to fix.
 */
export function applyRubric(
  verdict: Pick<JudgeVerdict, 'isCorrect' | 'score' | 'dimensions'>,
  rubric: readonly string[],
): { isCorrect: boolean; score: number; dimensions: Record<string, number>; adjusted: boolean } {
  const reported = new Map(verdict.dimensions.map((d) => [d.name.trim().toLowerCase(), d.value]));
  const dimensions = Object.fromEntries(rubric.map((name) => [name, reported.get(name) === 1 ? 1 : 0]));
  const unmet = rubric.filter((name) => dimensions[name] === 0).length;
  const isCorrect = unmet === 0;
  const clamped = Math.min(1, Math.max(0, verdict.score));
  const score = unmet === 0 ? clamped : Math.min(clamped, unmet === 1 ? 0.5 : 0.2);
  const adjusted =
    isCorrect !== verdict.isCorrect ||
    score !== clamped ||
    reported.size !== rubric.length ||
    rubric.some((name) => reported.get(name) !== dimensions[name]);
  return { isCorrect, score, dimensions, adjusted };
}

/** One case to judge: the case, the output under judgement, and whose output it is. */
export interface JudgeItem<TOutput> {
  evalCase: EvalCase;
  output: TOutput;
  source: JudgedSource;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Renders a fixture's `expected` block as reference facts for the judge. Judges whose
 * fixture keys need translating into plain language override `expectedFacts()`; this is
 * the fallback, one `key: value` line per field.
 */
export function formatExpectedFacts(facts: string[]): string {
  if (facts.length === 0) return '';
  return (
    `\n\nFacts the output should reflect (from the golden fixture — use them to check ` +
    `the output, not as text it must quote):\n${facts.map((f) => `- ${f}`).join('\n')}`
  );
}

/** `TOutput` is the agent's output shape — the same for its template and model paths. */
export abstract class LLMJudge<TOutput> {
  abstract metric: string;
  /** The agent whose output is judged — the `agent_runs` attribution. */
  abstract agent: AgentName;
  abstract systemPrompt: string;
  /** The rubric's dimension names, lowercase — what `applyRubric()` holds each verdict to. */
  abstract dimensions: readonly string[];

  /** The agent's deterministic output for this case. */
  abstract template(evalCase: EvalCase): TOutput;

  /** The judge's user message: the case's context plus `output`, the thing judged. */
  abstract formatUserMessage(evalCase: EvalCase, output: TOutput): string;

  expectedFacts(evalCase: EvalCase): string[] {
    return Object.entries(evalCase.expected).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  }

  /** Judge `output` (default: the template output) for one case — a batch of one. */
  async grade(
    evalCase: EvalCase,
    output: TOutput = this.template(evalCase),
    source: JudgedSource = 'template',
  ): Promise<GraderResult> {
    const [result] = await this.gradeBatch([{ evalCase, output, source }]);
    return result;
  }

  /**
   * Judge every item, `judgeBatchSize()` per call, through the run's scheduler (paced,
   * retried). Returns one result per item, in input order. Case ids must be unique
   * within one call — the verdicts are matched back to items by id. Template items
   * with a cached verdict are answered from the cache and never sent.
   */
  async gradeBatch(items: JudgeItem<TOutput>[]): Promise<GraderResult[]> {
    const cache = judgeCache();
    const results: GraderResult[] = new Array<GraderResult>(items.length);
    const pending: { item: JudgeItem<TOutput>; index: number; key: string | null }[] = [];
    items.forEach((item, index) => {
      const key = cache && item.source === 'template' ? this.cacheKey(item) : null;
      const hit = key ? cache?.get(key, item.output) : undefined;
      if (hit) results[index] = hit;
      else pending.push({ item, index, key });
    });
    for (const group of chunk(pending, judgeBatchSize())) {
      const graded = await this.gradeGroup(group.map((p) => p.item));
      graded.forEach((result, i) => {
        results[group[i].index] = result;
        if (group[i].key) cache?.put(group[i].key, result);
      });
    }
    return results;
  }

  /** The judge's full system prompt — the rubric plus the shared calibration and batch rules. */
  private system(): string {
    return this.systemPrompt + CALIBRATION + BATCH_INSTRUCTIONS;
  }

  /** One item's section of the batch prompt: heading, user message, reference facts. */
  private itemPrompt({ evalCase, output }: JudgeItem<TOutput>): string {
    return (
      `### Item ${evalCase.id}\n\n` +
      this.formatUserMessage(evalCase, output) +
      formatExpectedFacts(this.expectedFacts(evalCase))
    );
  }

  private cacheKey(item: JudgeItem<TOutput>): string {
    return judgeCacheKey({
      metric: this.metric,
      judgeVersion: JUDGE_PROMPT_VERSION,
      system: this.system(),
      model: judgeModel(),
      caseId: item.evalCase.id,
      item: this.itemPrompt(item),
    });
  }

  /**
   * One judge call for `group`. A case the reply omits is re-asked once on its own
   * (`reask`), one more paced call; only a second omission is `judge_missing_verdict`.
   */
  private async gradeGroup(group: JudgeItem<TOutput>[], reask = true): Promise<GraderResult[]> {
    const prompt = group.map((item) => this.itemPrompt(item)).join('\n\n');

    let verdicts: z.infer<typeof verdictSchema>[];
    try {
      const { object } = await scheduler().run(() =>
        callModel({
          agent: this.agent,
          schema: batchSchema,
          system: this.system(),
          prompt,
          model: judgeModel(),
          promptVersion: `judge:${this.metric}@${JUDGE_PROMPT_VERSION}`,
          timeoutMs: JUDGE_TIMEOUT_MS,
          maxOutputTokens: 1_024 + JUDGE_OUTPUT_TOKENS_PER_ITEM * group.length,
        }),
      );
      verdicts = object.verdicts;
    } catch (err) {
      const code = err instanceof GatewayError ? err.code : 'judge_failed';
      console.error(
        `judge ${this.metric} [${group.length} case(s)]: errored (${code})`,
        err instanceof GatewayError ? '' : err,
      );
      return group.map(({ evalCase, output, source }) =>
        this.errored(evalCase, source, code, `judge errored: ${code}${detailOf(err, code)}`, output),
      );
    }

    const byId = new Map<string, z.infer<typeof verdictSchema>>();
    for (const verdict of verdicts) if (!byId.has(verdict.caseId)) byId.set(verdict.caseId, verdict);

    const reasked = new Map<string, GraderResult>();
    if (reask) {
      for (const item of group) {
        if (byId.has(item.evalCase.id)) continue;
        console.error(`judge ${this.metric} [${item.evalCase.id}]: no verdict in the batch reply; asking again alone`);
        const [again] = await this.gradeGroup([item], false);
        reasked.set(item.evalCase.id, again);
      }
    }

    let adjusted = 0;
    const results = group.map(({ evalCase, output, source }): GraderResult => {
      const verdict = byId.get(evalCase.id);
      if (!verdict) {
        const again = reasked.get(evalCase.id);
        if (again) return again;
        console.error(`judge ${this.metric} [${evalCase.id}]: no verdict in the batch reply`);
        return this.errored(
          evalCase,
          source,
          'judge_missing_verdict',
          'judge errored: judge_missing_verdict — the batch reply had no verdict for this case, asked twice',
          output,
        );
      }
      const ruled = applyRubric(verdict, this.dimensions);
      if (ruled.adjusted) adjusted += 1;
      return {
        caseId: evalCase.id,
        metric: this.metric,
        grader: 'judge' as const,
        source,
        status: 'graded' as const,
        isCorrect: ruled.isCorrect,
        score: ruled.score,
        reasoning: verdict.reasoning,
        dimensions: ruled.dimensions,
        output,
      };
    });
    if (adjusted) console.error(`judge ${this.metric}: ${adjusted} verdict(s) corrected to the rubric`);
    return results;
  }

  /**
   * A model-output producer failure: an errored `source: 'model'` row (error
   * `model:<code>`), distinct from a judge failure — there was no output to judge,
   * which is neither a pass nor a fail.
   */
  modelOutputErrored(evalCase: EvalCase, err: unknown): GraderResult {
    const code = `model:${err instanceof GatewayError ? err.code : 'model_call_failed'}`;
    console.error(`judge ${this.metric} [${evalCase.id}]: model output errored (${code})`);
    return this.errored(evalCase, 'model', code, `model output errored: ${code}${detailOf(err, code)}`);
  }

  /** `output`: what was being judged, when there was one — absent when the model output itself failed. */
  private errored(
    evalCase: EvalCase,
    source: JudgedSource,
    code: string,
    reasoning: string,
    output?: TOutput,
  ): GraderResult {
    return {
      caseId: evalCase.id,
      metric: this.metric,
      grader: 'judge',
      source,
      status: 'errored',
      error: code,
      isCorrect: false,
      score: 0,
      reasoning,
      dimensions: {},
      ...(output !== undefined && { output }),
    };
  }
}
