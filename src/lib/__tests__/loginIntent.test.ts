import { describe, expect, it } from 'vitest';
import { admitSignIn } from '../loginIntent';

const TEAM = 'jyr@datadiplomats.org';

describe('admitSignIn: Data Diplomats door', () => {
  it('admits a team admin on the team domain', () => {
    expect(admitSignIn('diplomat', 'admin', TEAM)).toEqual({ allowed: true });
  });

  it('matches the domain regardless of case and spaces', () => {
    expect(admitSignIn('diplomat', 'admin', ' JYR@DataDiplomats.ORG ')).toEqual({ allowed: true });
  });

  it('turns away a non-team email even when the role is admin', () => {
    const verdict = admitSignIn('diplomat', 'admin', 'someone@gmail.com');
    expect(verdict.allowed).toBe(false);
    expect(verdict.notice).toMatch(/@datadiplomats\.org/);
  });

  it('turns away a lookalike domain', () => {
    expect(admitSignIn('diplomat', 'admin', 'x@datadiplomats.org.evil.com').allowed).toBe(false);
    expect(admitSignIn('diplomat', 'admin', 'x@evildatadiplomats.org').allowed).toBe(false);
  });

  it('turns away a missing email', () => {
    expect(admitSignIn('diplomat', 'admin', null).allowed).toBe(false);
  });

  it('turns away a team-domain account that is not an admin', () => {
    const verdict = admitSignIn('diplomat', 'client', TEAM);
    expect(verdict.allowed).toBe(false);
    expect(verdict.notice).toMatch(/not a Data Diplomats team account/);
  });
});

describe('admitSignIn: nonprofit door and no intent', () => {
  it('admits a nonprofit sign-in with any role and email', () => {
    expect(admitSignIn('nonprofit', 'client', 'ed@charity.org')).toEqual({ allowed: true });
    expect(admitSignIn('nonprofit', null, null)).toEqual({ allowed: true });
  });

  it('admits a session with no tab intent (returning user, demo, password login)', () => {
    expect(admitSignIn(null, 'client', 'ed@charity.org')).toEqual({ allowed: true });
    expect(admitSignIn(null, null, null)).toEqual({ allowed: true });
  });
});
