import { describe, expect, it } from 'vitest';
import { buildClientJourney, membershipOfferDue, nextClientStep, type ClientJourneyContext } from './clientJourney.js';

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
  it('starts a brand-new client at account creation, with the offer last and upcoming', () => {
    const steps = buildClientJourney(base);
    expect(steps[0]).toMatchObject({ id: 'account_created', status: 'current' });
    expect(steps[steps.length - 1]).toMatchObject({ id: 'membership_offer', status: 'upcoming' });
    expect(nextClientStep(steps)?.id).toBe('account_created');
    expect(membershipOfferDue(steps)).toBe(false);
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

  it('presents the membership offer only when hackathon_ready completes', () => {
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
    expect(statusOf(ctx, 'hackathon_ready')).toBe('completed');
    expect(statusOf(ctx, 'membership_offer')).toBe('current');
    expect(membershipOfferDue(buildClientJourney(ctx))).toBe(true);
  });

  it('completes the journey when a membership stage row exists', () => {
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
        { stage: 'membership', status: 'in_progress' },
      ],
    };
    expect(statusOf(ctx, 'membership_offer')).toBe('completed');
    expect(nextClientStep(buildClientJourney(ctx))).toBeNull();
  });
});
