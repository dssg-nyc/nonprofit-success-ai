export type BodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response };

/**
 * Rung 1 of the failure ladder (stack/vercel-functions.md): bad JSON is a 400. There is
 * no "no model key" rung any more — every agent route has work to do without a key
 * (the deterministic fallback), so a missing key is a fallback everywhere, never a 503.
 */
export async function parseJsonBody(request: Request): Promise<BodyResult> {
  try {
    return { ok: true, body: (await request.json()) as unknown };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: 'invalid_json' }, { status: 400 }),
    };
  }
}
