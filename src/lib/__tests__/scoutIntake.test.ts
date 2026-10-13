import { describe, expect, it } from 'vitest';
import { scoutIntakeFromRow } from '../scoutIntake';
import { rowToDomain } from '../rows';

// A scout_intakes row as PostgREST returns it (snake_case, ISO timestamps, nulls).
const ROW = {
  id: '0d73afe2-648b-54bc-8111-033b3e08bb8c',
  org_name: 'Harlem Community Pantry',
  contact_name_role: 'Dana Reyes, Executive Director',
  contact_email: 'dana@harlempantry.org',
  mission: 'Food pantry.',
  scale: '400 families a week',
  primary_need: 'analyze_data',
  primary_need_other: null,
  problem_description: 'Cannot report outcomes.',
  current_systems: 'Google Sheets',
  timeline: 'Before March',
  referral_source: 'Volunteer',
  submitted_at: '2026-10-11T12:00:00.000Z',
  bucket: 'Analytics & Insight',
  confidence: 'High',
  rationale: 'Clear need.',
  poc_score: 3,
  clarity_score: 3,
  foothold_score: 2,
  composite_signal: 'Ready',
  flags: ['one flag'],
  hitl_tier: 'L2',
  review_status: 'pending',
  review_action: null,
  final_bucket: null,
  reviewed_by: null,
  reviewed_by_email: null,
  reviewed_at: null,
  review_notes: null,
  onboarding_kit: null,
  organization_id: null,
  routing_source: 'derived',
  routing_model: null,
  routing_prompt_version: null,
  routing_run_id: null,
};

describe('scoutIntakeFromRow', () => {
  const intake = scoutIntakeFromRow(rowToDomain(ROW, ['submittedAt', 'reviewedAt']));

  it('keeps the applicant answers and scores in the snake_case the form and scorer use', () => {
    expect(intake.org_name).toBe('Harlem Community Pantry');
    expect(intake.contact_name_role).toBe('Dana Reyes, Executive Director');
    expect(intake.contact_email).toBe('dana@harlempantry.org');
    expect(intake.primary_need).toBe('analyze_data');
    expect(intake.problem_description).toBe('Cannot report outcomes.');
    expect(intake.current_systems).toBe('Google Sheets');
    expect(intake.referral_source).toBe('Volunteer');
    expect(intake.poc_score).toBe(3);
    expect(intake.clarity_score).toBe(3);
    expect(intake.foothold_score).toBe(2);
    expect(intake.composite_signal).toBe('Ready');
  });

  it('leaves the review and routing fields camelCase, with timestamps converted', () => {
    expect(intake.hitlTier).toBe('L2');
    expect(intake.reviewStatus).toBe('pending');
    expect(intake.submittedAt?.seconds).toBe(Date.parse(ROW.submitted_at) / 1000);
    expect(intake.flags).toEqual(['one flag']);
    expect(intake.bucket).toBe('Analytics & Insight');
  });

  it('turns a null optional answer into undefined, and leaves no camelCase twin behind', () => {
    expect(intake.primary_need_other).toBeUndefined();
    expect(intake).not.toHaveProperty('orgName');
    expect(intake).not.toHaveProperty('compositeSignal');
    expect(intake).not.toHaveProperty('pocScore');
  });

  it('carries a filled optional answer through', () => {
    const other = scoutIntakeFromRow(
      rowToDomain({ ...ROW, primary_need: 'something_else', primary_need_other: 'A grant audit' }, []),
    );
    expect(other.primary_need_other).toBe('A grant audit');
  });
});
