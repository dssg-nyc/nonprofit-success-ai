import {
  ArchitectCharter,
  CharterWorkstream,
  NinetyDayPlan,
  ScoutBucket,
} from "../../types";
import { MaturityResult } from "./scoring";

export interface PlanGenerationInput {
  orgName: string;
  bucket: ScoutBucket;
  maturity: MaturityResult;
  q1_org_context: string;
  q9_current_decisions: string;
  q10_wished_decisions: string;
  q17a_wish_list: string;
  q17b_biggest_worry: string;
  q18_past_blockers: string;
}

/**
 * The required workstream each flagged dimension becomes. Exported so the grounding
 * grader (`evals/graders/heuristic/grounding.ts`) can check that every required
 * workstream traces to a flag or to `DATA_FOUNDATIONS`.
 */
export const WORKSTREAM_DEFS: Record<
  "data_infrastructure" | "governance",
  CharterWorkstream
> = {
  data_infrastructure: {
    name: "Data Integration & Hygiene",
    required: true,
    description:
      "Connect siloed systems, standardize collection across programs, and establish baseline data quality. Required workstream — flagged Foundational on the Data Infrastructure dimension.",
  },
  governance: {
    name: "Reporting Automation",
    required: true,
    description:
      "Name an owner for every recurring funder and board report, write down the reporting calendar and the data each report draws on, then automate the most manual one. Required workstream — flagged Foundational on the Governance dimension.",
  },
};

/**
 * The build_basics workstream when nothing is flagged: the plan's phases describe
 * collection, storage and a first summary, so the charter names that work rather than
 * carrying an empty list (run 1, 2026-10-08: a zero-flag Foundational charter listed no
 * workstreams and the judge failed it on completeness).
 */
export const DATA_FOUNDATIONS: CharterWorkstream = {
  name: "Data Foundations",
  required: true,
  description:
    "Stand up the collection, storage and first summary the plan describes.",
};

const BUCKET_DELIVERABLES: Record<
  ScoutBucket,
  { name: string; description: string }
> = {
  "Data Infrastructure": {
    name: "Unified Data Pipeline",
    description:
      "Consolidate program data into a single, documented pipeline the org can maintain.",
  },
  "Analytics & Insight": {
    name: "Board-Facing Insight Report",
    description:
      "A repeatable quarterly analysis of program outcomes, built on the org's own data.",
  },
  "ML / Predictive": {
    name: "Predictive Risk-Model Prototype",
    description:
      "A first working model on historical data, with an honest evaluation of what it can and can't predict.",
  },
  "Tooling & Automation": {
    name: "Operational Dashboard v1",
    description:
      "A live dashboard for the workflow the assessment names as most manual.",
  },
  "Advisory / Strategy": {
    name: "Data-Strategy Roadmap",
    description:
      "A prioritized, right-sized roadmap for the org's next 12 months of data investment.",
  },
};

