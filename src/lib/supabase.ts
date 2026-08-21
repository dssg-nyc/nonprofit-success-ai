import {createClient} from '@supabase/supabase-js';

// Supabase client, following this repo's fail-fast env convention: a missing variable
// fails at import with a named error.
//
// The anon key is a public identifier, not a secret: it grants only what RLS allows
// (supabase/migrations/0001_init.sql). The service-role key bypasses RLS entirely and must
// never appear in a VITE_-prefixed variable — Vite inlines those into the client bundle.

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const satisfies
  readonly (keyof ImportMetaEnv)[];

const missing = REQUIRED.filter((name) => !import.meta.env[name]);

if (missing.length > 0) {
  throw new Error(
    `Supabase config incomplete — missing ${missing.length} of ${REQUIRED.length} ` +
      `environment variables:\n\n${missing.map((n) => `  ${n}`).join('\n')}\n\n` +
      `Run \`make db-start\` for a local stack (it prints the URL and anon key), then copy ` +
      `them into .env.\n\n` +
      `Note: Vite only reads .env at startup — restart the dev server after editing it.`,
  );
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

// ---------------------------------------------------------------------------
// Auth
//
// A thin shim over supabase.auth so components do not each re-derive the same shapes.
// `AppUser` deliberately keeps Firebase's field names (`uid`, `email`, `displayName`) —
// the components read `user.uid` and `user.email` in a dozen places, and renaming them
// would touch far more code than the auth swap itself needs to.
// ---------------------------------------------------------------------------

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export type AppRole = 'client' | 'admin';

const toAppUser = (u: {id: string; email?: string | null; user_metadata?: Record<string, unknown>} | null):
  AppUser | null =>
  u
    ? {
        uid: u.id,
        email: u.email ?? null,
        displayName:
          (u.user_metadata?.full_name as string | undefined) ??
          (u.user_metadata?.name as string | undefined) ??
          null,
      }
    : null;

/**
 * Subscribe to session changes. Mirrors Firebase's onAuthStateChanged contract: fires with
 * the current user (or null) and returns an unsubscribe function.
 *
 * Supabase does not emit an initial event for an already-restored session the way Firebase
 * does, so getSession() is called once up front. Without it a page reload with a valid
 * session sits on the loading spinner forever.
 */
export function onAuthChange(callback: (user: AppUser | null) => void): () => void {
  let active = true;

  supabase.auth.getSession().then(({data}) => {
    if (active) callback(toAppUser(data.session?.user ?? null));
  });

  const {data} = supabase.auth.onAuthStateChange((_event, session) => {
    if (active) callback(toAppUser(session?.user ?? null));
  });

  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
}

/**
 * The signed-in user's role, from public.users. Returns null if there is no profile row —
 * which should not happen, since 0008_user_provisioning.sql creates one per signup, but a
 * null role fails closed everywhere it is checked rather than defaulting to admin.
 */
export async function fetchRole(): Promise<AppRole | null> {
  const {data, error} = await supabase.from('users').select('role').maybeSingle();
  if (error || !data) return null;
  return data.role as AppRole;
}

export async function signOut(): Promise<void> {
  clearOrgCache();
  await supabase.auth.signOut();
}

// ---------------------------------------------------------------------------
// Organization context
//
// MVP single-org model: an authenticated user belongs to exactly one organization. This
// returns that org's id, which callers pass as `organization_id` on writes. The query goes
// through RLS (org_members_select), so it can only ever return orgs the user belongs to.
// ---------------------------------------------------------------------------

let cachedOrgId: string | null = null;

export async function getCurrentOrgId(): Promise<string | null> {
  if (cachedOrgId) return cachedOrgId;
  const {data} = await supabase
    .from('organization_members')
    .select('organization_id')
    .limit(1)
    .maybeSingle();
  cachedOrgId = data?.organization_id ?? null;
  return cachedOrgId;
}

/** Clear the cached org id (call on sign-out so a new session re-fetches). */
export function clearOrgCache(): void {
  cachedOrgId = null;
}

// ---------------------------------------------------------------------------
// Live queries
//
// Replaces Firestore's onSnapshot. Two differences matter:
//
//   1. Firestore delivers the initial result set with the subscription; Supabase Realtime
//      only streams *changes*. So this fetches once, then subscribes — without the fetch a
//      component renders empty until someone else writes.
//   2. Realtime sends the changed row, not the new result set. Rather than splice each
//      event into local state (and re-implement filtering and ordering client-side), this
//      re-runs the query on any change. Slightly more traffic for a lot less to get wrong,
//      at these row counts.
//
// Realtime must be enabled per table in the publication; see the migration that adds a
// table to `supabase_realtime`. Where it is not, the initial fetch still works and the
// view simply does not live-update.
// ---------------------------------------------------------------------------

type QueryBuilder = {
  then: (onfulfilled: (res: {data: unknown; error: unknown}) => void) => void;
};

export function liveQuery<T>(
  table: string,
  buildQuery: () => QueryBuilder,
  onData: (rows: T[]) => void,
  onError: (error: unknown) => void,
  timestampFields: readonly string[] = [],
): () => void {
  let active = true;

  const run = () => {
    buildQuery().then(({data, error}) => {
      if (!active) return;
      if (error) {
        onError(error);
        return;
      }
      const rows = (data as unknown[]) ?? [];
      onData(rows.map((row) => rowToDomain<T>(row, timestampFields)));
    });
  };

  run();

  const channel = supabase
    .channel(`live:${table}`)
    .on('postgres_changes', {event: '*', schema: 'public', table}, run)
    .subscribe();

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

// ---------------------------------------------------------------------------
// Key mapping
//
// Columns are snake_case (Postgres convention, and what the RLS policies are written
// against); the TS domain types stay camelCase. Mapping happens at the query edge so
// neither side has to compromise.
// ---------------------------------------------------------------------------

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function mapKeys<T>(value: unknown, transform: (key: string) => string): T {
  if (Array.isArray(value)) {
    return value.map((item) => mapKeys(item, transform)) as T;
  }
  // Date survives as-is; only plain objects are walked. Without this guard a Date would be
  // flattened into `{}` on the way to the database.
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value as T;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      transform(key),
      mapKeys(val, transform),
    ]),
  ) as T;
}

