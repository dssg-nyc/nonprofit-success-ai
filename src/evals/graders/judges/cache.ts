import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graderResultSchema } from '../../types';
import type { GraderResult } from '../../types';

/**
 * Verdict cache for the judges' deterministic inputs.
 *
 * A judge sees two outputs per case: the agent's template (a pure function of the
 * fixture) and its model output (new every run). The template verdict is the gated one,
 * and the template changes only when the agent's code or the fixture does — yet every
 * run paid for it again (2026-10-08: half of a run's judge calls, a quarter of its spend).
 * The calibration rows are the same: hand-written outputs that never change.
 *
 * The key is a hash of everything the judge call depends on: the metric, the judge
 * prompt version, the full system prompt, the judge model, the case id, and the item's
 * user message (which carries the output and the reference facts). Any change to any of
 * them is a miss, so a cached verdict is never stale by construction — it is exactly the
 * verdict the same call would have produced, minus the model's sampling noise.
 *
 * Only `source: 'template'` items are looked up; model outputs are judged every time.
 * Errored verdicts are never stored. `EVAL_JUDGE_CACHE=0` bypasses it for a run (to
 * re-measure judge noise, say). The file is an append-only JSONL under the git-ignored
 * reports output, one `{ key, result }` per line, last write wins on read.
 */

const DEFAULT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'reports',
  'output',
  'judge-cache.jsonl',
);

export function judgeCacheEnabled(): boolean {
  return process.env.EVAL_JUDGE_CACHE !== '0';
}

/** sha256 of the call's inputs, in a fixed field order so the same call hashes the same. */
export function judgeCacheKey(call: {
  metric: string;
  judgeVersion: string;
  system: string;
  model: string;
  caseId: string;
  item: string;
}): string {
  const hash = createHash('sha256');
  for (const field of [call.metric, call.judgeVersion, call.system, call.model, call.caseId, call.item]) {
    hash.update(field).update('\0');
  }
  return hash.digest('hex');
}

/** What a cache line stores: the verdict without the (large, key-covered) output. */
type Stored = Omit<GraderResult, 'output'>;

export class JudgeCache {
  hits = 0;
  misses = 0;
  private entries: Map<string, Stored> | null = null;

  constructor(private readonly path: string = DEFAULT_PATH) {}

  private load(): Map<string, Stored> {
    if (this.entries) return this.entries;
    this.entries = new Map();
    let text: string;
    try {
      text = readFileSync(this.path, 'utf-8');
    } catch {
      return this.entries; // No file yet: an empty cache.
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { key?: unknown; result?: unknown };
        const result = graderResultSchema.safeParse(parsed.result);
        if (typeof parsed.key === 'string' && result.success) this.entries.set(parsed.key, result.data);
      } catch {
        // A torn line (a run killed mid-append) is skipped, not fatal: it costs one judge call.
      }
    }
    return this.entries;
  }

  /** The cached verdict, with `output` restored from the item, or undefined on a miss. */
  get(key: string, output: unknown): GraderResult | undefined {
    const stored = this.load().get(key);
    if (!stored) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return { ...stored, output };
  }

  /** Stores a graded verdict; an errored one is not a verdict and is dropped. */
  put(key: string, result: GraderResult): void {
    if (result.status !== 'graded') return;
    const stored: Stored = { ...result };
    delete (stored as Partial<GraderResult>).output; // key-covered, not stored
    this.load().set(key, stored);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify({ key, result: stored }) + '\n', 'utf-8');
  }
}

let active: JudgeCache | null = null;

/** The process-wide cache, or null when `EVAL_JUDGE_CACHE=0`. */
export function judgeCache(): JudgeCache | null {
  if (!judgeCacheEnabled()) return null;
  active ??= new JudgeCache();
  return active;
}

/** Tests: swap in a cache on a scratch path (or null to reset to the default). */
export function setJudgeCache(cache: JudgeCache | null): void {
  active = cache;
}
