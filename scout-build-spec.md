# Scout Agent — Build Spec

Implementation-ready spec for Scout: intake, bucket routing, readiness signal. This is the only agent being fully built for the capstone demo.

---

## 1. Intake Form (Tally)

10 questions, ~5–7 minutes. Webhook POSTs the full form payload as JSON to an n8n endpoint on submission.

1. Organization name *(short text)*
2. Your name and role *(short text)*
3. Best email to reach you *(email)*
4. In one or two sentences, what does your organization do? *(short text)*
5. Who do you serve, and roughly how many people per year? *(short text — scale signal, tiebreaker)*
6. **What brings you to DSSG?** *(select one — primary bucketing signal)*
   - We have data and want help analyzing it
   - We need help building a tool, dashboard, or workflow
   - We want to build a predictive model or use machine learning
   - We have data but it's a mess and we need help organizing it
   - We're not sure where to start — we need guidance on our data strategy
   - Something else *(short text)*
7. Describe the problem or opportunity in your own words. *(short text — verification signal, most important question)*
8. What data or systems do you currently work with? *(short text — tiebreaker, quick scan)*
9. When would you ideally want to start, and is there a deadline driving this? *(short text — feeds readiness/urgency)*
10. How did you hear about DSSG? *(short text — DSSG attribution only, not used in Scout logic)*

Field name mapping for n8n Set node: `org_name`, `contact_name_role`, `contact_email`, `mission`, `scale`, `primary_need` (Q6), `problem_description` (Q7), `current_systems` (Q8), `timeline` (Q9), `referral_source` (Q10).

---

## 2. Bucket Assignment Logic

Three-step decision process using four of the ten fields.

### Step 1 — Q6 (`primary_need`) sets the starting hypothesis

| Q6 selection | Default bucket |
|---|---|
| Have data, want help analyzing it | Analytics & Insight |
| Need help building a tool, dashboard, or workflow | Tooling & Automation |
| Want to build a predictive model or use ML | ML / Predictive |
| Have data but it's a mess, need help organizing | Data Infrastructure |
| Not sure where to start, need data strategy guidance | Advisory / Strategy |
| Something else | → straight to human review (no auto-bucket) |

### Step 2 — Cross-check against Q7 (`problem_description`)

Scout compares the free-text problem description to the Q6-implied bucket.

- **Consistent** (e.g., Q6=ML + Q7 describes wanting to predict client dropout) → bucket confirmed, confidence trends high.
- **Inconsistent** (e.g., Q6=ML + Q7 describes wanting a funder-facing dashboard) → **Q7 wins**, Scout re-buckets to the bucket Q7 actually implies, and flags the contradiction for human review rather than silently overriding.

### Step 3 — Q5 (`scale`) and Q8 (`current_systems`) as tiebreakers

Used only when Q6/Q7 are ambiguous or point to multiple buckets:

- **Tiny org + minimal systems** → leans Advisory regardless of stated ask (a 2-person org asking for ML is usually really asking for data strategy help).
- **Larger org + existing systems** (e.g., 20 staff + a real CRM) → can support more ambitious buckets as originally requested.

This is capacity-matching, not gatekeeping — a small org can graduate from Advisory into a build bucket later.

### The Advisory default rule

**When in doubt, route to Advisory.** It's the safest mis-bucket because Advisory engagements can graduate into any other bucket once needs are clearer. Advisory is a genuine first-tier offering, never a rejection path — every submission gets a bucket, nobody is declined.

### What bucketing does NOT do

- Doesn't reject anyone (even "Something else" routes to human review, not decline)
- Doesn't score readiness (separate signal, see §3)
- Doesn't pick volunteer teams or scope projects (Architect's job)
- Doesn't assess credibility or detect false answers — takes intake at face value

---

## 3. Confidence Levels

| Confidence | Trigger condition | Downstream effect |
|---|---|---|
| **High** | Q6 and Q7 align cleanly; Q5/Q8 don't contradict | Onboarding kit can proceed to L2 (agent acts, human notified, reversible) |
| **Medium** | Q6/Q7 mostly align but some ambiguity, or Q5/Q8 raise a flag | Human reviews Scout's reasoning before kit sends (L3 — agent drafts, human approves) |
| **Low** | Q6/Q7 contradict, Q5/Q8 strongly disagree with the bucket, or an answer is too vague to interpret | Routes to human for manual decision, possibly a clarifying email first (L4 — human decides, agent assists) |

---

## 4. Engagement Readiness Signal

Independent of bucket assignment. Three dimensions, each scored 1–3, rolled into a composite:

