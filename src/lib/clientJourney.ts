import type { EngagementStage, EngagementStatus } from '../types/index.js';
import { deriveCurrentStage } from './lifecycle.js';

/**
 * The nonprofit CLIENT journey — the map a pro bono client sees after signing in
 * through the "For Nonprofits" door (docs/client-success-journey.md).
 *
 * This is deliberately NOT the volunteer journey. Data Diplomats (volunteers /
 * team) sign in through the separate "For Data Diplomats" door in
 * `loginIntent.ts` — a @datadiplomats.org Google account with an `admin`
 * profile — and their project-management tools are a separate product surface
 * that is out of scope here. A client must never land in the volunteer tools,
 * and a volunteer never advances a client's steps.
 *
 * Shape: three onboarding steps that happen before an Engagement exists, the
 * five Engagement stages from `lifecycle.ts` that make up the pro bono
 * journey proper. The journey ENDS at hackathon_ready: the lifecycle's
 * `membership` stage is staff-side bookkeeping after the journey and is
 * deliberately not a client step (removed 2026-11-24 at the client's
 * direction — there is no membership-offer step in this portal).
 *
 * Pure: types-only imports plus the pure lifecycle derivation. No React,
 * no Supabase, no agent code, matching the `lib/` convention in lifecycle.ts.
 */

export type ClientJourneyStepId =
  | 'account_created'
  | 'nonprofit_validated'
  | 'application_approved'
  | EngagementStage;

export type ClientJourneyStepStatus = 'completed' | 'current' | 'upcoming';

export interface ClientJourneyStep {
  id: ClientJourneyStepId;
  /** Short label for the timeline. */
  title: string;
  /** One line: what this step is, in the client's words. */
  summary: string;
  /** What the client has to do at this step. */
  clientAction: string;
  /** What DSSG NYC does at this step. */
  dssgAction: string;
  /** The step is done when this is true. */
  exitCriteria: string;
  /** Where the client acts, when the step has a screen today. */
  href?: string;
  /** The engagement stage this step mirrors, for the six lifecycle steps. */
  engagementStage?: EngagementStage;
}

export interface ClientJourneyStepState extends ClientJourneyStep {
  status: ClientJourneyStepStatus;
}

/** The facts the journey derivation needs. All are already stored today. */
export interface ClientJourneyContext {
  /** A signed-in session exists (Supabase Auth: Google or email + password). */
  hasAccount: boolean;
  /** The nonprofit passed validation (Business.certified — the ProPublica / IRS check in the onboarding gate). */
  nonprofitValidated: boolean;
  /**
   * DSSG approved the application and an engagement exists for the client.
   * Until the approved-intake → Business/Engagement conversion lands, staff
   * create the first engagement; this flag is `engagements.length > 0`.
   */
  applicationApproved: boolean;
  /** The client's engagement stage rows, one per stage, as in lifecycle.ts. */
  engagements: readonly { stage: EngagementStage; status: EngagementStatus }[];
  /**
   * Whether the client's record is linked to Salesforce
   * (Business.salesforceAccountId). Display-only: the journey runs on
   * Supabase either way — see docs/client-success-journey.md §4.
   */
  salesforceLinked: boolean;
}

const ONBOARDING_STEPS: readonly ClientJourneyStep[] = [
  {
    id: 'account_created',
    title: 'Create your account',
    summary: 'Sign up with Google, or with any email and a password. This portal is for nonprofit clients.',
    clientAction: 'Create your account on the "For Nonprofits" door and sign in.',
    dssgAction: 'We provision your client profile automatically — new accounts are always clients, never team.',
    exitCriteria: 'You can sign in and reach your dashboard.',
    href: '/login',
  },
  {
    id: 'nonprofit_validated',
    title: 'Validate your nonprofit',
    summary: 'We confirm your organization against the IRS registry so pro bono work goes to a real nonprofit.',
    clientAction: 'Enter your organization name and EIN in onboarding and complete the validation check.',
    dssgAction: 'We verify your 501(c)(3) status (ProPublica / IRS data) and record the result.',
    exitCriteria: 'Your organization shows as validated.',
    href: '/onboarding',
  },
  {
    id: 'application_approved',
    title: 'Application & review',
    summary: 'Tell us the problem you want help with; DSSG reviews every first-time application by hand.',
    clientAction: 'Complete the first-time applicant survey and answer any follow-up questions.',
    dssgAction: 'Scout triages the application and a DSSG reviewer approves, redirects, or declines it.',
    exitCriteria: 'Your application is approved and your engagement is opened at Initial Meeting.',
    href: '/apply',
  },
];

