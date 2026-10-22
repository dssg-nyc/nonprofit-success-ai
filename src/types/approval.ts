import type { AgentName } from '../model/types';

export type HitlTier = 'L1' | 'L2' | 'L3' | 'L4';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalEntityType = 'intake' | 'assessment' | 'communication' | 'story';

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
