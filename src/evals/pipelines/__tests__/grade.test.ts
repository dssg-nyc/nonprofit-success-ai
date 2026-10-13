import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grade as gradeArchitectScoring } from '../../graders/heuristic/architectScoring';
import { grade as gradeScoutRouting } from '../../graders/heuristic/scoutRouting';
import { evalCaseSchema } from '../../types';
import { modelSamples, parseArgs } from '../grade';

const FIXTURES_DIR = resolve(__dirname, '..', '..', 'fixtures');

function loadFixture(name: string) {
  const path = resolve(FIXTURES_DIR, `${name}.jsonl`);
  const lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line.trim().length > 0);
  return lines.map((line) => evalCaseSchema.parse(JSON.parse(line)));
}

describe('fixture files', () => {
  it('scoutRouting.jsonl: every case validates against evalCaseSchema', () => {
    const cases = loadFixture('scoutRouting');
    // 20 is the eval-harness.md floor for a gated threshold; scout_routing_pass_rate is gated.
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it('scoutRouting.jsonl: no two cases share an input, and every case has a note', () => {
    const cases = loadFixture('scoutRouting');
    const inputs = cases.map((c) => JSON.stringify(c.input));
    expect(new Set(inputs).size).toBe(inputs.length);
    for (const c of cases) expect(c.note, `${c.id} has no note`).toBeTruthy();
  });

  it('architectScoring.jsonl: every case validates against evalCaseSchema', () => {
    const cases = loadFixture('architectScoring');
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });
});

describe('scoutRouting heuristic grader against golden fixtures', () => {
  const cases = loadFixture('scoutRouting');

  it('every case passes', () => {
    for (const evalCase of cases) {
      const result = gradeScoutRouting(evalCase);
      expect(result.isCorrect, `${evalCase.id}: ${result.reasoning}`).toBe(true);
    }
  });
});

describe('architectScoring heuristic grader against golden fixtures', () => {
  const cases = loadFixture('architectScoring');

  it('every case passes', () => {
    for (const evalCase of cases) {
      const result = gradeArchitectScoring(evalCase);
      expect(result.isCorrect, `${evalCase.id}: ${result.reasoning}`).toBe(true);
    }
  });
});

describe('parseArgs', () => {
  // The label falls back to EVAL_LABEL, and `make eval` exports it before the gate's test
  // step runs, so a labelled keyed run must not leak into these defaults.
  beforeEach(() => vi.stubEnv('EVAL_LABEL', ''));
  afterEach(() => vi.unstubAllEnvs());

  const metrics = { scoutRouting: {}, chronicleDraft: {}, chronicleReadiness: {} };

  it('grades every metric by default, labelled by the prompt versions', () => {
    const args = parseArgs([], metrics);
    expect(args.only).toBeNull();
    expect(args.noJudges).toBe(false);
    expect(args.gate).toBe(false);
    expect(args.label).toMatch(/scout/);
  });

  it('--only narrows the run to the named metrics, deduplicated, and labels it by them', () => {
    const args = parseArgs(['--only', 'chronicleDraft,chronicleReadiness,chronicleDraft', '--gate'], metrics);
    expect(args.only).toEqual(['chronicleDraft', 'chronicleReadiness']);
    expect(args.gate).toBe(true);
    expect(args.label).toBe('only chronicleDraft, chronicleReadiness');
  });

  it('--only rejects an unknown metric or an empty list, naming the known ones', () => {
    expect(() => parseArgs(['--only', 'chronicle'], metrics)).toThrow(/unknown: chronicle.*known: scoutRouting/);
    expect(() => parseArgs(['--only'], metrics)).toThrow(/known: scoutRouting/);
  });

  it('an explicit --label wins over the scoped default', () => {
    expect(parseArgs(['--only', 'scoutRouting', '--label', 'tier words'], metrics).label).toBe('tier words');
  });
});

describe('modelSamples', () => {
  it('defaults to one sample', () => {
    expect(modelSamples({})).toBe(1);
    expect(modelSamples({ EVAL_MODEL_SAMPLES: '' })).toBe(1);
  });

  it('reads a positive integer and rejects anything else', () => {
    expect(modelSamples({ EVAL_MODEL_SAMPLES: '3' })).toBe(3);
    expect(() => modelSamples({ EVAL_MODEL_SAMPLES: '0' })).toThrow(/positive integer/);
    expect(() => modelSamples({ EVAL_MODEL_SAMPLES: '1.5' })).toThrow(/positive integer/);
    expect(() => modelSamples({ EVAL_MODEL_SAMPLES: 'many' })).toThrow(/positive integer/);
  });
});
