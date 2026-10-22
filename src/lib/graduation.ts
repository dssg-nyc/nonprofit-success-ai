import { ArchitectAssessment, Business, Engagement } from '../types';

/**
 * Bridges the Scout/Architect pipeline to the client-facing Business/Engagement
 * model. The business id is the assessment id, so "has this graduated?" is an
 * existence check. Live assessment ids are the scout-intake uuid, which is a
 * valid `businesses.id`. Demo ids never reach Postgres.
 */

export function businessIdForAssessment(assessmentId: string): string {
  return assessmentId;
}

export function buildGraduatedBusiness(
  assessment: Pick<ArchitectAssessment, 'id' | 'org_name'>,
  ownerId: string
): Business {
  return {
    id: businessIdForAssessment(assessment.id),
    name: assessment.org_name,
    type: 'nonprofit',
    ownerId,
    certified: false,
    createdAt: { seconds: Date.now() / 1000 },
  };
}

export function buildGraduationEngagement(businessId: string, ownerId: string): Engagement {
  return {
    id: `${businessId}_scoping`,
    businessId,
    ownerId,
    stage: 'scoping',
    status: 'completed',
    stageLogs: [{
      text: 'Graduated from Architect assessment — charter and 90-day plan generated.',
      timestamp: { seconds: Date.now() / 1000 },
    }],
    updatedAt: { seconds: Date.now() / 1000 },
  };
}
