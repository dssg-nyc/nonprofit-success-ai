/**
 * List prices per million tokens, in USD, for the models the gateway calls. The
 * recorder turns a run's token counts into `agent_runs.cost_cents` with these, so the
 * `agent_run_metrics` view can sum spend per agent per day (observability.md Q5).
 *
 * Prices are copied from the providers' public price pages (2026-10) and go stale:
 * `GATEWAY_PRICING` — a JSON object of `{ "<model id>": [input, output] }` — overrides or
 * extends the table without a code change. An unknown model costs null, never 0: a
 * zero would read as "free" in the view, a null as "not priced".
 */

export type PricePerMillion = readonly [input: number, output: number];

const LIST: Record<string, PricePerMillion> = {
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.1-flash-lite': [0.125, 0.75],
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'gpt-5.4-nano': [0.2, 1.25],
};

function overrides(): Record<string, PricePerMillion> {
  const raw = process.env.GATEWAY_PRICING;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, PricePerMillion> = {};
    for (const [model, price] of Object.entries(parsed)) {
      if (
        Array.isArray(price) &&
        price.length === 2 &&
        price.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      ) {
        out[model] = [price[0] as number, price[1] as number];
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The price for `model`, env overrides first; undefined when nobody listed it. */
export function priceOf(model: string): PricePerMillion | undefined {
  return overrides()[model] ?? LIST[model];
}

/**
 * The cost of one call in cents, to four decimals, or null when the model is unpriced
 * or the provider reported no usage. Either token count may be missing on a failed
 * call; a missing count is 0 tokens of that kind, since the other kind was still spent.
 */
export function costCents(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number },
): number | null {
  const price = priceOf(model);
  if (!price) return null;
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return null;
  const dollars =
    ((usage.inputTokens ?? 0) * price[0] + (usage.outputTokens ?? 0) * price[1]) / 1_000_000;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}
