export type GatewayErrorCode =
  | 'model_key_missing'
  | 'model_call_failed'
  | 'model_timeout'
  | 'model_rate_limited'
  | 'model_parse_error';

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GatewayError';
  }

  toResponse(): Response {
    return Response.json({ error: this.code }, { status: this.httpStatus });
  }
}

export function classifyModelError(err: unknown): GatewayError {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
    return new GatewayError('model_rate_limited', 429, 'Model rate limited', err);
  }
  if (msg.toLowerCase().includes('timeout') || msg.includes('DEADLINE_EXCEEDED')) {
    return new GatewayError('model_timeout', 504, 'Model call timed out', err);
  }
  if (msg.toLowerCase().includes('parse') || msg.toLowerCase().includes('validation')) {
    return new GatewayError('model_parse_error', 502, 'Model returned unparseable response', err);
  }
  return new GatewayError('model_call_failed', 502, msg, err);
}
