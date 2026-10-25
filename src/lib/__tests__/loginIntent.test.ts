import { describe, expect, it } from 'vitest';
import { admitSignIn } from '../loginIntent';

describe('admitSignIn', () => {
  it('admits a team admin through the Data Diplomats door', () => {
    expect(admitSignIn('diplomat', 'admin')).toEqual({ allowed: true });
  });

  it('turns away a non-team account through the Data Diplomats door', () => {
    const verdict = admitSignIn('diplomat', 'client');
    expect(verdict.allowed).toBe(false);
    expect(verdict.notice).toMatch(/not a Data Diplomats team account/);
  });

  it('turns away a profile with no role through the Data Diplomats door', () => {
    expect(admitSignIn('diplomat', null).allowed).toBe(false);
  });

  it('admits a nonprofit sign-in with any role', () => {
    expect(admitSignIn('nonprofit', 'client')).toEqual({ allowed: true });
    expect(admitSignIn('nonprofit', 'admin')).toEqual({ allowed: true });
    expect(admitSignIn('nonprofit', null)).toEqual({ allowed: true });
  });

  it('admits a session with no tab intent (returning user, demo, password login)', () => {
    expect(admitSignIn(null, 'client')).toEqual({ allowed: true });
    expect(admitSignIn(null, null)).toEqual({ allowed: true });
  });
});
