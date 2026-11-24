import { describe, expect, it } from 'vitest';
import { buildClientJourney, clientStepPagePath, nextClientStep, stepIdFromSlug, type ClientJourneyContext } from './clientJourney.js';

const base: ClientJourneyContext = {
  hasAccount: false,
  nonprofitValidated: false,
  applicationApproved: false,
  engagements: [],
  salesforceLinked: false,
};

const statusOf = (ctx: ClientJourneyContext, id: string) =>
  buildClientJourney(ctx).find((s) => s.id === id)?.status;

describe('buildClientJourney', () => {
  it('starts a brand-new client at account creation, with hackathon_ready last and upcoming', () => {
    const steps = buildClientJourney(base);
    expect(steps[0]).toMatchObject({ id: 'account_created', status: 'current' });
    expect(steps[steps.length - 1]).toMatchObject({ id: 'hackathon_ready', status: 'upcoming' });
    expect(nextClientStep(steps)?.id).toBe('account_created');
  });

  it('walks the onboarding steps in order', () => {
    const ctx = { ...base, hasAccount: true };
    expect(statusOf(ctx, 'account_created')).toBe('completed');
    expect(statusOf(ctx, 'nonprofit_validated')).toBe('current');
    expect(statusOf({ ...ctx, nonprofitValidated: true }, 'application_approved')).toBe('current');
  });

  it('mirrors engagement stages and makes the in-progress stage current', () => {
    const ctx: ClientJourneyContext = {
      ...base,
      hasAccount: true,
      nonprofitValidated: true,
      applicationApproved: true,
      engagements: [
        { stage: 'initial_meeting', status: 'completed' },
        { stage: 'budget_check', status: 'in_progress' },
      ],
    };
    expect(statusOf(ctx, 'initial_meeting')).toBe('completed');
    expect(statusOf(ctx, 'budget_check')).toBe('current');
    expect(statusOf(ctx, 'scoping')).toBe('upcoming');
  });

  it('ends at hackathon_ready: completing it completes the journey', () => {
    const ctx: ClientJourneyContext = {
      ...base,
      hasAccount: true,
      nonprofitValidated: true,
      applicationApproved: true,
      engagements: [
        { stage: 'initial_meeting', status: 'completed' },
        { stage: 'budget_check', status: 'completed' },
        { stage: 'data_ethics_committee', status: 'completed' },
        { stage: 'scoping', status: 'completed' },
        { stage: 'hackathon_ready', status: 'completed' },
      ],
    };
    const steps = buildClientJourney(ctx);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
    expect(nextClientStep(steps)).toBeNull();
    expect(steps.some((s) => (s.id as string) === 'membership_offer')).toBe(false);
  });

  it('has no membership step at all, even if a membership stage row exists', () => {
    const ctx: ClientJourneyContext = {
      ...base,
      hasAccount: true,
      nonprofitValidated: true,
      applicationApproved: true,
      engagements: [{ stage: 'membership', status: 'in_progress' }],
    };
    const steps = buildClientJourney(ctx);
    expect(steps.map((s) => s.id)).not.toContain('membership');
    expect(steps.map((s) => s.id)).not.toContain('membership_offer' as never);
    expect(steps[steps.length - 1].id).toBe('hackathon_ready');
  });
});

describe('step pages', () => {
  it('reuses the pre-existing pages for the onboarding steps', () => {
    const steps = buildClientJourney(base);
    const pathOf = (id: string) => clientStepPagePath(steps.find((s) => s.id === id)!);
    expect(pathOf('account_created')).toBe('/login');
    expect(pathOf('nonprofit_validated')).toBe('/onboarding');
    expect(pathOf('application_approved')).toBe('/apply');
  });

  it('gives every engagement step its own /journey page', () => {
    const steps = buildClientJourney(base);
    const pathOf = (id: string) => clientStepPagePath(steps.find((s) => s.id === id)!);
    expect(pathOf('initial_meeting')).toBe('/journey/initial-meeting');
    expect(pathOf('budget_check')).toBe('/journey/budget-check');
    expect(pathOf('data_ethics_committee')).toBe('/journey/data-ethics-committee');
    expect(pathOf('scoping')).toBe('/journey/scoping');
    expect(pathOf('hackathon_ready')).toBe('/journey/hackathon-ready');
  });

  it('resolves step-page slugs back to engagement steps only', () => {
    expect(stepIdFromSlug('budget-check')).toBe('budget_check');
    expect(stepIdFromSlug('hackathon-ready')).toBe('hackathon_ready');
    expect(stepIdFromSlug('account-created')).toBeNull();
    expect(stepIdFromSlug('nonprofit-validated')).toBeNull();
    expect(stepIdFromSlug('nope')).toBeNull();
  });
});
