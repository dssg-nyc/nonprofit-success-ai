import { describe, expect, it } from 'vitest';
import type { RunManifest } from '../../types';
import { experimentEntry, promptVersions, runId, versionDrift, versionLabel } from '../experiments';

const manifest = (over: Partial<RunManifest> = {}): RunManifest => ({
  id: 'run',
  label: null,
  git: { commit: 'abc1234', dirty: false },
  promptVersions: { scout: 'scout-routing-v2', judge: 'v3' },
  promptHashes: { scout: 'aaa', judge: 'jjj' },
  fixtures: { scoutRouting: 'fff' },
  flags: { judges: true, model: true, gate: false },
  drift: [],
  ...over,
});

describe('runId', () => {
  it('is the timestamp with filesystem-safe separators', () => {
    expect(runId('2026-10-07T16:45:38.572Z', null)).toBe('2026-10-07T16-45-38-572Z');
  });

  it('appends a slug of the label', () => {
    expect(runId('2026-10-07T16:45:38.572Z', '  Scout prompt v3 / grounded!  ')).toBe(
      '2026-10-07T16-45-38-572Z_scout-prompt-v3-grounded',
    );
  });

  it('drops a label with nothing slug-worthy', () => {
    expect(runId('2026-10-07T16:45:38.572Z', '!!!')).toBe('2026-10-07T16-45-38-572Z');
  });
});

describe('versionDrift', () => {
  it('names a prompt whose source changed under the same version', () => {
    const run = manifest({ promptHashes: { scout: 'bbb', judge: 'jjj' } });
    expect(versionDrift(run, [manifest()])).toEqual(['scout']);
  });

  it('accepts a source change that came with a version bump', () => {
    const run = manifest({
      promptVersions: { scout: 'scout-routing-v3', judge: 'v3' },
      promptHashes: { scout: 'bbb', judge: 'jjj' },
    });
    expect(versionDrift(run, [manifest()])).toEqual([]);
  });

  it('skips backfilled entries, which carry no hashes', () => {
    const run = manifest({ promptHashes: { scout: 'bbb', judge: 'jjj' } });
    expect(versionDrift(run, [manifest({ promptHashes: null })])).toEqual([]);
  });
});

describe('experimentEntry', () => {
  it('keeps versions, models, rates and slim latency — no rows or outputs', () => {
    const entry = experimentEntry({
      generatedAt: '2026-10-07T16:45:38.572Z',
      nCases: 3,
      judgesRan: true,
      modelCallsRan: true,
      models: { agent: 'gemini', judge: 'gpt' },
      summaries: [],
      latency: [
        { role: 'agent', agent: 'scout', model: 'gemini', promptVersion: 'scout-routing-v2', n: 3, nFailed: 1, p50Ms: 900, p95Ms: 1500, meanMs: 1000, failures: { timeout: 1 } },
      ],
      run: manifest(),
    } as unknown as Parameters<typeof experimentEntry>[0]);

    expect(entry.id).toBe('run');
    expect(entry.promptVersions.scout).toBe('scout-routing-v2');
    expect(entry.latency).toEqual([
      { role: 'agent', agent: 'scout', promptVersion: 'scout-routing-v2', n: 3, nFailed: 1, p50Ms: 900 },
    ]);
    expect(entry).not.toHaveProperty('nCases');
  });

  it('keeps per-dimension tallies and sample agreement with the summaries — numbers, no text', () => {
    const summary = {
      metric: 'chronicleDraft',
      nHeuristic: 0,
      nJudge: 2,
      heuristicPassRate: null,
      judgePassRate: 0.5,
      judgeMeanScore: 0.6,
      nJudgeErrored: 0,
      nModel: 0,
      nModelErrored: 0,
      modelPassRate: null,
      nModelJudge: 2,
      nModelJudgeErrored: 0,
      modelJudgePassRate: 0.5,
      modelJudgeMeanScore: 0.4,
      dimensions: { judge: { grounded: { passed: 1, graded: 2 } }, modelJudge: { grounded: { passed: 2, graded: 2 } } },
      agreement: { nSamples: 2, model: null, modelJudge: 0.5 },
    };
    const entry = experimentEntry({
      generatedAt: '2026-10-13T10:00:00.000Z',
      nCases: 2,
      judgesRan: true,
      modelCallsRan: true,
      models: { agent: 'gemini', judge: 'gpt' },
      summaries: [summary],
      latency: [],
      run: manifest(),
    } as unknown as Parameters<typeof experimentEntry>[0]);

    expect(entry.summaries[0].dimensions).toEqual(summary.dimensions);
    expect(entry.summaries[0].agreement).toEqual(summary.agreement);
    expect(JSON.stringify(entry)).not.toMatch(/reasoning|output|rationale/);
  });
});

describe('versionLabel', () => {
  it('names a run by every prompt version, prefix dropped', () => {
    expect(versionLabel({ scout: 'scout-routing-0.03', judge: '0.04' })).toBe('scout 0.03, judge 0.04');
  });

  it('defaults to the live versions and survives the run-id slug whole', () => {
    const label = versionLabel();
    expect(label.split(', ')).toHaveLength(Object.keys(promptVersions()).length);
    const id = runId('2026-10-07T16:45:38.572Z', label);
    expect(id.endsWith(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'))).toBe(true);
  });
});
