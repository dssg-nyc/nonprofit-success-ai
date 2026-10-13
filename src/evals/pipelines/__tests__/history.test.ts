import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalibrationResult, RunManifest } from '../../types';
import { judgeConfusion, loadRunHistory } from '../history';

// The report's trend sections read the history this module builds. What they must be
// able to trust: heuristic-only runs are out, a logged run and its local directory are
// one entry (never two), an unlogged local keyed run still appears, and a run's judge
// calibration rows come from its own directory.

const manifest = (id: string, over: Partial<RunManifest> = {}): RunManifest => ({
  id,
  label: null,
  git: { commit: 'abc1234', dirty: false },
  promptVersions: { scout: 'scout-routing-0.05', judge: '0.05' },
  promptHashes: { scout: 'aaa', judge: 'jjj' },
  fixtures: { scoutRouting: 'fff' },
  flags: { judges: true, model: true, gate: false },
  drift: [],
  ...over,
});

const summary = (run: RunManifest, generatedAt: string, extra: Record<string, unknown> = {}) => ({
  generatedAt,
  nCases: 1,
  judgesRan: run.flags.judges,
  modelCallsRan: run.flags.model,
  summaries: [
    { metric: 'scoutRouting', nHeuristic: 1, nJudge: 0, heuristicPassRate: 1, judgePassRate: null, judgeMeanScore: null },
  ],
  run,
  ...extra,
});

const calibrationRow = (id: string, judgeSaid: boolean, label: boolean, status: 'graded' | 'errored' = 'graded'): CalibrationResult => ({
  id,
  judge: 'scoutRationale',
  caseId: 'c',
  expected: { isCorrect: label, failed: label ? [] : ['accurate'] },
  verdict: { caseId: 'c', metric: 'scoutRationale', grader: 'judge', status, isCorrect: judgeSaid, score: judgeSaid ? 1 : 0, reasoning: '', dimensions: {} },
  agreed: status === 'graded' ? judgeSaid === label : null,
  dimensionsAgreed: {},
});

function scaffold() {
  const root = mkdtempSync(resolve(tmpdir(), 'eval-history-'));
  const runsDir = resolve(root, 'runs');
  const logPath = resolve(root, 'log.jsonl');
  const writeRun = (run: RunManifest, generatedAt: string, extra: Record<string, unknown> = {}, rows?: CalibrationResult[]) => {
    const dir = resolve(runsDir, run.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'summary.json'), JSON.stringify(summary(run, generatedAt, extra)));
    if (rows) writeFileSync(resolve(dir, 'calibration.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  return { root, runsDir, logPath, writeRun };
}

const calibrationSummary = {
  judgeVersion: '0.05',
  nCases: 2,
  judges: [{ judge: 'scoutRationale', n: 2, nErrored: 0, agreement: 0.5, dimensions: {} }],
};

describe('loadRunHistory', () => {
  it('keeps keyed runs only, merges a logged run with its directory, and orders oldest first', () => {
    const { runsDir, logPath, writeRun } = scaffold();
    const logged = manifest('2026-10-08T11-00-00-000Z');
    const local = manifest('2026-10-08T12-00-00-000Z', { flags: { judges: true, model: false, gate: false } });
    const heuristic = manifest('2026-10-08T13-00-00-000Z', { flags: { judges: false, model: false, gate: true } });
    // A `--only` run called a model but graded one metric: not a point on the others' history.
    const scoped = manifest('2026-10-08T14-00-00-000Z', { flags: { judges: true, model: true, gate: false, only: ['chronicleDraft'] } });
    writeRun(logged, '2026-10-08T11:00:00.000Z', { calibration: calibrationSummary }, [calibrationRow('a', true, true)]);
    writeRun(local, '2026-10-08T12:00:00.000Z');
    writeRun(heuristic, '2026-10-08T13:00:00.000Z');
    writeRun(scoped, '2026-10-08T14:00:00.000Z');
    writeFileSync(
      logPath,
      JSON.stringify({ ...logged, generatedAt: '2026-10-08T11:00:00.000Z', models: { agent: 'g', judge: 'o' }, summaries: [] }) + '\n',
    );

    const history = loadRunHistory({ logPath, runsDir });

    expect(history.map((h) => [h.id, h.source])).toEqual([
      ['2026-10-08T11-00-00-000Z', 'log'],
      ['2026-10-08T12-00-00-000Z', 'local'],
    ]);
    // The logged entry carries the calibration from its directory, rows included.
    expect(history[0].calibration?.judgeVersion).toBe('0.05');
    expect(history[0].calibrationRows).toHaveLength(1);
    expect(history[1].calibration).toBeNull();
    expect(history[1].calibrationRows).toEqual([]);
  });

  it('carries per-dimension tallies and agreement through from a run that has them', () => {
    const { runsDir, logPath, writeRun } = scaffold();
    const run = manifest('2026-10-13T10-00-00-000Z', { flags: { judges: true, model: true, gate: false, samples: 2 } });
    const dimensions = { heuristic: { bucket: { passed: 1, graded: 1 } }, model: { bucket: { passed: 0, graded: 1 } } };
    const agreement = { nSamples: 2, model: 1, modelJudge: null };
    writeRun(run, '2026-10-13T10:00:00.000Z', {
      summaries: [
        {
          metric: 'scoutRouting',
          nHeuristic: 1,
          nJudge: 0,
          heuristicPassRate: 1,
          judgePassRate: null,
          judgeMeanScore: null,
          nModel: 1,
          modelPassRate: 0,
          dimensions,
          agreement,
        },
      ],
    });

    const [entry] = loadRunHistory({ logPath, runsDir });
    expect(entry.flags.samples).toBe(2);
    expect(entry.summaries[0].dimensions).toEqual(dimensions);
    expect(entry.summaries[0].agreement).toEqual(agreement);
  });

  it('includes a logged run whose directory is gone, and a backfilled baseline without hashes', () => {
    const { runsDir, logPath } = scaffold();
    const baseline = manifest('2026-10-07T15-43-14-222Z', {
      label: 'baseline (pre-tracking)',
      git: { commit: null, dirty: null },
      promptHashes: null,
      fixtures: null,
      backfilled: true,
    });
    writeFileSync(
      logPath,
      JSON.stringify({ ...baseline, generatedAt: '2026-10-07T15:43:14.222Z', models: { agent: null, judge: null }, summaries: [] }) + '\n',
    );

    const [entry] = loadRunHistory({ logPath, runsDir });
    expect(entry.backfilled).toBe(true);
    expect(entry.fixtures).toBeNull();
    expect(entry.calibration).toBeNull();
  });

  it('returns nothing when there is no log and no runs directory', () => {
    const { root } = scaffold();
    expect(loadRunHistory({ logPath: resolve(root, 'none.jsonl'), runsDir: resolve(root, 'none') })).toEqual([]);
  });
});

describe('judgeConfusion', () => {
  it('splits verdicts into agreed passes, lenient, harsh, agreed fails and errored', () => {
    const rows = [
      calibrationRow('tp', true, true),
      calibrationRow('lenient', true, false),
      calibrationRow('harsh', false, true),
      calibrationRow('tn', false, false),
      calibrationRow('err', true, true, 'errored'),
    ];
    expect(judgeConfusion(rows)).toEqual({ tp: 1, lenient: 1, harsh: 1, tn: 1, errored: 1 });
    expect(judgeConfusion(rows, 'envoyDraft')).toEqual({ tp: 0, lenient: 0, harsh: 0, tn: 0, errored: 0 });
  });
});
