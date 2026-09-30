export type EnvoyOccasion =
  | 'kickoff'
  | 'check_in'
  | 'milestone_reached'
  | 'at_risk_follow_up'
  | 'wrap_up';

export interface EnvoyInput {
  engagementId: string;
  occasion: EnvoyOccasion;
  /** Partner organisation name, used in the salutation. */
  orgName: string;
  /** Charter title, when the engagement has a linked assessment. */
  planTitle?: string;
  /** `ArchitectCharter.cadence` — shapes how the draft frames next contact. */
  cadence?: string;
  /**
   * For `at_risk_follow_up`, the Pulse reasons behind the signal. Envoy quotes staff-facing
   * context back into a partner-facing draft, so the caller passes only what it is willing
   * to have paraphrased to the partner.
   */
  concerns?: string[];
}

export interface EnvoyDraft {
  engagementId: string;
  occasion: EnvoyOccasion;
  subject: string;
  body: string;
  /**
   * Constant by construction: every Envoy output is partner-facing, so it is always
   * drafted for a human to approve and never sent unattended. Kept explicit so a future
   * version that earns an L2 case has somewhere to put it.
   */
  hitlTier: 'L3';
}
