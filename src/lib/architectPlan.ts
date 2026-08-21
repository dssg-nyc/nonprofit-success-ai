import {
  ArchitectCharter,
  CharterWorkstream,
  NinetyDayPlan,
  ScoutBucket,
} from '../types';
import { MaturityResult } from './architectScoring';

/**
 * Deterministic charter + 90-day plan generation from the maturity result
 * (architect-design.md §Output / §Downstream effect). A future Claude call
 * would enrich this narrative — richer background prose, org-specific
 * milestone wording — behind these same output shapes. The scoping logic
 * itself (what kind of plan an org gets) is spec-defined and stays
 * deterministic either way.
 */

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

const WORKSTREAM_DEFS: Record<'data_infrastructure' | 'governance', CharterWorkstream> = {
  data_infrastructure: {
    name: 'Data Integration & Hygiene',
    required: true,
    description:
      'Connect siloed systems, standardize collection across programs, and establish baseline data quality. Required workstream — flagged Foundational on the Data Infrastructure dimension.',
  },
  governance: {
    name: 'Reporting Automation',
    required: true,
    description:
      'Stand up a regular, semi-automated reporting rhythm to funders and the board. Required workstream — flagged Foundational on the Governance dimension.',
  },
};

const BUCKET_DELIVERABLES: Record<ScoutBucket, { name: string; description: string }> = {
  'Data Infrastructure': {
    name: 'Unified Data Pipeline',
    description: 'Consolidate program data into a single, documented pipeline the org can maintain.',
  },
  'Analytics & Insight': {
    name: 'Board-Facing Insight Report',
    description: 'A repeatable quarterly analysis of program outcomes, built on the org\'s own data.',
  },
  'ML / Predictive': {
    name: 'Predictive Risk-Model Prototype',
    description: 'A first working model on historical data, with an honest evaluation of what it can and can\'t predict.',
  },
  'Tooling & Automation': {
    name: 'Operational Dashboard v1',
    description: 'A live dashboard replacing the org\'s most painful manual reporting workflow.',
  },
  'Advisory / Strategy': {
    name: 'Data-Strategy Roadmap',
    description: 'A prioritized, right-sized roadmap for the org\'s next 12 months of data investment.',
  },
};

export function generateNinetyDayPlan(input: PlanGenerationInput): NinetyDayPlan {
  const { maturity, bucket, orgName } = input;
  const flaggedWorkstreams = maturity.flaggedDimensions.map(d => WORKSTREAM_DEFS[d]);
  const deliverable = BUCKET_DELIVERABLES[bucket];

  if (maturity.compositeLevel === 'Foundational') {
    return {
      shape: 'build_basics',
      headline: `Build the basics — no analysis promised yet.`,
      phases: [
        {
          window: 'Days 1–30',
          title: 'Map & Stabilize',
          milestones: [
            'Inventory every place data currently lives, and who touches it',
            'Pick one program as the pilot for systematic collection',
            'Agree on the minimum fields every program will collect',
          ],
        },
        {
          window: 'Days 31–60',
          title: 'Standardize',
          milestones: [
            'Roll out the shared collection template to the pilot program',
            'Clean and migrate the pilot program\'s historical records',
            'Document where each data type should live going forward',
          ],
        },
        {
          window: 'Days 61–90',
          title: 'Prove the Habit',
          milestones: [
            'Produce the org\'s first from-live-data summary (internal only)',
            'Extend the collection standard to a second program',
            'Scope Phase 2 based on what the pilot surfaced',
          ],
        },
      ],
      workstreams: flaggedWorkstreams,
    };
  }

  if (maturity.remediationOnly) {
    return {
      shape: 'remediation_only',
      headline: 'Remediation-only plan — the flagged workstreams ARE the deliverable.',
      phases: [
        {
          window: 'Days 1–30',
          title: 'Diagnose Both Gaps',
          milestones: [
            'Map every system and its data silo (Data Integration & Hygiene)',
            'Inventory current reporting obligations and their manual cost (Reporting Automation)',
            'Sequence the two workstreams — parallel or staged — with the org',
          ],
        },
        {
          window: 'Days 31–60',
          title: 'Fix the Foundations',
          milestones: [
            'Connect or consolidate the two most critical systems',
            'Standardize the collection process feeding them',
            'Build the first semi-automated report template on the cleaned data',
          ],
        },
        {
          window: 'Days 61–90',
          title: 'Clear the Flags',
          milestones: [
            'Verify both dimensions now operate at Developing level',
            'Hand off documentation and the reporting rhythm to org staff',
            'Charter Phase 2 — the deferred project — if flags have cleared',
          ],
        },
      ],
      workstreams: flaggedWorkstreams,
      phase2Note: `The ${deliverable.name} (${bucket}) is deferred to Phase 2, contingent on both flagged dimensions clearing to Developing. No stretch project is attached to this 90-day window.`,
    };
  }

  if (maturity.compositeLevel === 'Developing') {
    const alongside = flaggedWorkstreams.length > 0
      ? ` The ${flaggedWorkstreams[0].name} workstream runs alongside it as a required, named track.`
      : '';
    return {
      shape: 'ship_deliverable',
      headline: `Ship one concrete deliverable: the ${deliverable.name}.${alongside}`,
      phases: [
        {
          window: 'Days 1–30',
          title: 'Scope & Access',
          milestones: [
            `Define what "done" means for the ${deliverable.name} with ${orgName}`,
            'Get volunteer team access to the relevant systems and data',
            ...(flaggedWorkstreams.length > 0 ? [`Kick off the ${flaggedWorkstreams[0].name} workstream in parallel`] : ['Confirm data quality is sufficient for the deliverable']),
          ],
        },
        {
          window: 'Days 31–60',
          title: 'Build',
          milestones: [
            `First working draft of the ${deliverable.name} reviewed with staff`,
            'Iterate on real usage feedback, not assumptions',
            ...(flaggedWorkstreams.length > 0 ? [`${flaggedWorkstreams[0].name}: first milestone shipped`] : ['Document the build so org staff can maintain it']),
          ],
        },
        {
          window: 'Days 61–90',
          title: 'Ship & Transfer',
          milestones: [
            `Final ${deliverable.name} delivered and in real use`,
            'Training session for the staff who will own it',
            'Retrospective + Phase 2 scoping if the org wants to continue',
          ],
        },
      ],
      workstreams: [
        ...flaggedWorkstreams,
        { name: deliverable.name, required: false, description: deliverable.description },
      ],
    };
  }

  // Established
  return {
    shape: 'accelerate',
    headline: `Accelerate toward a specific outcome: the ${deliverable.name}, possibly multi-phase.`,
    phases: [
      {
        window: 'Days 1–30',
        title: 'Align & Sprint',
        milestones: [
          `Lock the success metric for the ${deliverable.name} with leadership`,
          'Stand up the working environment on the org\'s existing stack',
          'First prototype in front of staff by day 30',
        ],
      },
      {
        window: 'Days 31–60',
        title: 'Deepen',
        milestones: [
          'Iterate the deliverable against the locked success metric',
          'Integrate with the org\'s existing tooling (not a parallel system)',
          'Identify the Phase 2 multi-phase opportunity, if any',
        ],
      },
      {
        window: 'Days 61–90',
        title: 'Land & Extend',
        milestones: [
          `${deliverable.name} shipped, measured against the success metric`,
          'Org staff running it independently',
          'Phase 2 charter drafted if the metric supports going further',
        ],
      },
    ],
    workstreams: [
      { name: deliverable.name, required: false, description: deliverable.description },
    ],
  };
}

