import { Link } from 'react-router-dom';
import { Building2, GraduationCap } from 'lucide-react';
import { useClientJourney } from './useClientJourney';
import ClientJourney from './ClientJourney';

/**
 * /journey — the map a nonprofit client lands on after login.
 *
 * It answers, in one place: which door am I in, where am I in the journey
 * from first meeting to Hackathon Ready, and where do I go for each step.
 * Every step on the map links to that step's own page: steps that already
 * had one (/login, /onboarding, /apply) link there; the five engagement
 * steps link to their dedicated /journey/<step> pages. Nothing expands
 * in place on this page.
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
  const { business, steps, salesforceLinked, loading, error } = useClientJourney(isDemo);

  if (loading) return <div className="h-screen flex items-center justify-center">Loading your journey...</div>;

  return (
    <div className="bg-bg-base min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        <header>
          <h1 className="text-3xl font-display font-bold text-dssg-blue tracking-tight">
            {business ? `Welcome, ${business.name}` : 'Welcome to DSSG NYC'}
          </h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">
            This is your client success portal: your whole pro bono journey with DSSG NYC, mapped from your first
            meeting to Hackathon Ready. Select any step to open its page.
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
            {salesforceLinked
              ? 'Your organization is linked to DSSG’s Salesforce record, and your journey progress is saved in this portal.'
              : 'Your account and journey are saved in this portal (Supabase). Linking your record to DSSG’s Salesforce is pending — nothing is lost and no action is needed from you; DSSG completes the link on our side.'}
          </p>
        )}
      </div>
    </div>
  );
}