export function generateNinetyDayPlan(
  input: PlanGenerationInput,
): NinetyDayPlan {
  const { maturity, bucket, orgName } = input;
  const flaggedWorkstreams = maturity.flaggedDimensions.map(
    (d) => WORKSTREAM_DEFS[d],
  );
  const deliverable = BUCKET_DELIVERABLES[bucket];

  if (maturity.compositeLevel === "Foundational") {
    return {
      shape: "build_basics",
      headline: `Build the basics — no analysis promised yet.`,
      phases: [
        {
          window: "Days 1–30",
          title: "Map & Stabilize",
          milestones: [
            "Inventory every place data currently lives, and who touches it",
            "Pick one program as the pilot for systematic collection",
            "Agree on the minimum fields every program will collect",
          ],
        },
        {
          window: "Days 31–60",
          title: "Standardize",
          milestones: [
            "Roll out the shared collection template to the pilot program",
            "Clean and migrate the pilot program's historical records",
            "Document where each data type should live going forward",
          ],
        },
        {
          window: "Days 61–90",
          title: "Prove the Habit",
          milestones: [
            "Produce the org's first from-live-data summary (internal only)",
            "Extend the collection standard to a second program",
            "Scope Phase 2 based on what the pilot surfaced",
          ],
        },
      ],
      workstreams:
        flaggedWorkstreams.length > 0 ? flaggedWorkstreams : [DATA_FOUNDATIONS],
    };
  }

  if (maturity.remediationOnly) {
    return {
      shape: "remediation_only",
      headline:
        "Remediation-only plan — the flagged workstreams ARE the deliverable.",
      phases: [
        {
          window: "Days 1–30",
          title: "Diagnose Both Gaps",
          milestones: [
            "Map every system and its data silo (Data Integration & Hygiene)",
            "Inventory current reporting obligations and their manual cost (Reporting Automation)",
            "Sequence the two workstreams — parallel or staged — with the org",
          ],
        },
        {
          window: "Days 31–60",
          title: "Fix the Foundations",
          milestones: [
            "Connect or consolidate the two most critical systems",
            "Standardize the collection process feeding them",
            "Build the first semi-automated report template on the cleaned data",
          ],
        },
        {
          window: "Days 61–90",
          title: "Clear the Flags",
          milestones: [
            "Confirm each flagged dimension has a named owner and a written procedure in use",
            "Hand off documentation and the reporting rhythm to org staff",
            "Charter Phase 2 — the deferred project — if flags have cleared",
          ],
        },
      ],
      workstreams: flaggedWorkstreams,
      phase2Note: `The ${deliverable.name} (${bucket}) is deferred to Phase 2, contingent on both flagged dimensions clearing to Developing. No stretch project is attached to this 90-day window.`,
    };
  }

  if (maturity.compositeLevel === "Developing") {
    const alongside =
      flaggedWorkstreams.length > 0
        ? ` The ${flaggedWorkstreams[0].name} workstream runs alongside it as a required, named track.`
        : "";
    return {
      shape: "ship_deliverable",
      headline: `Ship one concrete deliverable: the ${deliverable.name}.${alongside}`,
      phases: [
        {
          window: "Days 1–30",
          title: "Scope & Access",
          milestones: [
            `Define what "done" means for the ${deliverable.name} with ${orgName}`,
            "Get volunteer team access to the relevant systems and data",
            ...(flaggedWorkstreams.length > 0
              ? [
                  `Kick off the ${flaggedWorkstreams[0].name} workstream in parallel`,
                ]
              : ["Confirm data quality is sufficient for the deliverable"]),
          ],
        },
        {
          window: "Days 31–60",
          title: "Build",
          milestones: [
            `First working draft of the ${deliverable.name} reviewed with staff`,
            "Iterate on real usage feedback, not assumptions",
            ...(flaggedWorkstreams.length > 0
              ? [`${flaggedWorkstreams[0].name}: first milestone shipped`]
              : ["Document the build so org staff can maintain it"]),
          ],
        },
        {
          window: "Days 61–90",
          title: "Ship & Transfer",
          milestones: [
            `Final ${deliverable.name} delivered and in real use`,
            "Training session for the staff who will own it",
            "Retrospective + Phase 2 scoping if the org wants to continue",
          ],
        },
      ],
      workstreams: [
        ...flaggedWorkstreams,
        {
          name: deliverable.name,
          required: false,
          description: deliverable.description,
        },
      ],
    };
  }

  // Established
  return {
    shape: "accelerate",
    headline: `Accelerate toward a specific outcome: the ${deliverable.name}, possibly multi-phase.`,
    phases: [
      {
        window: "Days 1–30",
        title: "Align & Sprint",
        milestones: [
          `Lock the success metric for the ${deliverable.name} with leadership`,
          "Stand up the working environment on the org's existing stack",
          "First prototype in front of staff by day 30",
        ],
      },
      {
        window: "Days 31–60",
        title: "Deepen",
        milestones: [
          "Iterate the deliverable against the locked success metric",
          "Integrate with the org's existing tooling (not a parallel system)",
          "Identify the Phase 2 multi-phase opportunity, if any",
        ],
      },
      {
        window: "Days 61–90",
        title: "Land & Extend",
        milestones: [
          `${deliverable.name} shipped, measured against the success metric`,
          "Org staff running it independently",
          "Phase 2 charter drafted if the metric supports going further",
        ],
      },
    ],
    // Spec §2 step 4: a Foundational Governance score is a required workstream at every
    // composite level. Established can still carry one (di=3, gov=1 reaches 17 points),
    // and the charter's risks already name it as non-skippable — so the plan must too.
    workstreams: [
      ...flaggedWorkstreams,
      {
        name: deliverable.name,
        required: false,
        description: deliverable.description,
      },
    ],
  };
}

/**
 * How many of `generateCharter()`'s risks are structural: the cross-check, the DI
 * override note and one per required workstream, always first and in that order. They
 * restate rubric outcomes, so model enrichment may not reword them
 * (`agents/architect/model.ts` `mergeEnrichment()`); the org-stated risks after them are
 * prose and may be reworded.
 */
export function structuralRiskCount(maturity: MaturityResult): number {
  return (
    (maturity.crossCheckFlag ? 1 : 0) +
    (maturity.overrideApplied ? 1 : 0) +
    maturity.flaggedDimensions.length
  );
}