export function generateCharter(input: PlanGenerationInput): ArchitectCharter {
  const { orgName, bucket, maturity } = input;
  const plan = generateNinetyDayPlan(input);
  const deliverable = BUCKET_DELIVERABLES[bucket];

  const scopeByLevel: Record<string, string> = {
    Foundational: `Infrastructure and data-hygiene engagement. This charter scopes the basics — systematic collection, a stable home for data, and a first internal summary. No analysis or modeling is promised in this window.`,
    Developing: maturity.remediationOnly
      ? `Remediation-only engagement. Both flagged workstreams (${plan.workstreams.map(w => w.name).join(' and ')}) are the deliverable for this 90-day window; the ${deliverable.name} is deferred to Phase 2.`
      : `One scoped ${bucket} project: the ${deliverable.name}, shipped within the 90-day window${maturity.flaggedDimensions.length > 0 ? `, with the required ${WORKSTREAM_DEFS[maturity.flaggedDimensions[0]].name} workstream running alongside` : ''}.`,
    Established: `Stretch ${bucket} engagement: the ${deliverable.name}, accelerated toward a leadership-locked success metric, with a possible multi-phase extension.`,
  };

  const risks: string[] = [];
  if (maturity.crossCheckFlag) risks.push(`CROSS-CHECK: ${maturity.crossCheckFlag}`);
  if (maturity.overrideApplied) risks.push('Points total reached Established, but Foundational Data Infrastructure capped this engagement at Developing — the data the project depends on isn\'t integrated yet.');
  for (const d of maturity.flaggedDimensions) {
    risks.push(`${WORKSTREAM_DEFS[d].name} is a required workstream — skipping it invalidates the plan.`);
  }
  if (input.q17b_biggest_worry.trim()) risks.push(`Org's own stated worry: "${input.q17b_biggest_worry.trim()}"`);
  if (input.q18_past_blockers.trim()) risks.push(`What blocked this work before: "${input.q18_past_blockers.trim()}"`);
  if (risks.length === 0) risks.push('No structural risks flagged by the assessment. Standard engagement risk applies (staff turnover, volunteer availability).');

  const objectives = plan.phases.map(p => `${p.window}: ${p.title}`);

  return {
    title: `${orgName} × DSSG NYC — Engagement Charter`,
    background: [
      input.q1_org_context.trim(),
      input.q9_current_decisions.trim() && `How data is used today: ${input.q9_current_decisions.trim()}`,
      input.q10_wished_decisions.trim() && `What they wish data could do: ${input.q10_wished_decisions.trim()}`,
      input.q17a_wish_list.trim() && `Data wish list: ${input.q17a_wish_list.trim()}`,
    ].filter(Boolean).join('\n\n'),
    scopeStatement: scopeByLevel[maturity.compositeLevel],
    objectives,
    workstreams: plan.workstreams,
    risks,
    successCriteria:
      plan.shape === 'build_basics'
        ? ['Systematic collection running in at least two programs', 'One internal from-live-data summary produced', 'Org staff can state where every data type lives']
        : plan.shape === 'remediation_only'
          ? ['Both flagged dimensions verifiably operating at Developing level', 'Documentation and reporting rhythm handed off to staff', 'Phase 2 charter ready if flags cleared']
          : [`${deliverable.name} delivered and in real use by day 90`, 'Org staff trained to own the deliverable independently', 'A measurable improvement the org can cite to funders'],
    cadence:
      maturity.compositeLevel === 'Foundational'
        ? 'Lighter commitment, more frequent check-ins (weekly 30-minute syncs).'
        : 'Standard cadence (bi-weekly working sessions, monthly steering check-in).',
  };
}
