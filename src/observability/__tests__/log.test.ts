import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addLogSink, errorName, log } from '../log';

let lines: Array<{ level: string; line: Record<string, unknown> }> = [];

beforeEach(() => {
  lines = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...data: unknown[]) => {
      lines.push({ level, line: JSON.parse(String(data[0])) as Record<string, unknown> });
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('log', () => {
  it('writes one JSON line with ts, level, event and the given fields, undefined dropped', () => {
    log('warn', 'model_call', { agent: 'scout', code: 'model_timeout', durationMs: 25_001, retried: undefined });

    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
    expect(lines[0].line).toEqual({
      ts: expect.any(String),
      level: 'warn',
      event: 'model_call',
      agent: 'scout',
      code: 'model_timeout',
      durationMs: 25_001,
    });
  });

  it('caps detail at 200 characters', () => {
    log('error', 'model_call', { detail: 'x'.repeat(1_000) });
    expect(lines[0].line.detail).toHaveLength(200);
  });

  it('drops lines below LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    log('info', 'model_call', {});
    log('warn', 'model_call', {});
    vi.stubEnv('LOG_LEVEL', 'silent');
    log('error', 'model_call', {});
    expect(lines.map((l) => l.level)).toEqual(['warn']);
  });

  it('delivers every line to a sink, below LOG_LEVEL too, until removed', () => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    const seen: unknown[] = [];
    const remove = addLogSink((line) => seen.push(line));
    log('info', 'model_call', { agent: 'scout', durationMs: 812 });
    remove();
    log('info', 'model_call', {});

    expect(lines).toHaveLength(0);
    expect(seen).toEqual([
      { ts: expect.any(String), level: 'info', event: 'model_call', agent: 'scout', durationMs: 812 },
    ]);
  });

  it('errorName gives the class name, never the message', () => {
    expect(errorName(new TypeError('intake: Jane Doe'))).toBe('TypeError');
    expect(errorName('a string')).toBe('string');
  });
});
