/** Timestamp shape used by demo-mode mock data (reads only touch `.seconds`). */
export interface TimestampLike {
  seconds: number;
  nanoseconds?: number;
}

/**
 * A timestamp field: either a resolved `TimestampLike` (demo-mode mock) or the
 * sentinel returned by `serverTimestamp()` at write time, which carries no
 * readable value. Reads must go through `.seconds` and tolerate it being absent.
 */
export type WriteTimestamp = TimestampLike | { seconds?: undefined };

export type BusinessType = 'small_business' | 'nonprofit';

export interface Business {
  id: string;
  name: string;
  type: BusinessType;
  ein?: string;
  industry?: string;
  ownerId: string;
  certified: boolean;
  address?: string;
  createdAt: WriteTimestamp;
}

export type EngagementStage = 'initial_meeting' | 'budget_check' | 'data_ethics_committee' | 'scoping' | 'hackathon_ready' | 'membership';
export type EngagementStatus = 'pending' | 'in_progress' | 'completed';

export interface Engagement {
  id: string;
  businessId: string;
  ownerId: string;
  organizationId?: string;
  assessmentId?: string;
  stage: EngagementStage;
  status: EngagementStatus;
  notes?: string;
  budget_amount?: number;
  hackathon_project?: string;
  updatedAt: WriteTimestamp;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  role: 'client' | 'admin';
  createdAt: WriteTimestamp;
}
