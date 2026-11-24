import { useState } from 'react';
import { CheckCircle, Sparkles } from 'lucide-react';

export type MembershipDecision = 'accepted' | 'declined';

/**
 * The terminal step of the pro bono journey (docs/client-success-journey.md §3):
 * when a client reaches Hackathon Ready, DSSG NYC proposes membership.
 * Shown only when `membershipOfferDue(steps)` is true.
 *
 * Demo / pre-integration behaviour: the decision is recorded locally and
 * confirmed on screen. Live behaviour (follow-up): persist the decision as
 * the `membership` engagement transition via /api/engagement-transition —
 * never as a direct browser write, matching BusinessPortal's rule that stage
 * changes are not written from the browser.
 */
export default function MembershipOffer({
  businessName,
  onRespond,
}: {
  businessName?: string;
  onRespond?: (decision: MembershipDecision) => void;
}) {
  const [decision, setDecision] = useState<MembershipDecision | null>(null);

  const respond = (choice: MembershipDecision) => {
    setDecision(choice);
    onRespond?.(choice);
  };

  return (
    <section className="bg-white border-2 border-dssg-blue/20 rounded-2xl p-6 shadow-sm" aria-label="Membership offer">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-dssg-blue text-white flex items-center justify-center shrink-0">
          <Sparkles size={20} />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-slate-900">
            {businessName ? `${businessName}, you're Hackathon Ready` : "You're Hackathon Ready"} — here's your membership offer
          </h3>
          <p className="text-sm text-slate-600 leading-relaxed mt-1">
            Your pro bono journey is complete: initial meeting, budget check, data ethics review, and scoping are
            done, and your project is ready to be built. DSSG NYC now offers your organization{' '}
            <strong>membership</strong>, so the work can continue beyond the hackathon — ongoing support, future
            projects, and the DSSG community. Accepting or declining is entirely your choice; declining changes
            nothing about the journey you've completed.
          </p>

          {decision ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
              <CheckCircle size={16} />
              {decision === 'accepted'
                ? 'Thank you — you accepted the membership offer. DSSG will follow up with next steps.'
                : 'Understood — you declined for now. Your completed journey and project stay as they are.'}
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => respond('accepted')}
                className="py-2.5 px-5 bg-dssg-blue text-white rounded-xl font-bold text-sm hover:opacity-90 active:scale-[0.99] transition-all"
              >
                Accept membership offer
              </button>
              <button
                type="button"
                onClick={() => respond('declined')}
                className="py-2.5 px-5 bg-white border-2 border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:border-slate-300 active:scale-[0.99] transition-all"
              >
                Decline for now
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
