import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Circle, Loader } from 'lucide-react';
import type { ClientJourneyStepState } from '../../lib/clientJourney';
import { nextClientStep } from '../../lib/clientJourney';

/**
 * The client's journey map, rendered as a vertical timeline.
 * One step is current; its card spells out what the client does next and
 * what DSSG does, so "where am I and what happens now" is never a guess.
 */
export default function ClientJourney({ steps }: { steps: ClientJourneyStepState[] }) {
  const next = nextClientStep(steps);
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
            <li
              key={step.id}
              className={`bg-white rounded-2xl border p-5 ${
                isCurrent ? 'border-dssg-blue shadow-md shadow-blue-900/5' : 'border-slate-200'
              } ${step.status === 'upcoming' ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start gap-4">
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

                  {isCurrent && (
                    <div className="mt-3 grid gap-2 text-sm">
                      <p className="bg-slate-50 rounded-xl px-4 py-3">
                        <strong className="text-slate-800">Your next step:</strong>{' '}
                        <span className="text-slate-600">{step.clientAction}</span>
                      </p>
                      <p className="bg-slate-50 rounded-xl px-4 py-3">
                        <strong className="text-slate-800">What DSSG does:</strong>{' '}
                        <span className="text-slate-600">{step.dssgAction}</span>
                      </p>
                      <p className="text-xs text-slate-400 px-1">This step is complete when: {step.exitCriteria}</p>
                      {step.href && (
                        <Link
                          to={step.href}
                          className="inline-flex items-center gap-1.5 text-sm font-bold text-dssg-blue hover:underline"
                        >
                          Go to this step <ArrowRight size={14} />
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {next && (
        <p className="sr-only" aria-live="polite">
          Your current step is {next.title}.
        </p>
      )}
    </section>
  );
}
