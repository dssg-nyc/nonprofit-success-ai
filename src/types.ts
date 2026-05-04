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
  createdAt: any;
}

export type EngagementStage = 'initial_meeting' | 'budgeting' | 'engagement_tracking' | 'hackathon' | 'membership_close';
export type EngagementStatus = 'pending' | 'in_progress' | 'completed';

export interface Engagement {
  id: string;
  businessId: string;
  ownerId: string;
  stage: EngagementStage;
  status: EngagementStatus;
  notes?: string;
  budget_amount?: number;
  hackathon_project?: string;
  updatedAt: any;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  role: 'client' | 'admin';
  createdAt: any;
}
