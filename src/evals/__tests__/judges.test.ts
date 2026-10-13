import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRubric } from '../graders/judges/base';
import { EnvoyDraftJudge } from '../graders/judges/envoyDraft';
import { summarize } from '../metrics/passRate';
import { resetScheduler, defaultSchedulerOptions } from '../scheduler';
import { evalCaseSchema } from '../types';
import type { GraderResult } from '../types';

// The gateway is real by default (the key-missing test below needs its own check); the
// re-ask tests swap in a scripted reply and put it back.
type Gateway = typeof import('../../model/gateway');
const gateway = vi.hoisted(() => ({ callModel: vi.fn(), actual: null as Gateway | null }));
vi.mock('../../model/gateway', async (importOriginal) => {
  const actual = await importOriginal<Gateway>();
  gateway.actual = actual;
  gateway.callModel.mockImplementation(actual.callModel);
  return { ...actual, callModel: gateway.callModel };
});

const envoyCase = evalCaseSchema.parse(
  JSON.parse(readFileSync(resolve(__dirname, '..', 'fixtures', 'envoyDraft.jsonl'), 'utf-8').split('\n')[0]),
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('LLMJudge failure contract', () => {
  it('a judge that cannot call the model returns errored, not null and not a fail', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await new EnvoyDraftJudge().grade(envoyCase);

    expect(result).toMatchObject({
      caseId: envoyCase.id,
      metric: 'envoyDraft',
      grader: 'judge',
      status: 'errored',
      error: 'model_key_missing',
    });
  });
});

describe('LLMJudge missing-verdict re-ask', () => {
  const judge = new EnvoyDraftJudge();
  const second = evalCaseSchema.parse(
    JSON.parse(readFileSync(resolve(__dirname, '..', 'fixtures', 'envoyDraft.jsonl'), 'utf-8').split('\n')[1]),
  );
  const verdict = (caseId: string) => ({
    caseId,
    isCorrect: true,
    score: 1,
    reasoning: 'grounded in the plan title',
    dimensions: judge.dimensions.map((name) => ({ name, value: 1 })),
  });
  const reply = (...ids: string[]) => ({ object: { verdicts: ids.map(verdict) }, runId: null, model: 'test', usage: { inputTokens: 0, outputTokens: 0 }, retried: false });

  beforeEach(() => {
    resetScheduler({ ...defaultSchedulerOptions(), minIntervalMs: 0, sleep: async () => {} });
    gateway.callModel.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    gateway.callModel.mockReset();
    gateway.callModel.mockImplementation(gateway.actual!.callModel);
    resetScheduler();
  });

  it('a batch reply missing one id costs exactly one extra call, alone, and the case is graded', async () => {
    gateway.callModel.mockResolvedValueOnce(reply(envoyCase.id)).mockResolvedValueOnce(reply(second.id));

    const results = await judge.gradeBatch([
      { evalCase: envoyCase, output: judge.template(envoyCase), source: 'template' },
      { evalCase: second, output: judge.template(second), source: 'template' },
    ]);

    expect(gateway.callModel).toHaveBeenCalledTimes(2);
    const retry = gateway.callModel.mock.calls[1][0] as { prompt: string };
    expect(retry.prompt).toContain(`### Item ${second.id}`);
    expect(retry.prompt).not.toContain(`### Item ${envoyCase.id}`);
    expect(results.map((r) => [r.caseId, r.status, r.isCorrect])).toEqual([
      [envoyCase.id, 'graded', true],
      [second.id, 'graded', true],
    ]);
  });

  it('a case missing from the batch and from its own re-ask is errored, not asked a third time', async () => {
    gateway.callModel.mockResolvedValueOnce(reply(envoyCase.id)).mockResolvedValueOnce(reply());

    const results = await judge.gradeBatch([
      { evalCase: envoyCase, output: judge.template(envoyCase), source: 'template' },
      { evalCase: second, output: judge.template(second), source: 'template' },
    ]);

    expect(gateway.callModel).toHaveBeenCalledTimes(2);
    expect(results[1]).toMatchObject({ caseId: second.id, status: 'errored', error: 'judge_missing_verdict' });
  });
});

describe('summarize', () => {
  const row = (over: Partial<GraderResult>): GraderResult => ({
    caseId: 'x',
    metric: 'm',
    grader: 'judge',
    status: 'graded',
    isCorrect: true,
    score: 1,
    reasoning: '',
    dimensions: {},
    ...over,
  });

  it('excludes errored results from the pass rate and counts them separately', () => {
    const s = summarize('m', [
      row({ isCorrect: true }),
      row({ isCorrect: false, score: 0 }),
      row({ status: 'errored', isCorrect: false, score: 0 }),
      row({ grader: 'model', isCorrect: true }),
    ]);
    expect(s.nJudge).toBe(3);
    expect(s.nJudgeErrored).toBe(1);
    expect(s.judgePassRate).toBe(0.5);
    expect(s.nModel).toBe(1);
    expect(s.modelPassRate).toBe(1);
  });

  it('a metric whose every judge errored has a null rate, not 0', () => {
    const s = summarize('m', [row({ status: 'errored', isCorrect: false, score: 0 })]);
    expect(s.judgePassRate).toBeNull();
  });
});

describe('applyRubric', () => {
  const RUBRIC = ['accurate', 'grounded', 'clear'] as const;
  const dims = (values: Record<string, number>) => Object.entries(values).map(([name, value]) => ({ name, value }));

  it('leaves a verdict that already follows the rubric alone', () => {
    const ruled = applyRubric({ isCorrect: true, score: 0.9, dimensions: dims({ accurate: 1, grounded: 1, clear: 1 }) }, RUBRIC);
    expect(ruled).toEqual({ isCorrect: true, score: 0.9, dimensions: { accurate: 1, grounded: 1, clear: 1 }, adjusted: false });
  });

  it('fails a verdict that reported isCorrect beside an unmet dimension, and caps its score', () => {
    const ruled = applyRubric({ isCorrect: true, score: 0.85, dimensions: dims({ accurate: 1, grounded: 0, clear: 1 }) }, RUBRIC);
    expect(ruled).toMatchObject({ isCorrect: false, score: 0.5, adjusted: true });
  });

  it('treats a non-binary or missing dimension as unmet and matches names case-insensitively', () => {
    const ruled = applyRubric({ isCorrect: true, score: 0.7, dimensions: dims({ Accurate: 1, grounded: 0.6 }) }, RUBRIC);
    expect(ruled.dimensions).toEqual({ accurate: 1, grounded: 0, clear: 0 });
    expect(ruled).toMatchObject({ isCorrect: false, score: 0.2, adjusted: true });
  });
});
