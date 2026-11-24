import { useEffect, useState } from 'react';
import { supabase, rowToDomain } from '../../lib/supabase';
import type { Business, Engagement } from '../../types';
import { demoBusinesses, demoEngagements } from '../../lib/demoStore';
import '../demo/demoData';
import { buildClientJourney, type ClientJourneyContext, type ClientJourneyStepState } from '../../lib/clientJourney';

export interface ClientJourneyData {
  business: Business | null;
  engagements: Engagement[];
  steps: ClientJourneyStepState[];
  salesforceLinked: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * The client's journey facts, shared by the /journey overview and the
 * per-step pages (/journey/:stepSlug) so both read the same source:
 * Demo Mode uses the shared demo store; live mode reads the client's own
 * businesses + engagements from Supabase (RLS scopes them to the caller).
 */
export function useClientJourney(isDemo?: boolean): ClientJourneyData {
  const [business, setBusiness] = useState<Business | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) {
      const first = [...demoBusinesses.values()][0] ?? null;
      setBusiness(first);
      setEngagements(first ? (demoEngagements.get(first.id) ?? []) : []);
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: bizRows, error: bizError } = await supabase.from('businesses').select('*').limit(1);
      if (cancelled) return;
      if (bizError) {
        setError('Could not load your organization. Reload to try again.');
        setLoading(false);
        return;
      }
      const biz = bizRows?.[0] ? rowToDomain<Business>(bizRows[0], ['createdAt', 'updatedAt']) : null;
      setBusiness(biz);
      if (biz) {
        const { data: engRows } = await supabase.from('engagements').select('*').eq('business_id', biz.id);
        if (cancelled) return;
        setEngagements((engRows ?? []).map((r) => rowToDomain<Engagement>(r, ['createdAt', 'updatedAt'])));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  const ctx: ClientJourneyContext = {
    hasAccount: true, // these pages are behind login
    nonprofitValidated: business?.certified ?? false,
    applicationApproved: engagements.length > 0,
    engagements: engagements.map((e) => ({ stage: e.stage, status: e.status })),
    salesforceLinked: Boolean(business?.salesforceAccountId),
  };

  return {
    business,
    engagements,
    steps: buildClientJourney(ctx),
    salesforceLinked: ctx.salesforceLinked,
    loading,
    error,
  };
}
