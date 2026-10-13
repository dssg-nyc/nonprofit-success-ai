// Row mapping between Postgres columns and the TS domain types. Pure functions, no client,
// no env: `supabase.ts` re-exports them so components keep one import, and unit tests
// (src/lib/__tests__/scoutIntake.test.ts) can import them without the browser client's
// fail-fast VITE_SUPABASE_* check firing in an environment that has no stack.

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

/**
 * camelCase → snake_case, for values on their way into the database.
 *
 * Pass the table's write shape so the typed client checks it:
 * `toColumns<TablesInsert<'businesses'>>({...})`. The key mapping is a runtime transform
 * TypeScript cannot follow, so the caller names the shape; there is no unchecked default.
 */
export const toColumns = <T,>(value: unknown): T =>
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
