import { describe, expect, it } from 'vitest';
import type { LogLine } from '../../../observability/log';
import { summarizeLatency } from '../latency';

const call = (fields: Partial<LogLine>): LogLine => ({
  ts: '2026-10-07T00:00:00.000Z',
  level: 'info',
  event: 'model_call',
  agent: 'scout',
  model: 'gemini-3.5-flash-lite',
  promptVersion: 'scout-routing-v2',
  status: 'success',
  ...fields,
});

describe('summarizeLatency', () => {
  it('groups by agent/model/promptVersion and tells agent calls from judge calls', () => {
    const groups = summarizeLatency([
      call({ durationMs: 100 }),
      call({ model: 'gpt-5.4-nano', promptVersion: 'judge:scoutRationale@v3', durationMs: 900 }),
    ]);
    expect(groups.map((g) => [g.role, g.promptVersion])).toEqual([
      ['agent', 'scout-routing-v2'],
      ['judge', 'judge:scoutRationale@v3'],
    ]);
  });

  it('takes percentiles over successful calls only and counts failures by code', () => {
    const [group] = summarizeLatency([
      ...[100, 200, 300, 400, 1_000].map((durationMs) => call({ durationMs, inputTokens: 10, outputTokens: 4 })),
      call({ status: 'error', code: 'model_timeout', durationMs: 30_000 }),
      call({ status: 'error', code: 'model_timeout', durationMs: 30_000 }),
    ]);
    expect(group).toMatchObject({
      n: 7,
      nFailed: 2,
      failures: { model_timeout: 2 },
      p50Ms: 300,
      p95Ms: 1_000,
      maxMs: 1_000,
      meanInputTokens: 10,
      meanOutputTokens: 4,
    });
  });

  it('ignores lines that are not model calls', () => {
    expect(summarizeLatency([call({ event: 'route_failure' })])).toEqual([]);
  });
});
