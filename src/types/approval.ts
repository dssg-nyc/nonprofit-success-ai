import type { AgentName } from '../model/types';

export type HitlTier = 'L1' | 'L2' | 'L3' | 'L4';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
/** `charter` is an Architect draft (charter + 90-day plan) awaiting staff approval (0004_drafts). */
export type ApprovalEntityType = 'intake' | 'assessment' | 'charter' | 'communication' | 'story';

export interface Approval {
  id: string;
  organizationId?: string;
  agent: AgentName;
  agentRunId?: string;
  entityType: ApprovalEntityType;
  entityId: string;
  hitlTier: HitlTier;
  status: ApprovalStatus;
  reviewerId?: string;
  reviewedAt?: { seconds: number };
  notes?: string;
  createdAt: { seconds: number };
}
