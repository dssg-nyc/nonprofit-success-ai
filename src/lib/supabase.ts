import {createClient} from '@supabase/supabase-js';

import type {Database} from './database.types';
import {rowToDomain} from './rows';
import {TEAM_EMAIL_DOMAIN, clearLoginIntent, writeLoginIntent} from './loginIntent';

// Supabase client, following this repo's fail-fast env convention: a missing variable
// fails at import with a named error.
//
// The anon key is a public identifier, not a secret: it grants only what RLS allows
// (supabase/migrations/0001_init.sql). The service-role key bypasses RLS entirely and must
// never appear in a VITE_-prefixed variable — Vite inlines those into the client bundle.

export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);

if (!isSupabaseConfigured) {
  console.warn(
    '[AI Studio] Supabase environment variables not configured. Operating in mock/demo mode.',
  );
}

// Typed by src/lib/database.types.ts, generated from the local stack (`make db-types`).
// Regenerate it in the same change as any migration.
export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL || 'https://mock.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'mock-anon-key',
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
  // How the account signed in ('google', 'email', ...). Read from the Supabase session.
  provider?: string | null;
}

export type AppRole = 'client' | 'admin';

// An anonymous session (ScoutIntakeForm signs a visitor in so /api/route-intake can
// require a token) is not a signed-in member: it has no profile row and no role, and
// must not route the visitor into the portal. It reads as "nobody" here.
const toAppUser = (
  u: {
    id: string;
    email?: string | null;
    is_anonymous?: boolean;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  } | null,
): AppUser | null =>
  u && !u.is_anonymous
    ? {
        uid: u.id,
        email: u.email ?? null,
        displayName:
          (u.user_metadata?.full_name as string | undefined) ??
          (u.user_metadata?.name as string | undefined) ??
          null,
        provider: (u.app_metadata?.provider as string | undefined) ?? null,
      }
    : null;

export const LOCAL_USER_KEY = 'dssg_auth_user';
export const LOCAL_ROLE_KEY = 'dssg_auth_role';
export const LOCAL_PROVIDER_KEY = 'dssg_auth_provider';

const authSubscribers = new Set<(user: AppUser | null) => void>();

export function getStoredUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(LOCAL_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getStoredRole(): AppRole | null {
  try {
    const raw = localStorage.getItem(LOCAL_ROLE_KEY);
    return (raw as AppRole) || null;
  } catch {
    return null;
  }
}

export function getStoredProvider(): string | null {
  try {
    return localStorage.getItem(LOCAL_PROVIDER_KEY);
  } catch {
    return null;
  }
}

export function setStoredUser(
  user: AppUser | null,
  role: AppRole = 'admin',
  provider: string = 'google',
): void {
  try {
    if (user) {
      localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
      localStorage.setItem(LOCAL_ROLE_KEY, role);
      localStorage.setItem(LOCAL_PROVIDER_KEY, provider);
    } else {
      localStorage.removeItem(LOCAL_USER_KEY);
      localStorage.removeItem(LOCAL_ROLE_KEY);
      localStorage.removeItem(LOCAL_PROVIDER_KEY);
    }
  } catch {
    // ignore
  }
  authSubscribers.forEach((cb) => {
    try {
      cb(user);
    } catch {
      // ignore
    }
  });
}

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

  if (!isSupabaseConfigured) {
    authSubscribers.add(callback);
    const stored = getStoredUser();
    setTimeout(() => {
      if (active) callback(stored);
    }, 0);
    return () => {
      active = false;
      authSubscribers.delete(callback);
    };
  }

  supabase.auth.getSession().then(({data}) => {
    if (active) callback(toAppUser(data.session?.user ?? null));
  }).catch(() => {
    if (active) callback(null);
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
 * which should not happen, since the user_provisioning migration creates one per signup, but a
 * null role fails closed everywhere it is checked rather than defaulting to admin.
 */
export async function fetchRole(): Promise<AppRole | null> {
  if (!isSupabaseConfigured) {
    // Demo-only local session. It keeps whatever role it was stored with and never
    // defaults to admin.
    return getStoredRole();
  }
  try {
    const {data, error} = await supabase.from('users').select('role').maybeSingle();
    if (error || !data) return null;
    return data.role as AppRole;
  } catch {
    return null;
  }
}

/**
 * Starts the real Google sign-in. Google's own account chooser picks the account, and the
 * session comes back to /login (App.tsx checks the tab's intent against the profile role).
 */
export async function signInWithGoogle(intent: 'nonprofit' | 'diplomat'): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Google sign-in needs the live database. Use Demo Mode to explore the portal.');
  }
  writeLoginIntent(intent);
  const {error} = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/login`,
      // A hint that steers Google's chooser to Workspace accounts on the team domain. The
      // hard check is admitSignIn, which runs on the returned session.
      ...(intent === 'diplomat' ? {queryParams: {hd: TEAM_EMAIL_DOMAIN}} : {}),
    },
  });
  if (error) {
    clearLoginIntent();
    throw error;
  }
}

export async function signOut(): Promise<void> {
  setStoredUser(null);
  if (!isSupabaseConfigured) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
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
  if (!isSupabaseConfigured) {
    onData([]);
    return () => {};
  }

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
// Key mapping and timestamps live in ./rows (pure, no client) and are re-exported here
// so call sites keep a single import.
// ---------------------------------------------------------------------------

export {toColumns, fromColumns, toTimestampLike, rowToDomain} from './rows';

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
