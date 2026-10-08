import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import type { Database } from '../database.types';
import { fetchPromotedLessons, promoteLesson } from '../lessons';

const LESSON_ID = 'aaaaaaaa-0000-0000-0000-000000000004';
const APPROVAL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

/** A hand-rolled client: records the calls and answers with canned results. */
function stub(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {
    select: (cols: string) => (calls.push(['select', cols]), builder),
    eq: (col: string, v: unknown) => (calls.push(['eq', col, v]), builder),
    order: (col: string, opts: unknown) => (calls.push(['order', col, opts]), builder),
    limit: (n: number) => (calls.push(['limit', n]), Promise.resolve(result)),
  };
  const client = {
    from: (table: string) => (calls.push(['from', table]), builder),
    rpc: async (fn: string, args: unknown) => (calls.push(['rpc', fn, args]), result),
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe('fetchPromotedLessons', () => {
  it('reads promoted_lessons for the bucket, newest promotion first, default limit 5', async () => {
    const rows = [{ id: LESSON_ID }];
    const { client, calls } = stub({ data: rows, error: null });

    const res = await fetchPromotedLessons(client, { bucket: 'Data Foundations' });

    expect(res).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      ['from', 'promoted_lessons'],
      ['select', '*'],
      ['eq', 'predicted_bucket', 'Data Foundations'],
      ['order', 'promoted_at', { ascending: false }],
      ['limit', 5],
    ]);
  });

  it('honours an explicit limit', async () => {
    const { client, calls } = stub({ data: [], error: null });
    await fetchPromotedLessons(client, { bucket: 'b', limit: 2 });
    expect(calls).toContainEqual(['limit', 2]);
  });

  it('passes an error through without throwing', async () => {
    const error = { message: 'permission denied', code: '42501' };
    const { client } = stub({ data: null, error });
    expect(await fetchPromotedLessons(client, { bucket: 'b' })).toEqual({ data: null, error });
  });
});

describe('promoteLesson', () => {
  const OK = { lesson_id: LESSON_ID, approval_id: APPROVAL_ID, promoted_at: '2026-10-07T12:00:00Z' };

  it('calls promote_lesson with the id and notes, and returns the parsed result', async () => {
    const { client, calls } = stub({ data: OK, error: null });
    expect(await promoteLesson(client, LESSON_ID, 'held up')).toEqual({ data: OK, error: null });
    expect(calls).toEqual([['rpc', 'promote_lesson', { p_lesson_id: LESSON_ID, p_notes: 'held up' }]]);
  });

  it('omits p_notes when none is given', async () => {
    const { client, calls } = stub({ data: OK, error: null });
    await promoteLesson(client, LESSON_ID);
    expect(calls).toEqual([['rpc', 'promote_lesson', { p_lesson_id: LESSON_ID }]]);
  });

  it('passes an RPC error through', async () => {
    const error = { message: 'not an admin', code: '42501' };
    const { client } = stub({ data: null, error });
    expect(await promoteLesson(client, LESSON_ID)).toEqual({ data: null, error });
  });

  it('reports a malformed result as an error rather than trusting it', async () => {
    const { client } = stub({ data: { lesson_id: 'nope' }, error: null });
    const res = await promoteLesson(client, LESSON_ID);
    expect(res.data).toBeNull();
    expect(res.error?.message).toMatch(/unexpected result/);
  });
});
