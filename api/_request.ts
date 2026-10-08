import { currentRequestId, errorName, log, withRequestContext } from '../src/observability/log';

/**
 * The outermost layer of every `/api` handler: a request id for correlation and a
 * last-resort catch.
 *
 * Correlation: Vercel stamps each invocation with `x-vercel-id` (the id its own
 * function logs carry). The wrapper adopts it — or mints a UUID outside Vercel — puts
 * it in the log context so every line the handler logs carries `requestId` and
 * `route`, and echoes it back as `x-request-id` so a user reporting an error can quote
 * the id that finds its log lines.
 *
 * Catch: a handler that throws past its own try/catch would otherwise surface as
 * Vercel's bare 500 with nothing in our logs. Here it becomes a logged
 * `route_failure` (class name only, never the error — it may quote a request body) and
 * a JSON 500 that still carries the id.
 */

type Handler = (request: Request) => Response | Promise<Response>;

export function requestIdOf(request: Request): string {
  return request.headers.get('x-vercel-id') ?? crypto.randomUUID();
}

function withId(response: Response): Response {
  const id = currentRequestId();
  if (!id || response.headers.has('x-request-id')) return response;
  // Response.json() returns an immutable-headers response in some runtimes; copy instead.
  const headers = new Headers(response.headers);
  headers.set('x-request-id', id);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function handler(route: string, fn: Handler): Handler {
  return (request) =>
    withRequestContext({ requestId: requestIdOf(request), route }, async () => {
      try {
        return withId(await fn(request));
      } catch (err) {
        log('error', 'route_failure', { step: 'unhandled', code: 'internal_error', errorName: errorName(err) });
        return withId(Response.json({ error: 'internal_error' }, { status: 500 }));
      }
    });
}