export function generateCharter(input: PlanGenerationInput): ArchitectCharter {
  const { orgName, bucket, maturity } = input;
  const plan = generateNinetyDayPlan(input);
  const deliverable = BUCKET_DELIVERABLES[bucket];

  const scopeByLevel: Record<string, string> = {
    Foundational: `Infrastructure and data-hygiene engagement. This charter scopes the basics — systematic collection, a stable home for data, and a first internal summary. The plan's three phases (map and stabilize, standardize, prove the habit) are the core work${plan.workstreams.length > 0 ? `, with the required ${plan.workstreams.map((w) => w.name).join(" and ")} workstream${plan.workstreams.length > 1 ? "s" : ""} running inside them` : ""}. No analysis or modeling is promised in this window.`,
    Developing: maturity.remediationOnly
      ? `Remediation-only engagement. Both flagged workstreams (${plan.workstreams.map((w) => w.name).join(" and ")}) are the deliverable for this 90-day window; the ${deliverable.name} is deferred to Phase 2.`
      : `One scoped ${bucket} project: the ${deliverable.name}, shipped within the 90-day window${maturity.flaggedDimensions.length > 0 ? `, with the required ${WORKSTREAM_DEFS[maturity.flaggedDimensions[0]].name} workstream running alongside` : ""}.`,
    Established: `Stretch ${bucket} engagement: the ${deliverable.name}, accelerated toward a leadership-locked success metric, with a possible multi-phase extension.`,
  };

  const risks: string[] = [];
  if (maturity.crossCheckFlag)
    risks.push(`CROSS-CHECK: ${maturity.crossCheckFlag}`);
  if (maturity.overrideApplied)
    risks.push(
      "Points total reached Established, but Foundational Data Infrastructure capped this engagement at Developing — the data the project depends on isn't integrated yet.",
    );
  for (const d of maturity.flaggedDimensions) {
    risks.push(
      `${WORKSTREAM_DEFS[d].name} is a required workstream — skipping it invalidates the plan.`,
    );
  }
  if (input.q17b_biggest_worry.trim())
    risks.push(`Org's own stated worry: "${input.q17b_biggest_worry.trim()}"`);
  if (input.q18_past_blockers.trim())
    risks.push(
      `What blocked this work before: "${input.q18_past_blockers.trim()}"`,
    );
  if (risks.length === 0)
    risks.push(
      "No structural risks flagged by the assessment. Standard engagement risk applies (staff turnover, volunteer availability).",
    );

  const objectives = plan.phases.map((p) => `${p.window}: ${p.title}`);

  return {
    title: `${orgName} × DSSG NYC — Engagement Charter`,
    background: [
      input.q1_org_context.trim(),
      input.q9_current_decisions.trim() &&
        `How data is used today: ${input.q9_current_decisions.trim()}`,
      input.q10_wished_decisions.trim() &&
        `What they wish data could do: ${input.q10_wished_decisions.trim()}`,
      input.q17a_wish_list.trim() &&
        `Data wish list: ${input.q17a_wish_list.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    scopeStatement: scopeByLevel[maturity.compositeLevel],
    objectives,
    workstreams: plan.workstreams,
    risks,
    successCriteria:
      plan.shape === "build_basics"
        ? [
            "Systematic collection running in at least two programs",
            "One internal from-live-data summary produced",
            "Org staff can state where every data type lives",
          ]
        : plan.shape === "remediation_only"
          ? [
              "Each flagged dimension has a named owner and a written procedure in use",
              "Documentation and reporting rhythm handed off to staff",
              "Phase 2 charter ready if flags cleared",
            ]
          : [
              // The override means some source data is not integrated yet: promise the
              // deliverable on what is, not on data the engagement cannot rely on.
              maturity.overrideApplied
                ? `${deliverable.name} delivered by day 90 on the data that is already integrated; anything that needs the still-siloed sources waits for Phase 2`
                : `${deliverable.name} delivered and in real use by day 90`,
              "Org staff trained to own the deliverable independently",
              ...(maturity.flaggedDimensions.includes("governance")
                ? ["Every recurring funder and board report has a named owner and a documented data source"]
                : []),
              "One recurring report produced from the new pipeline without manual steps",
            ],
    cadence:
      maturity.compositeLevel === "Foundational"
        ? "Lighter commitment, more frequent check-ins (weekly 30-minute syncs)."
        : "Standard cadence (bi-weekly working sessions, monthly steering check-in).",
  };
}
