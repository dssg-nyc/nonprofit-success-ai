# Architect Agent — Design Spec

Architect receives Scout's handoff (bucket assignment, confidence level, readiness signal) and conducts the deeper onboarding assessment. Mocked in the vision deck for the capstone demo (not built end-to-end).

## Current-State Assessment (v2)
18 questions, ~30 minutes, conducted after Scout's handoff. Distinct from Scout's ~10-question, 5–7 minute triage intake.

**Section 1 — Organization context** (Q1–Q3): what the org does, size, point of contact. Narrative only, not scored.

**Section 2 — What data you have** (Q4–Q8): collection scope, where data lives, system integration, integration familiarity, data quality confidence. → **Data Infrastructure** dimension.

**Section 3 — How data gets used** (Q9–Q11): current data-driven decisions, wished-for decisions, who's empowered to decide. → **Decision Culture** dimension.

**Section 4 — Reporting and accountability** (Q12–Q13): who they report to, how automated that reporting is. → **Governance** dimension.

**Section 5 — Tools and capacity** (Q14–Q16): full tool checklist, staff data-work confidence, budget/approval speed for new tools. → **Tooling** dimension (Q14) and **Team Capacity** dimension (Q15–Q16).

**Section 6 — Goals and readiness** (Q17a/b, Q18): data wish list, biggest data worry, what's blocked this work before. Narrative and risk-flagging only, not scored — feeds the charter's rationale and risk section directly.

## Maturity Model

### Dimensions and scoring rubric

| Level | Data Infrastructure | Governance | Tooling | Decision Culture | Team Capacity |
|---|---|---|---|---|---|
| **Foundational (1)** | Q4 not systematic, or Q6 "own island," or Q8 "not very/don't track" | Q13 "don't produce regular reports" or "mostly manual" | Spreadsheets-only, no CRM/reporting tool | Q11 "don't really get made from data" | Q15 "low comfort" + Q16 "case-by-case" |
| **Developing (2)** | Some systematic collection, Q6 "some do, most don't," mixed Q8 | Q13 "semi-automated" | Has a CRM or case tool, no dedicated reporting tool | Q11 "leadership + managers" | Q15 "some/ad-hoc" or Q16 requires approval |
| **Established (3)** | Q6 "most share automatically," Q8 "very confident," Q7 "very familiar" | Q13 "mostly automated" | CRM + dedicated reporting/analytics tool (Tableau/Power BI/Looker) | Q11 "anyone with access" | Q15 "dedicated staff" + Q16 fast budget |

### Composite: Points-Primary with Targeted Override + Flag

**Step 1 — Score each dimension** 1/2/3 per rubric above.

**Step 2 — Weighted composite.** Data Infrastructure ×2, Governance ×2, Tooling ×1, Decision Culture ×1, Team Capacity ×1 (max 21).
Bands: **7–11 Foundational · 12–16 Developing · 17–21 Established**

**Step 3 — Override (Data Infrastructure only).** If Data Infrastructure scores Foundational (1), composite is capped at **Developing**, regardless of points total. This is the only hard gate — you can't run a project on data that doesn't exist, no matter how strong tooling/culture/capacity are elsewhere.

**Step 4 — Mandatory flag (Data Infrastructure or Governance).** If either dimension scores Foundational, it's flagged as a **required, named workstream** in the charter and 90-day plan — never folded into generic "areas to improve" language. This is independent of whether the override triggered; Governance-Foundational doesn't cap the composite, but it does guarantee the plan doesn't quietly skip fixing it.

**Step 5 — Remediation scoping rule (charter logic, not scoring logic).**
- **1 dimension flagged** → the workstream runs *alongside* a scoped deliverable in the same 90-day plan.
- **2+ dimensions flagged** → the 90-day plan is remediation-only. The flagged workstreams *are* the deliverable (parallel or sequenced). No separate stretch project is attached in the same window — it becomes the Phase 2 plan, contingent on the flagged dimensions clearing to Developing.

### Why the override is scoped to Data Infrastructure only
Points alone can let a well-resourced, well-tooled org with genuinely siloed data score into Established — which would greenlight a project (e.g., ML/Predictive) their actual data can't support. Data Infrastructure is the one dimension that can't be averaged away. Governance doesn't get the same override because a governance gap (poor reporting habits) doesn't block the underlying work the way a data-infrastructure gap does — it's a real problem, but not a structural blocker to starting.

### Validated edge cases

| Profile | Data Infra | Governance | Tooling | Decision Culture | Team Capacity | Points | Override? | Flags | Result |
|---|---|---|---|---|---|---|---|---|---|
| 1 — Paper-based | Found. | Found. | Found. | Found. | Found. | 7 | n/a (already floor) | Both | **Foundational**, both workstreams named |
| 2 — Mixed maturity | Develop. | Found. | Develop. | Develop. | Estab. | 13 | No | Governance | **Developing**, reporting-automation workstream alongside scoped project |
| 3 — Well-resourced, siloed | Found. | Estab. | Estab. | Estab. | Estab. | 17 | **Yes** (capped from Established) | Data Infra | **Developing**, data-integration workstream required before any stretch project |
| 4 — Dual gaps, strong capacity | Found. | Found. | Estab. | Estab. | Estab. | 13 | Yes (no-op, already Developing) | Both | **Developing**, remediation-only 90-day plan (both workstreams *are* the plan); stretch project deferred to Phase 2 |

Profile 2 confirms Points correctly surfaces real capacity instead of erasing it under a single weak score. Profile 3 confirms the override catches the case Points alone would misjudge. Profile 4 confirms the remediation-scoping rule prevents an unrealistic 90-day plan when two foundational gaps coexist with strong capacity elsewhere.

## Output
Architect takes Scout's handoff + CSA responses + a kickoff call and produces:
- Project charter (scope shaped by composite level + remediation-scoping rule)
- MOU
- Kickoff deck
- 90-day engagement plan

## Downstream effect by composite level

| Composite | Charter scope | 90-day plan shape | MOU |
|---|---|---|---|
| Foundational | Infrastructure/hygiene project | Build the basics — no analysis promised yet | Lighter commitment, more check-ins |
| Developing | One scoped analytics/tooling project (or remediation-only, per Step 5) | Ship one concrete deliverable | Standard cadence |
| Established | Stretch project, possibly multi-phase | Accelerate toward a specific outcome | Standard, can commit to more |

## Cross-check against Scout
Architect's maturity level should be sanity-checked against Scout's bucket assignment. A Foundational-maturity org landing in "ML/Predictive" from Scout is a signal Architect should catch and potentially redirect before chartering, not chart around.

## Still open (not yet designed)
- Exact charter/MOU/kickoff deck templates (structure only implied by the table above, not drafted)
- Confirming Team Capacity and Governance question-to-dimension mapping with Karthik/build (mapping above is derived from the CSA v2 doc, not yet cross-checked against any build-side schema)
- Human review UI for Architect's output (HITL level and approval flow not yet specified, unlike Scout's three-button review)