1. **Point-of-contact availability** (`poc_score`)
2. **Problem clarity** (`clarity_score`)
3. **Data foothold** — existing data/systems to build on (`foothold_score`)

Composite (`composite_signal`): **Ready / Conditional / Not Ready**

---

## 5. HITL Routing (combines bucket confidence + readiness)

- **High confidence + Ready** → **L2** (agent acts, human notified, reversible)
- **Any other combination** → **L3** (agent drafts, human must approve before the onboarding kit is assigned)

Enforced in n8n as an IF node evaluating `confidence` and `composite_signal` together before branching into the Review Queue.

---

## 6. Anthropic API Call

- Model: `claude-sonnet-4-6`
- Max tokens: 800
- Endpoint: `api.anthropic.com/v1/messages`, called via n8n HTTP Request node, auth via stored n8n credential

### Prompt structure

**System message (static):**
> You are Scout, the routing agent for Data Science for Social Good NYC. You receive intake form submissions from nonprofits and route them to one of five engagement buckets. Read all intake responses, then:
> 1. Identify the bucket suggested by Q6 (`primary_need`).
> 2. Compare Q7 (`problem_description`) to the Q6 bucket — note any contradictions and let Q7 win when it conflicts.
> 3. Use Q5 (`scale`) and Q8 (`current_systems`) as tiebreakers only when Q6/Q7 are ambiguous.
> 4. When genuinely uncertain, default to Advisory / Strategy rather than guessing.
> 5. Score readiness on the three dimensions independently of the bucket decision.
> 6. Return only the structured JSON output below — no preamble, no markdown.

**User message template (field injection):**
> Organization: {{org_name}}
> Mission: {{mission}}
> Scale: {{scale}}
> Primary need (Q6): {{primary_need}}
> Problem description (Q7): {{problem_description}}
> Current systems (Q8): {{current_systems}}
> Timeline (Q9): {{timeline}}

### Output JSON schema (8 fields)

```json
{
  "bucket": "string — one of the five bucket names",
  "confidence": "High | Medium | Low",
  "rationale": "string — 1-3 sentences explaining the bucket decision",
  "poc_score": "integer 1-3",
  "clarity_score": "integer 1-3",
  "foothold_score": "integer 1-3",
  "composite_signal": "Ready | Conditional | Not Ready",
  "flags": ["array of strings — e.g. 'Q6/Q7 mismatch', 'vague problem description'"]
}
```

---

## 7. n8n Workflow (node sequence)

1. **Webhook** — catch Tally POST, confirm payload receipt
2. **Set** — parse Tally payload, map fields to named variables
3. **Airtable** — create `Nonprofits` record
4. **Airtable** — create linked `Intakes` record, store raw JSON for audit trail
5. **Code** — assemble full Scout prompt (system + user message) with fields injected
6. **HTTP Request** — POST to Anthropic API
7. **Code** — parse API response JSON, extract all 8 fields
   - **Error handler**: catch JSON parse failures → write error flag to Airtable → route to L3 review queue
8. **Airtable** — create `Bucket Assignments` record linked to Nonprofit
9. **Airtable** — create `Readiness Signals` record linked to Bucket Assignment
10. **IF** — HITL router: `confidence=High AND composite_signal=Ready` → L2 path; else → L3 path
11. **Airtable** — create `Human Review Queue` record (status = Pending), linked to both records above; notify DSSG staff (email/Slack)
12. **Human review** (Airtable Interface) — reviewer sees bucket, confidence, rationale, readiness scores; acts via approve / edit / reject-and-redirect (confirm exact button behavior with Karthik)

---

## 8. Onboarding Kit

Pre-built materials matched to the assigned bucket. Assignment/send is gated by the HITL routing above — never sent before required review.

---

## 9. Test Profiles

Three synthetic nonprofit profiles for prompt validation before build sign-off:

- **Profile A** — clean route, high confidence (Q6/Q7 align cleanly)
- **Profile B** — messy route, low confidence (Q6/Q7 contradict or vague)
- **Profile C** — advisory route (small org, minimal systems, uncertain ask)

Run all three against the assembled prompt and confirm output JSON matches expected bucket/confidence/readiness before wiring into the full n8n flow.

---

## Open items to confirm with Karthik before build

- Exact review UI button behavior (approve / edit / reject-and-redirect)
- n8n hosting: cloud Starter vs. self-hosted (Render/Railway) — Milestone 0 blocker
- Review UI choice: Airtable Interface Builder vs. standalone web form — Milestone 0 blocker
- Airtable field-level schema (table names, field types) — cross-check against full engineering brief before treating as final
