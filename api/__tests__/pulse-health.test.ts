import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Supabase is the only seam replaced: auth plus a user-scoped client whose query chain
// resolves per table. The Pulse heuristic and the row mapping stay real.

type Result = { data: unknown; error: { code?: string; message?: string; status?: number } | null };

const db = vi.hoisted(() => ({
  user: { data: { user: { id: 'user-1' } }, error: null } as Result,
  tables: {} as Record<string, Result>,
  queries: [] as Array<{
    table: string;
    filters: Array<[string, unknown]>;
    select?: string;
    order?: [string, unknown];
    limit?: number;
  }>,
  clientOptions: [] as unknown[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: unknown) => {
    db.clientOptions.push(options);
    return {
      auth: { getUser: async () => db.user },
      from: (table: string) => {
        const query: (typeof db.queries)[number] = { table, filters: [] };
        db.queries.push(query);
        const builder = {
          select: (cols: string) => {
            query.select = cols;
            return builder;
          },
          eq: (col: string, value: unknown) => {
            query.filters.push([col, value]);
            return builder;
          },
          order: (col: string, opts: unknown) => {
            query.order = [col, opts];
            return builder;
          },
          limit: (n: number) => {
            query.limit = n;
            return builder;
          },
          maybeSingle: async () => db.tables[table] ?? { data: null, error: null },
        };
        return builder;
      },
    };
  },
}));

const { GET } = await import('../pulse-health');
const { pulseSignalSchema } = await import('../../src/schemas');
const { addLogSink } = await import('../../src/observability/log');
import type { LogLine } from '../../src/observability/log';

const ID = 'eeeeeeee-0000-4000-8000-000000000001';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const ENGAGEMENT = {
  id: ID,
  stage: 'scoping',
  updated_at: ago(3),
  created_at: ago(30),
  assessment_id: 'aaaaaaaa-0000-0000-0000-000000000001',
};

const get = (query = `?engagementId=${ID}`, token: string | null = TOKEN) =>
  GET(
    new Request(`http://localhost/api/pulse-health${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );

let lines: LogLine[];
let removeSink: () => void;

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('LOG_LEVEL', 'silent');
  db.user = { data: { user: { id: 'user-1' } }, error: null };
  db.tables = {
    engagements: { data: ENGAGEMENT, error: null },
    engagement_events: { data: { kind: 'note_added', created_at: ago(2) }, error: null },
  };
  db.queries = [];
  db.clientOptions = [];
  lines = [];
  removeSink = addLogSink((line) => lines.push(line));
});

afterEach(() => {
  removeSink();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/pulse-health', () => {
  it('401 without a bearer token, before any query', async () => {
    const res = await get(undefined, null);
    expect(res.status).toBe(401);
    expect(db.clientOptions).toHaveLength(0);
  });

  it('400 for a missing or non-uuid engagementId', async () => {
    for (const query of ['', '?engagementId=nope']) {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_input' });
    }
    expect(db.queries).toHaveLength(0);
  });

  it('404 when the engagement is missing or RLS-hidden', async () => {
    db.tables.engagements = { data: null, error: null };
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('503 and one route_failure log when the engagement query errors', async () => {
    db.tables.engagements = { data: null, error: { code: '42501', message: 'secret row detail' } };
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'lookup_failed' });
    const failures = lines.filter((l) => l.event === 'route_failure');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      route: 'pulse-health',
      step: 'engagement_lookup',
      code: '42501',
      engagementId: ID,
    });
    expect(JSON.stringify(failures[0])).not.toContain('secret');
  });

  it('503 and one route_failure log when the events query errors', async () => {
    db.tables.engagement_events = { data: null, error: { code: 'PGRST301' } };
    const res = await get();
    expect(res.status).toBe(503);
    const failures = lines.filter((l) => l.event === 'route_failure');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ step: 'events_lookup', code: 'PGRST301' });
  });

  it('200 with a schema-valid body; a 30-day-old blocker_raised event is stalled', async () => {
    db.tables.engagement_events = { data: { kind: 'blocker_raised', created_at: ago(30) }, error: null };
    const res = await get();
    expect(res.status).toBe(200);
    const body = pulseSignalSchema.parse(await res.json());
    expect(body).toMatchObject({
      engagementId: ID,
      status: 'stalled',
      daysSinceLastEvent: 30,
      hasPlan: true,
      hitlTier: 'L2',
    });
    expect(db.queries.map((q) => q.table)).toEqual(['engagements', 'engagement_events']);
    const events = db.queries[1];
    expect(events.order).toEqual(['created_at', { ascending: false }]);
    expect(events.limit).toBe(1);
    expect(events.select).toContain('created_at');
    expect(events.select).toContain('kind');
  });

  it('200 on_track for recent activity, null history handled as at_risk', async () => {
    const ok = await get();
    expect((await ok.json()).status).toBe('on_track');
    db.tables.engagement_events = { data: null, error: null };
    const none = await get();
    expect((await none.json()).status).toBe('at_risk');
  });
});
