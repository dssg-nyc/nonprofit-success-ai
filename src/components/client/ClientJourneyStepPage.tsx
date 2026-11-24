import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, ChevronLeft } from 'lucide-react';
import { clientStepPagePath, stepIdFromSlug } from '../../lib/clientJourney';
import { useClientJourney } from './useClientJourney';

/**
 * /journey/:stepSlug — one journey step, as its own page.
 *
 * Only the five engagement steps live here. The three onboarding steps
 * already had pages before the journey existed (/login, /onboarding,
 * /apply); their slugs resolve to null and bounce back to the map, whose
 * rows link straight to those pages instead.
 *
 * This page is the step's home: what it is, what the client does, what DSSG
 * does, when it's complete, and the client's live state for the stage. The
 * working surface for stage data (notes, logs, feed) stays where it already
 * lives — the business portal (/business/:id) — and this page links to it
 * rather than duplicating it.
 */
export default function ClientJourneyStepPage({ isDemo }: { isDemo?: boolean }) {
  const { stepSlug } = useParams();
  const stepId = stepSlug ? stepIdFromSlug(stepSlug) : null;
  const { business, engagements, steps, loading, error } = useClientJourney(isDemo);

  if (!stepId) return <Navigate to="/journey" replace />;
  if (loading) return <div className="h-screen flex items-center justify-center">Loading this step...</div>;

  const index = steps.findIndex((s) => s.id === stepId);
  const step = steps[index];
  if (!step) return <Navigate to="/journey" replace />;

  const prev = index > 0 ? steps[index - 1] : null;
  const next = index < steps.length - 1 ? steps[index + 1] : null;
  const engagement = step.engagementStage
    ? engagements.find((e) => e.stage === step.engagementStage)
    : undefined;

  const statusLabel =
    step.status === 'completed' ? 'Completed' : step.status === 'current' ? 'Current step' : 'Upcoming';

  return (
    <div className="bg-bg-base min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        <Link
          to="/journey"
          className="inline-flex items-center gap-2 text-slate-400 hover:text-dssg-blue transition-all font-bold text-[10px] uppercase tracking-[0.2em]"
        >
          <ChevronLeft size={14} /> Back to your journey
        </Link>

        <header>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-display font-bold text-dssg-blue tracking-tight">{step.title}</h1>
            <span
              className={`text-[10px] font-bold uppercase tracking-widest rounded-full px-3 py-1 ${
                step.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-600'
                  : step.status === 'current'
                    ? 'bg-dssg-blue text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">{step.summary}</p>
          {business && <p className="text-xs text-slate-400 mt-1">For {business.name}</p>}
        </header>

        {error && (
          <p className="text-red-600 text-sm font-bold bg-red-50 p-4 rounded-xl border border-red-100">{error}</p>
        )}

        <div className="grid gap-3">
          <section className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">What you do</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{step.clientAction}</p>
          </section>
          <section className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">What DSSG does</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{step.dssgAction}</p>
          </section>
          <section className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">This step is complete when</h2>
            <p className="text-sm text-slate-700 leading-relaxed flex items-start gap-2">
              <CheckCircle size={16} className="text-emerald-500 shrink-0 mt-0.5" /> {step.exitCriteria}
            </p>
          </section>
        </div>

        {/* Live state for this stage, from the client's own engagement rows. */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5" aria-label="Your status for this step">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Your status</h2>
          {!engagement && (
            <p className="text-sm text-slate-600 leading-relaxed">
              This stage hasn't started yet. DSSG opens it when the previous steps are complete — stage changes
              are made by DSSG staff, and you'll see the status change here.
            </p>
          )}
          {engagement && (
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                Stage status: <strong className="capitalize">{engagement.status.replace('_', ' ')}</strong>
              </p>
              {step.id === 'budget_check' && (
                <p>
                  Budget recorded:{' '}
                  <strong>
                    {engagement.budget_amount != null ? `$${engagement.budget_amount.toLocaleString()} USD` : 'not recorded yet'}
                  </strong>
                </p>
              )}
              {step.id === 'hackathon_ready' && (
                <p>
                  Project: <strong>{engagement.hackathon_project || 'not named yet'}</strong>
                </p>
              )}
              {engagement.notes && <p className="text-slate-600 italic">“{engagement.notes}”</p>}
            </div>
          )}
          {business && (
            <p className="text-sm mt-4">
              <Link to={`/business/${business.id}`} className="inline-flex items-center gap-1.5 font-bold text-dssg-blue hover:underline">
                Open this stage in your business portal (notes, logs, full detail) <ArrowRight size={14} />
              </Link>
            </p>
          )}
          {!business && (
            <p className="text-sm text-slate-600 mt-4">
              Once your application is approved and your engagement opens, your live stage status, notes, and
              logs will appear here and in your business portal.
            </p>
          )}
        </section>

        {/* Prev / next through the journey */}
        <nav className="flex items-center justify-between gap-3" aria-label="Journey steps">
          {prev ? (
            <Link
              to={clientStepPagePath(prev)}
              className="inline-flex items-center gap-2 py-2.5 px-4 bg-white border border-slate-200 rounded-xl font-bold text-sm text-slate-600 hover:border-slate-300"
            >
              <ArrowLeft size={14} /> {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              to={clientStepPagePath(next)}
              className="inline-flex items-center gap-2 py-2.5 px-4 bg-dssg-blue text-white rounded-xl font-bold text-sm hover:opacity-90"
            >
              Next: {next.title} <ArrowRight size={14} />
            </Link>
          )}
        </nav>
      </div>
    </div>
  );
}
