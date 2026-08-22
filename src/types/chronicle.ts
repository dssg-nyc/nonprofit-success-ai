export type ChronicleReadiness = 'ready' | 'thin' | 'not_ready';

export interface ChronicleInput {
  engagementId: string;
  orgName: string;
  /** Only a completed engagement can be chronicled. */
  status: string;
  /** Whether the engagement links to an Architect assessment. */
  hasPlan: boolean;
  /** How many events were recorded over the engagement's life. */
  eventCount: number;
  /** `ArchitectCharter.objectives`, when a plan exists. */
  objectives?: string[];
  /** `ArchitectCharter.successCriteria`, when a plan exists. */
  successCriteria?: string[];
}

export interface ChronicleDraft {
  engagementId: string;
  /** Derived by `assessChronicleReadiness()`, never model-supplied. */
  readiness: ChronicleReadiness;
  headline: string;
  narrative: string;
  outcomes: string[];
  /** Constant by construction: impact stories are public-facing and always human-approved. */
  hitlTier: 'L3';
}