const ENGAGEMENT_STEP_COPY: Record<EngagementStage, Omit<ClientJourneyStep, 'id' | 'engagementStage'>> = {
  initial_meeting: {
    title: 'Initial Meeting',
    summary: 'A first working session with DSSG to understand your mission, your data, and the problem.',
    clientAction: 'Meet with us, share context and any existing data, and name your decision-maker.',
    dssgAction: 'We listen, take structured notes, and record the meeting outcome on your engagement.',
    exitCriteria: 'The meeting has happened and both sides agree the problem is worth scoping.',
  },
  budget_check: {
    title: 'Budget Check',
    summary: 'Pro bono does not mean cost-free to run — we confirm the engagement has what it needs.',
    clientAction: 'Confirm any budget, tools, data access, and staff time your organization can commit.',
    dssgAction: 'We record the budget picture on your engagement and flag gaps before work is promised.',
    exitCriteria: 'Budget and commitments are recorded and accepted by DSSG.',
  },
  data_ethics_committee: {
    title: 'Data Ethics Committee',
    summary: 'Your community’s data deserves care. The committee reviews privacy, consent, and risk.',
    clientAction: 'Describe what data exists, who it is about, and any consent or sensitivity constraints.',
    dssgAction: 'The committee reviews the proposed data use and approves it, with conditions, or stops it.',
    exitCriteria: 'The committee has approved the data use for this engagement.',
  },
  scoping: {
    title: 'Scoping',
    summary: 'We turn the problem into a concrete, buildable project with a charter and a 90-day plan.',
    clientAction: 'Review the assessment and the draft charter / 90-day plan and confirm priorities.',
    dssgAction: 'Our architects assess your current state and draft the charter and plan for your project.',
    exitCriteria: 'A charter and 90-day plan exist and you have confirmed the scope.',
  },
  hackathon_ready: {
    title: 'Hackathon Ready',
    summary: 'Your project is ready to be built — matched to a Data Diplomats team at a hackathon.',
    clientAction: 'Confirm your project summary and be available to the team during the build.',
    dssgAction: 'We finalize the project brief and match it to a volunteer team. (The team’s own tools are separate from this portal.)',
    exitCriteria: 'Your project is marked hackathon-ready. This completes the pro bono journey.',
  },
  membership: {
    title: 'Membership',
    summary: 'Staff-side stage after the pro bono journey. Not a client journey step.',
    clientAction: 'No client action — this stage is handled by DSSG staff.',
    dssgAction: 'DSSG staff manage membership after the journey ends at Hackathon Ready.',
    exitCriteria: 'Handled outside the client journey.',
  },
};

/** The full ordered map, before any client state is applied. */
export const CLIENT_JOURNEY_STEPS: readonly ClientJourneyStep[] = [
  ...ONBOARDING_STEPS,
  ...(['initial_meeting', 'budget_check', 'data_ethics_committee', 'scoping', 'hackathon_ready'] as const).map(
    (stage): ClientJourneyStep => ({ id: stage, engagementStage: stage, ...ENGAGEMENT_STEP_COPY[stage] }),
  ),
];

/**
 * Apply a client's facts to the map. Rules:
 * - Onboarding steps complete in order from the context flags.
 * - Engagement steps mirror their stage rows (completed / in_progress /
 *   pending-or-absent), via the same derivation as lifecycle.ts.
 * - Exactly one step is `current` (the first incomplete one), unless every
 *   step is completed.
 */
export function buildClientJourney(ctx: ClientJourneyContext): ClientJourneyStepState[] {
  const byStage = new Map(ctx.engagements.map((e) => [e.stage, e.status]));
  const currentStage = deriveCurrentStage(ctx.engagements)?.stage ?? null;

  const completed = (step: ClientJourneyStep): boolean => {
    switch (step.id) {
      case 'account_created':
        return ctx.hasAccount;
      case 'nonprofit_validated':
        return ctx.nonprofitValidated;
      case 'application_approved':
        return ctx.applicationApproved;
      default:
        return step.engagementStage ? byStage.get(step.engagementStage) === 'completed' : false;
    }
  };

  let currentAssigned = false;
  return CLIENT_JOURNEY_STEPS.map((step) => {
    if (completed(step)) return { ...step, status: 'completed' as const };
    // The engagement stage lifecycle says is in progress is current even if an
    // earlier display step is somehow incomplete — surface it as current too.
    if (step.engagementStage && step.engagementStage === currentStage && byStage.get(step.engagementStage) === 'in_progress') {
      currentAssigned = true;
      return { ...step, status: 'current' as const };
    }
    if (!currentAssigned) {
      currentAssigned = true;
      return { ...step, status: 'current' as const };
    }
    return { ...step, status: 'upcoming' as const };
  });
}

/** The one step the client should act on next, or null when the journey is done. */
export function nextClientStep(steps: readonly ClientJourneyStepState[]): ClientJourneyStepState | null {
  return steps.find((s) => s.status === 'current') ?? null;
}

