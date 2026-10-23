import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARCHITECT_PLAN_PROMPT_VERSION } from '../../agents/architect/model';
import { CHRONICLE_DRAFT_PROMPT_VERSION } from '../../agents/chronicle/model';
import { ENVOY_DRAFT_PROMPT_VERSION } from '../../agents/envoy/model';
import { SCOUT_ROUTING_PROMPT_VERSION } from '../../agents/scout/model';
import { JUDGE_PROMPT_VERSION } from '../graders/judges/base';
import type { EvalReport, RunManifest } from '../types';

/**
 * Experiment tracking: what a run was, so runs can be compared by version.
 *
 * Every grade run gets a manifest (`summary.json` `run`): its id and label, the git commit
 * and whether the tree was dirty, each prompt's declared version, a hash of each prompt's
 * source, and a hash of each fixture file. Two runs are comparable on a metric when
 * their fixture hashes match; a prompt change shows up as a version bump.
 *
 * The hash catches the one thing a version cannot: a prompt edited without bumping its
 * version. `versionDrift()` compares a run against the log and names every prompt whose
 * source changed under an unchanged version, so two different prompts never share a row
 * in the history.
 *
 * Runs that called a model are appended to `experiments/log.jsonl`, which is tracked:
 * entries hold versions, hashes, models and pass rates only — no fixture text, no model
 * output — so the history of what each prompt change did is shared with the team. The
 * full run (graded rows, outputs, call log) stays in the git-ignored `runs/<id>/`.
 */

/** The source files each prompt is built from, relative to `src/`. */
const PROMPT_SOURCES: Record<string, string[]> = {
  scout: ['agents/scout/schema.ts'],
  architect: ['agents/architect/schema.ts'],
  envoy: ['agents/envoy/schema.ts'],
  chronicle: ['agents/chronicle/schema.ts'],
  judge: ['evals/graders/judges'],
};

export function promptVersions(): Record<string, string> {
  return {
    scout: SCOUT_ROUTING_PROMPT_VERSION,
    architect: ARCHITECT_PLAN_PROMPT_VERSION,
    envoy: ENVOY_DRAFT_PROMPT_VERSION,
    chronicle: CHRONICLE_DRAFT_PROMPT_VERSION,
    judge: JUDGE_PROMPT_VERSION,
  };
}

/**
 * The default run label: every prompt's version, `scout 0.03, architect 0.02, …`, so a
 * keyed run is named by what it measured without anyone typing the versions out. A
 * `--label` / `EVAL_LABEL` replaces it when a run is about something else.
 */
export function versionLabel(versions: Record<string, string> = promptVersions()): string {
  return Object.entries(versions)
    .map(([name, version]) => `${name} ${version.replace(/^.*?-(?=\d)/, '')}`)
    .join(', ');
}

const shortHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/**
 * Relative import specifiers hash without their ESM extension (`./x.js` → `./x`,
 * `../types/index.js` → `../types`), so adding the extensions Node needs (#56) is not
 * read as a prompt edit and every hash logged before it still compares.
 */
export const normaliseImports = (text: string): string =>
  text.replace(/(['"])(\.{1,2}\/[^'"]*?)(?:\/index)?\.js\1/g, '$1$2$1');

/** A directory hashes as its `.ts` files in name order. */
function sourceText(path: string): string {
  try {
    return normaliseImports(readFileSync(path, 'utf-8'));
  } catch {
    return readdirSync(path)
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => normaliseImports(readFileSync(resolve(path, name), 'utf-8')))
      .join('\n');
  }
}

export function promptHashes(srcRoot: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PROMPT_SOURCES).map(([key, paths]) => [
      key,
      shortHash(paths.map((p) => sourceText(resolve(srcRoot, p))).join('\n')),
    ]),
  );
}

export function fixtureHashes(fixturesDir: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(fixturesDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .map((name) => [name.replace(/\.jsonl$/, ''), shortHash(readFileSync(resolve(fixturesDir, name), 'utf-8'))]),
  );
}

export function gitState(cwd: string): RunManifest['git'] {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== '';
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

/** `2026-10-07T16-45-38-572Z` or, with a label, `2026-10-07T16-45-38-572Z_scout-prompt-v2`. */
export function runId(generatedAt: string, label: string | null): string {
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const slug = (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return slug ? `${stamp}_${slug}` : stamp;
}

/** One line of `experiments/log.jsonl`: the manifest, the models, and the numbers. */
export interface ExperimentEntry extends RunManifest {
  generatedAt: string;
  models: EvalReport['models'];
  summaries: EvalReport['summaries'];
  latency: { role: string; agent: string; promptVersion: string; n: number; nFailed: number; p50Ms: number }[];
  /** Judge-vs-label agreement per judge (numbers only), so the log tracks the judge too. Runs with judges only. */
  calibration?: EvalReport['calibration'];
}

export function experimentEntry(report: EvalReport & { run: RunManifest }): ExperimentEntry {
  return {
    ...report.run,
    generatedAt: report.generatedAt,
    models: report.models,
    summaries: report.summaries,
    latency: (report.latency ?? []).map(({ role, agent, promptVersion, n, nFailed, p50Ms }) => ({
      role,
      agent,
      promptVersion,
      n,
      nFailed,
      p50Ms,
    })),
    ...(report.calibration && { calibration: report.calibration }),
  };
}

/**
 * Prompts whose source hash differs from an earlier logged run with the same declared
 * version — edited without a version bump. Entries without hashes (backfilled) are skipped.
 */
export function versionDrift(run: RunManifest, log: Pick<RunManifest, 'promptVersions' | 'promptHashes'>[]): string[] {
  const drifted = new Set<string>();
  for (const entry of log) {
    if (!entry.promptHashes) continue;
    for (const [key, version] of Object.entries(run.promptVersions)) {
      const earlier = entry.promptHashes[key];
      if (entry.promptVersions[key] === version && earlier && earlier !== run.promptHashes?.[key]) drifted.add(key);
    }
  }
  return [...drifted].sort();
}
