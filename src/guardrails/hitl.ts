import type { AgentName } from '../model/types';
import type { HitlTier } from '../types/approval';

export interface HitlSignals {
  confidence?: 'High' | 'Medium' | 'Low' | null;
  compositeSignal?: 'Ready' | 'Conditional' | 'Not Ready';
}

export function deriveHitlTier(agent: AgentName, signals?: HitlSignals): HitlTier {
  switch (agent) {
    case 'pulse':
      return 'L1';
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
