import type { LogLine } from '../../observability/log';
import type { EvalReport } from '../types';

/**
 * Latency per model-call group, from the `model_call` lines grade.ts captures to
 * calls.jsonl. Only successful calls count toward the percentiles — a timeout's
 * duration is the timeout, not the model's speed — and failures are counted by code.
 */

/** One latency group: calls of one role (agent model path or judge) to one model, for one agent. */
export type LatencyGroup = NonNullable<EvalReport['latency']>[number];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const mean = (values: number[]): number | null =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

/** Groups `model_call` lines by role/agent/model/promptVersion. Judges' promptVersion is `judge:<metric>@<v>`. */
export function summarizeLatency(calls: LogLine[]): LatencyGroup[] {
  const groups = new Map<string, LogLine[]>();
  for (const call of calls) {
    if (call.event !== 'model_call') continue;
    const key = [call.agent, call.model, call.promptVersion].join('|');
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const ok = group.filter((c) => c.status === 'success');
    const durations = ok.map((c) => c.durationMs ?? 0).sort((a, b) => a - b);
    const failures: Record<string, number> = {};
    for (const c of group) if (c.status !== 'success') failures[c.code ?? 'unknown'] = (failures[c.code ?? 'unknown'] ?? 0) + 1;
    return {
      role: first.promptVersion?.startsWith('judge:') ? 'judge' : 'agent',
      agent: first.agent ?? 'unknown',
      model: first.model ?? 'unknown',
      promptVersion: first.promptVersion ?? 'unknown',
      n: group.length,
      nFailed: group.length - ok.length,
      failures,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.at(-1) ?? 0,
      meanInputTokens: mean(ok.flatMap((c) => (c.inputTokens != null ? [c.inputTokens] : []))),
      meanOutputTokens: mean(ok.flatMap((c) => (c.outputTokens != null ? [c.outputTokens] : []))),
    };
  });
}
