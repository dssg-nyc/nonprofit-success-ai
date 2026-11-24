import { Link } from 'react-router-dom';
import { CheckCircle, ChevronRight, Circle, Loader } from 'lucide-react';
import type { ClientJourneyStepState } from '../../lib/clientJourney';
import { clientStepPagePath } from '../../lib/clientJourney';

/**
 * The journey map (overview). Every step is a link to that step's own page —
 * nothing expands in place here. Steps that already had a page before the
 * journey (/login, /onboarding, /apply) link straight to it; the engagement
 * steps link to their dedicated /journey/<step> pages.
 */
export default function ClientJourney({ steps }: { steps: ClientJourneyStepState[] }) {
  const doneCount = steps.filter((s) => s.status === 'completed').length;

  return (
    <section aria-label="Your journey with DSSG NYC">
      <div className="flex items-end justify-between mb-2">
        <h2 className="text-xl font-bold text-slate-900">Your journey</h2>
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
          {doneCount} of {steps.length} steps complete
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-8" role="progressbar" aria-valuenow={doneCount} aria-valuemax={steps.length}>
        <div
          className="h-full bg-dssg-blue rounded-full transition-all"
          style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }}
        />
      </div>

      <ol className="space-y-3">
        {steps.map((step) => {
          const isCurrent = step.status === 'current';
          const isDone = step.status === 'completed';
          return (
            <li key={step.id}>
              <Link
                to={clientStepPagePath(step)}
                className={`flex items-start gap-4 bg-white rounded-2xl border p-5 transition-all hover:border-dssg-blue hover:shadow-md hover:shadow-blue-900/5 ${
                  isCurrent ? 'border-dssg-blue shadow-md shadow-blue-900/5' : 'border-slate-200'
                } ${step.status === 'upcoming' ? 'opacity-80' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    isDone
                      ? 'bg-emerald-100 text-emerald-600'
                      : isCurrent
                        ? 'bg-dssg-blue text-white'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isDone ? <CheckCircle size={18} /> : isCurrent ? <Loader size={18} /> : <Circle size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-slate-900">{step.title}</h3>
                    {isCurrent && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-white bg-dssg-blue rounded-full px-2 py-0.5">
                        You are here
                      </span>
                    )}
                    {isDone && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">
                        Done
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed mt-1">{step.summary}</p>
                </div>
                <ChevronRight className="text-slate-300 shrink-0 mt-1" size={18} />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