/** camelCase → snake_case, for values on their way into the database. */
export const toColumns = <T = Record<string, unknown>>(value: unknown): T =>
  mapKeys<T>(value, toSnake);

/** snake_case → camelCase, for rows on their way out of the database. */
export const fromColumns = <T,>(value: unknown): T => mapKeys<T>(value, toCamel);

// ---------------------------------------------------------------------------
// Timestamps
//
// PostgREST renders timestamptz as an ISO 8601 string, while the existing domain types
// model a timestamp as Firestore's `{ seconds }` shape, which components read directly
// (`business.createdAt?.seconds`). Converting here keeps src/types.ts and every read site
// unchanged across the migration — the alternative was rewriting a dozen render
// expressions for no behavioural gain.
// ---------------------------------------------------------------------------

/** ISO timestamp string → the `{ seconds }` shape the domain types expect. */
export function toTimestampLike(iso: string | null | undefined): {seconds: number} | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : {seconds: ms / 1000};
}

/**
 * `fromColumns` plus timestamp conversion for the named fields. Timestamps are converted by
 * an explicit field list rather than by sniffing values, so a genuine text column that
 * happens to hold a date-like string is never silently rewritten.
 */
export function rowToDomain<T>(row: unknown, timestampFields: readonly string[]): T {
  const mapped = fromColumns<Record<string, unknown>>(row);
  for (const field of timestampFields) {
    if (field in mapped) {
      mapped[field] = toTimestampLike(mapped[field] as string | null);
    }
  }
  return mapped as T;
}

// ---------------------------------------------------------------------------
// Error handling
//
// Ports the semantics of the former handleFirestoreError: log a structured record, then
// throw so the caller's catch still runs.
// ---------------------------------------------------------------------------

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface SupabaseErrorInfo {
  error: string;
  code: string | null;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleSupabaseError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  auth?: {userId?: string | null; email?: string | null},
): never {
  const err = error as {message?: string; code?: string} | null;
  const errInfo: SupabaseErrorInfo = {
    error: err?.message ?? String(error),
    code: err?.code ?? null,
    operationType,
    path,
    // Passed in by the caller: reading the session here would make this async, and an error
    // path is the wrong place to await a network round-trip.
    authInfo: auth ?? {},
  };
  console.error('Supabase Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
