import type { AgentName } from '../model/types.js';
import type { HitlTier } from '../types/approval.js';

export interface HitlSignals {
  confidence?: 'High' | 'Medium' | 'Low' | null;
  compositeSignal?: 'Ready' | 'Conditional' | 'Not Ready';
}

/**
 * The one HITL switch over the whole roster (CLAUDE.md: a model cannot grant itself a
 * tier by living in its own file). Scout's deterministic router, `/api/route-intake`,
 * and the gateway's recorded tier all come through here.
 *
 * The overloads narrow the return type to what each agent can actually be assigned, so
 * a caller recording or returning a tier does not have to cast.
 */
export function deriveHitlTier(agent: 'scout', signals: HitlSignals): 'L2' | 'L3';
export function deriveHitlTier(agent: 'pulse'): 'L2';
export function deriveHitlTier(agent: 'architect' | 'envoy' | 'chronicle'): 'L3';
export function deriveHitlTier(agent: AgentName, signals?: HitlSignals): HitlTier;
export function deriveHitlTier(agent: AgentName, signals?: HitlSignals): HitlTier {
  switch (agent) {
    case 'pulse':
      // pulse.md §5: "L2, always". A read-only health signal that staff see and that
      // feeds Envoy's at-risk follow-up — reviewable, never acted on unseen. Decided
      // 2026-10-07 (was L1 here while the spec and PulseSignal.hitlTier said L2).
      return 'L2';
    case 'scout':
      if (signals?.confidence === 'High' && signals?.compositeSignal === 'Ready') {
        return 'L2';
      }
      return 'L3';
    case 'architect':
    case 'envoy':
    case 'chronicle':
      return 'L3';
  }
}
