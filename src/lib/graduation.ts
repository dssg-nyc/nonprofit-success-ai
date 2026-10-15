import { ArchitectAssessment, Business, Engagement } from '../types';

/**
 * Bridges the Scout/Architect pipeline to the client-facing Business/Engagement
 * model. Deterministic id derivation (rather than a stored pointer) keeps
 * "has this assessment graduated to a Business?" a pure existence check —
 * safe to call idempotently from both the demo and real write paths.
 */

export function businessIdForAssessment(assessmentId: string): string {
  return `biz_${assessmentId}`;
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
