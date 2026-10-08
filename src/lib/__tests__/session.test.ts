import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessToken } from '../session';
import type { SessionAuth } from '../session';

afterEach(() => vi.restoreAllMocks());

const auth = (over: Partial<SessionAuth> = {}): SessionAuth & { signIns: number } => {
  const a = {
    signIns: 0,
    getSession: async () => ({ data: { session: null } }),
    signInAnonymously: async () => {
      a.signIns += 1;
      return { data: { session: { access_token: 'anon-token' } }, error: null };
    },
    ...over,
  };
  return a;
};

describe('accessToken', () => {
  it('returns the existing session token without signing in', async () => {
    const a = auth({ getSession: async () => ({ data: { session: { access_token: 'member-token' } } }) });
    await expect(accessToken(a, { anonymous: true })).resolves.toBe('member-token');
    expect(a.signIns).toBe(0);
  });

  it('is null with no session unless anonymous sign-in is asked for', async () => {
    const a = auth();
    await expect(accessToken(a)).resolves.toBeNull();
    expect(a.signIns).toBe(0);
    await expect(accessToken(a, { anonymous: true })).resolves.toBe('anon-token');
    expect(a.signIns).toBe(1);
  });

  // No token is the fallback cue, never a thrown error: the form must still save the intake.
  it('is null when anonymous sign-in is refused or throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = auth({
      signInAnonymously: async () => ({ data: { session: null }, error: { message: 'Anonymous sign-ins are disabled' } }),
    });
    await expect(accessToken(refused, { anonymous: true })).resolves.toBeNull();

    const broken = auth({ getSession: async () => { throw new TypeError('network'); } });
    await expect(accessToken(broken, { anonymous: true })).resolves.toBeNull();
  });
});
