import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { judgesAvailable } from '../graders/judges/base';
import { METRICS, fixtureName } from '../registry';
import type { AgentName } from '../../model/types';

describe('METRICS registry', () => {
  it('every entry name matches its key', () => {
    for (const [key, def] of Object.entries(METRICS)) {
      expect(def.name).toBe(key);
    }
  });

  it('every entry has a callable heuristic or a judge (never neither)', () => {
    for (const def of Object.values(METRICS)) {
      expect(def.heuristic !== null || def.judgeCls !== null).toBe(true);
    }
  });

  it('targetsKey is unique per metric', () => {
    const keys = Object.values(METRICS).map((d) => d.targetsKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Coverage invariant (DSG-26): every agent in the roster must be graded by at least
  // one metric. Architect had none for its free-text charter until architectCharter was
  // added; this fails the build if a future agent lands without evals, rather than
  // leaving the gap to be noticed by eye.
  it('every agent is covered by at least one metric', () => {
    const agents: AgentName[] = ['scout', 'architect', 'pulse', 'envoy', 'chronicle'];
    const registered = Object.keys(METRICS).map((m) => m.toLowerCase());
    for (const agent of agents) {
      const covered = registered.some((m) => m.startsWith(agent));
      expect(covered, `no eval metric covers agent "${agent}"`).toBe(true);
    }
  });

  // A gated metric with no fixtures grades zero cases and reports `n/a` forever — it
  // looks enforced in targets.yaml and enforces nothing. scout_rationale_pass_rate sat
  // that way at 0.8 (DSG-26). Gating is a claim that something is being checked; this
  // makes the claim falsifiable.
  it('every gated target has fixtures to grade', () => {
    const targetsPath = resolve(__dirname, '..', 'targets.yaml');
    const targets = (parseYaml(readFileSync(targetsPath, 'utf-8')) ?? {}) as Record<string, number>;

    for (const [name, def] of Object.entries(METRICS)) {
      if (!(def.targetsKey in targets)) continue;
      const fixture = resolve(__dirname, '..', 'fixtures', `${fixtureName(def)}.jsonl`);
      expect(
        existsSync(fixture),
        `${def.targetsKey} is gated in targets.yaml but fixtures/${fixtureName(def)}.jsonl (for ${name}) does not exist — ` +
          `the gate would grade zero cases. Add fixtures or comment the target out.`,
      ).toBe(true);
    }
  });

  // Ungated metrics too: a metric with no fixture file grades nothing, silently. A
  // `fixture:` redirect that names a missing file is the same failure one step removed.
  it("every metric's fixture file exists", () => {
    for (const [name, def] of Object.entries(METRICS)) {
      const fixture = resolve(__dirname, '..', 'fixtures', `${fixtureName(def)}.jsonl`);
      expect(existsSync(fixture), `${name}: fixtures/${fixtureName(def)}.jsonl does not exist`).toBe(true);
    }
  });

  it('a modelOutput producer is only declared on a judge metric', () => {
    for (const [name, def] of Object.entries(METRICS)) {
      if (def.modelOutput) expect(def.judgeCls, `${name} has modelOutput but no judge`).not.toBeNull();
    }
  });
});

describe('judgesAvailable', () => {
  it('is false without OPENAI_API_KEY — the default judge model is OpenAI', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
    expect(judgesAvailable()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('is true with OPENAI_API_KEY set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    expect(judgesAvailable()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('follows EVAL_JUDGE_MODEL to its provider key', () => {
    vi.stubEnv('EVAL_JUDGE_MODEL', 'gemini-3.5-flash-lite');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    expect(judgesAvailable()).toBe(false);
    vi.unstubAllEnvs();
  });
});
