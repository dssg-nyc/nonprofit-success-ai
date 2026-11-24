import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, GraduationCap } from 'lucide-react';
import { supabase, rowToDomain } from '../../lib/supabase';
import type { Business, Engagement } from '../../types';
import { demoBusinesses, demoEngagements } from '../../lib/demoStore';
import '../demo/demoData';
import { buildClientJourney, type ClientJourneyContext } from '../../lib/clientJourney';
import ClientJourney from './ClientJourney';

/**
 * /journey — the first screen a nonprofit client is pointed at after login.
 *
 * It answers, in one place: which door am I in, where am I in the journey
 * from first meeting to Hackathon Ready, and what do I do next.
 * The journey ends at Hackathon Ready. See docs/client-success-journey.md.
 *
 * The two doors, kept visibly separate:
 * - THIS page is the nonprofit client door ("For Nonprofits"). Clients sign
 *   up with Google or email + password; their profile role is `client`.
 * - The volunteer door ("For Data Diplomats", @datadiplomats.org, `admin`
 *   profiles) is a different login for DSSG / Data Diplomats team members.
 *   Their project-management tools are a separate surface and are NOT part
 *   of this journey or this page.
 */
export default function ClientJourneyPage({ isDemo }: { isDemo?: boolean }) {
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
      // RLS scopes businesses to the caller's own rows, so the first row is
      // this client's organization. A client with no business yet simply
      // gets the journey's opening steps.
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

  if (loading) return <div className="h-screen flex items-center justify-center">Loading your journey...</div>;

  const ctx: ClientJourneyContext = {
    hasAccount: true, // this page is behind login
    nonprofitValidated: business?.certified ?? false,
    applicationApproved: engagements.length > 0,
    engagements: engagements.map((e) => ({ stage: e.stage, status: e.status })),
    salesforceLinked: Boolean(business?.salesforceAccountId),
  };
  const steps = buildClientJourney(ctx);

  return (
    <div className="bg-bg-base min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        <header>
          <h1 className="text-3xl font-display font-bold text-dssg-blue tracking-tight">
            {business ? `Welcome, ${business.name}` : 'Welcome to DSSG NYC'}
          </h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">
            This is your client success portal: your whole pro bono journey with DSSG NYC, mapped from your first
            meeting to Hackathon Ready.
          </p>
        </header>

        {/* Which door am I in? The client / volunteer delineation, in the UI. */}
        <div className="grid sm:grid-cols-2 gap-3" aria-label="Client and volunteer doors">
          <div className="bg-white border-2 border-dssg-blue rounded-2xl p-4 flex gap-3">
            <Building2 className="text-dssg-blue shrink-0" size={20} />
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong className="text-slate-900">You are in: Nonprofit Client.</strong> You signed in through
              "For Nonprofits" to follow your organization's journey. This is your space.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3 opacity-80">
            <GraduationCap className="text-slate-400 shrink-0" size={20} />
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong className="text-slate-900">Not this door: Data Diplomats.</strong> Volunteers sign in
              separately with a @datadiplomats.org account ("For Data Diplomats") and use their own
              project-management tools. Those tools are separate from your journey and nothing you do here
              depends on them.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-red-600 text-sm font-bold bg-red-50 p-4 rounded-xl border border-red-100">{error}</p>
        )}

        {!business && !error && (
          <p className="text-sm text-slate-600 bg-white border border-slate-200 rounded-2xl p-4 leading-relaxed">
            No organization is linked to your account yet. Start with{' '}
            <Link to="/onboarding" className="font-bold text-dssg-blue hover:underline">validating your nonprofit</Link>{' '}
            and the{' '}
            <Link to="/apply" className="font-bold text-dssg-blue hover:underline">first-time applicant survey</Link> —
            your journey below shows exactly where those sit.
          </p>
        )}

        <ClientJourney steps={steps} />

        {business && (
          <p className="text-xs text-slate-400 leading-relaxed">
            {ctx.salesforceLinked
              ? 'Your organization is linked to DSSG’s Salesforce record, and your journey progress is saved in this portal.'
              : 'Your account and journey are saved in this portal (Supabase). Linking your record to DSSG’s Salesforce is pending — nothing is lost and no action is needed from you; DSSG completes the link on our side.'}
          </p>
        )}
      </div>
    </div>
  );
}
