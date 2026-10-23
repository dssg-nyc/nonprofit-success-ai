import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JudgeCache, judgeCacheKey, setJudgeCache } from '../graders/judges/cache';
import { EnvoyDraftJudge } from '../graders/judges/envoyDraft';
import { resetScheduler, defaultSchedulerOptions } from '../scheduler';
import { evalCaseSchema } from '../types';
import type { GraderResult } from '../types';

type Gateway = typeof import('../../model/gateway');
const gateway = vi.hoisted(() => ({ callModel: vi.fn() }));
vi.mock('../../model/gateway', async (importOriginal) => {
  const actual = await importOriginal<Gateway>();
  return { ...actual, callModel: gateway.callModel };
});

const graded: GraderResult = {
  caseId: 'c-1',
  metric: 'envoyDraft',
  grader: 'judge',
  source: 'template',
  status: 'graded',
  isCorrect: true,
  score: 1,
  reasoning: 'grounded',
  dimensions: { grounded: 1 },
  output: { big: 'payload' },
};
const key = (caseId = 'c-1', item = 'item text') =>
  judgeCacheKey({ metric: 'envoyDraft', judgeVersion: '0.05', system: 'rubric', model: 'nano', caseId, item });

let dir: string;
let cache: JudgeCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'judge-cache-'));
  cache = new JudgeCache(join(dir, 'judge-cache.jsonl'));
});

afterEach(() => {
  setJudgeCache(null);
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('judgeCacheKey', () => {
  it('is stable for the same call and changes with any input', () => {
    expect(key()).toBe(key());
    expect(key('c-2')).not.toBe(key());
    expect(key('c-1', 'other output')).not.toBe(key());
    expect(judgeCacheKey({ metric: 'envoyDraft', judgeVersion: '0.06', system: 'rubric', model: 'nano', caseId: 'c-1', item: 'item text' })).not.toBe(key());
  });
});

describe('JudgeCache', () => {
  it('round-trips a graded verdict through the file, restoring the output from the item', () => {
    cache.put(key(), graded);
    const line = JSON.parse(readFileSync(join(dir, 'judge-cache.jsonl'), 'utf-8').trim()) as { result: GraderResult };
    expect(line.result).not.toHaveProperty('output');

    const fresh = new JudgeCache(join(dir, 'judge-cache.jsonl'));
    expect(fresh.get(key(), { other: 'output' })).toEqual({ ...graded, output: { other: 'output' } });
    expect(fresh.get(key('c-2'), {})).toBeUndefined();
    expect([fresh.hits, fresh.misses]).toEqual([1, 1]);
  });

  it('never stores an errored verdict', () => {
    cache.put(key(), { ...graded, status: 'errored', error: 'judge_failed' });
    expect(cache.get(key(), {})).toBeUndefined();
  });

  it('skips a torn or malformed line instead of failing', () => {
    const path = join(dir, 'judge-cache.jsonl');
    cache.put(key(), graded);
    writeFileSync(path, readFileSync(path, 'utf-8') + '{"key":"half', 'utf-8');
    const fresh = new JudgeCache(path);
    expect(fresh.get(key(), {})).toMatchObject({ caseId: 'c-1', status: 'graded' });
  });
});

describe('LLMJudge.gradeBatch with the cache', () => {
  const judge = new EnvoyDraftJudge();
  const [first, second] = readFileSync(resolve(__dirname, '..', 'fixtures', 'envoyDraft.jsonl'), 'utf-8')
    .split('\n')
    .slice(0, 2)
    .map((line) => evalCaseSchema.parse(JSON.parse(line)));
  const verdict = (caseId: string) => ({
    caseId,
    isCorrect: true,
    score: 1,
    reasoning: 'grounded in the plan title',
    dimensions: judge.dimensions.map((name) => ({ name, value: 1 })),
  });
  const reply = (...ids: string[]) => ({ object: { verdicts: ids.map(verdict) }, runId: null, model: 'test', usage: { inputTokens: 0, outputTokens: 0 }, retried: false });
  const items = () => [
    { evalCase: first, output: judge.template(first), source: 'template' as const },
    { evalCase: second, output: judge.template(second), source: 'model' as const },
  ];

  beforeEach(() => {
    vi.stubEnv('EVAL_JUDGE_CACHE', '1');
    setJudgeCache(cache);
    resetScheduler({ ...defaultSchedulerOptions(), minIntervalMs: 0, sleep: async () => {} });
    gateway.callModel.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => resetScheduler());

  it('judges a template item once; a rerun reuses its verdict and still judges the model item', async () => {
    gateway.callModel.mockResolvedValueOnce(reply(first.id, second.id));
    const run1 = await judge.gradeBatch(items());
    expect(run1.map((r) => [r.caseId, r.source, r.status])).toEqual([
      [first.id, 'template', 'graded'],
      [second.id, 'model', 'graded'],
    ]);
    expect(gateway.callModel).toHaveBeenCalledTimes(1);

    gateway.callModel.mockResolvedValueOnce(reply(second.id));
    const run2 = await judge.gradeBatch(items());
    expect(gateway.callModel).toHaveBeenCalledTimes(2);
    const sent = gateway.callModel.mock.calls[1][0] as { prompt: string };
    expect(sent.prompt).toContain(`### Item ${second.id}`);
    expect(sent.prompt).not.toContain(`### Item ${first.id}`);
    expect(run2[0]).toEqual({ ...run1[0], output: judge.template(first) });
    expect(run2[1].status).toBe('graded');
    expect([cache.hits, cache.misses]).toEqual([1, 1]);
  });

  it('with EVAL_JUDGE_CACHE=0 every item is judged', async () => {
    vi.stubEnv('EVAL_JUDGE_CACHE', '0');
    cache.put(key(), graded);
    gateway.callModel.mockResolvedValue(reply(first.id, second.id));
    await judge.gradeBatch(items());
    await judge.gradeBatch(items());
    expect(gateway.callModel).toHaveBeenCalledTimes(2);
    expect(cache.hits).toBe(0);
  });
});
