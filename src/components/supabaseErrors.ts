import { handleSupabaseError } from '../lib/supabase';
import type { OperationType } from '../lib/supabase';

/**
 * Log a Supabase failure in handleSupabaseError's structured format, without its throw.
 *
 * handleSupabaseError() logs and then always throws, which suits code that wants to
 * abort. A component handler has nowhere to throw to, and the old pattern was a bare
 * `catch { }` per call site. This is the one place that throw is absorbed, and it returns
 * the message the caller must show (via ErrorBanner) — so the failure is visible on
 * screen, not just in the console.
 */
export function reportSupabaseError(
  error: unknown,
  operation: OperationType,
  path: string,
  userMessage: string,
): string {
  try {
    handleSupabaseError(error, operation, path);
  } catch {
    // Expected: handleSupabaseError always throws after logging. The log is what we want.
  }
  return userMessage;
}
