import { ArchitectAssessment, ScoutIntake } from '../types';

/**
 * In-memory persistence for Demo Mode, which never touches Firestore.
 * Module-level so demo data survives client-side navigation between the
 * review queue, the CSA form, and the plan view. Lost on full page reload —
 * acceptable for a demo walkthrough.
 */
export const demoAssessments = new Map<string, ArchitectAssessment>();

/**
 * Demo-mode scout intakes reviewed during this session, keyed by intake id.
 * ScoutReviewQueue writes here on approve/edit/redirect so the Architect
 * pages can read the handoff after navigation.
 */
export const demoReviewedIntakes = new Map<string, ScoutIntake>();
