# Scout Agent — Design Spec

Scout handles light-touch triage intake and routing. It is the only agent fully built for the capstone demo.

## Intake
- Tally form, ~10 questions, 5–7 minutes to complete
- Webhook fires to n8n on submission
- Distinct from Architect's much deeper 18-question Current-State Assessment (see `architect-design.md`) — this division was a meaningful correction from an earlier draft that conflated the two agents

## Scout's Three Outputs
Scout produces three things per nonprofit, not one:

1. **Bucket assignment** — with a confidence level (high / medium / low)
2. **Engagement readiness signal** — independent of bucket, flags partner capacity issues
3. **Recommended onboarding kit** — pre-built materials matched to the bucket

Low-confidence bucket assignments and low readiness both trigger human review before anything auto-sends to the partner (see `hitl-framework.md`).

## The Five Buckets
1. Data Infrastructure
2. Analytics & Insight
3. ML / Predictive
4. Tooling & Automation
5. Advisory / Strategy — deliberately elevated from a catch-all into a genuine first-tier offering for early-stage organizations with little data storage or unclear starting point

## Engagement Readiness Signal
Three dimensions, rolled into a composite signal of **Ready / Conditional / Not Ready**:
1. Point-of-contact availability
2. Problem clarity
3. Data foothold (does the org have any existing data infrastructure to build on)

## HITL Routing Logic
Scout's routing evaluates bucket confidence and the composite readiness signal together:

- **High confidence + Ready** → L2 (agent acts, human notified, reversible)
- **Low confidence, OR Conditional/Not Ready** → L3 (agent drafts, human must approve before the onboarding kit is assigned)

Enforced in n8n as an IF node evaluating both fields before the workflow branches into the Review Queue.

## Output & Human Review
Scout's output document is surfaced via the human review UI with three action buttons for the reviewer (approve / edit / reject-and-redirect — confirm exact button labels/behavior with Karthik during build).

## Test Profiles
Three synthetic nonprofit profiles built for prompt calibration, spanning the range of buckets and readiness levels.
