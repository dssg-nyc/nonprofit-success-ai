import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from './database.types';

/**
 * Chronicle lessons, as the SPA reads and promotes them (chronicle.md §6, D15/D21).
 *
 * The client is passed in, not imported: `supabase.ts` throws at import without its env,
 * and this module is shared-zone code with no agent imports. Both calls run with the
 * user's JWT, so RLS decides what comes back — `promoted_lessons` is the only lessons
 * surface Scout-side code reads, and a partner sees nothing from it.
 */

type LessonsClient = SupabaseClient<Database>;

export type PromotedLesson = Database['public']['Views']['promoted_lessons']['Row'];

/**
 * D15 delivery = query at review time: the lessons promoted for an intake's bucket, newest
 * promotion first. Returns the supabase `{ data, error }` shape; never throws.
 */
export function fetchPromotedLessons(
  client: LessonsClient,
  { bucket, limit = 5 }: { bucket: string; limit?: number },
) {
  return client
    .from('promoted_lessons')
    .select('*')
    .eq('predicted_bucket', bucket)
    .order('promoted_at', { ascending: false })
    .limit(limit);
}

export const promoteLessonResultSchema = z.object({
  lesson_id: z.guid(),
  approval_id: z.guid(),
  promoted_at: z.string(),
});

export type PromoteLessonResult = z.infer<typeof promoteLessonResultSchema>;

export type PromoteLessonOutcome =
  | { data: PromoteLessonResult; error: null }
  | { data: null; error: { message: string; code?: string } };

/**
 * Promote a lesson candidate through `promote_lesson()` (0004_drafts) — the only way it becomes
 * visible to Scout. Idempotent server-side. An RPC error passes through unchanged; a
 * result of the wrong shape is reported as an error rather than trusted.
 */
export async function promoteLesson(
  client: LessonsClient,
  lessonId: string,
  notes?: string,
): Promise<PromoteLessonOutcome> {
  const { data, error } = await client.rpc('promote_lesson', {
    p_lesson_id: lessonId,
    ...(notes !== undefined ? { p_notes: notes } : {}),
  });
  if (error) return { data: null, error };
  const parsed = promoteLessonResultSchema.safeParse(data);
  if (!parsed.success) {
    return { data: null, error: { message: 'promote_lesson returned an unexpected result' } };
  }
  return { data: parsed.data, error: null };
}
