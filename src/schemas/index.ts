/**
 * Versioned wire-contract schemas — the request/response shapes that cross the
 * /api boundary. NOT the model-internal schemas (those stay with their agents
 * at src/agents/{agent}/schema.ts).
 *
 * Each schema exports a version string recorded in `agent_runs.prompt_version`.
 */

export {
  scoutApproveRequestSchema,
  scoutApproveResponseSchema,
  scoutIntakeRequestSchema,
  scoutIntakeResponseSchema,
  scoutResultSchema,
} from "./scout";
export { pulseSignalSchema } from "./pulse";
export {
  ENVOY_OCCASIONS,
  envoyDraftRequestSchema,
  envoyDraftResponseSchema,
  envoyDraftSchema,
  envoyInputSchema,
} from "./envoy";
export {
  chronicleDraftRequestSchema,
  chronicleDraftResponseSchema,
  chronicleDraftSchema,
  chronicleInputSchema,
} from "./chronicle";
export {
  engagementStageSchema,
  engagementTransitionRequestSchema,
  engagementTransitionResponseSchema,
} from "./engagement";
export {
  architectCharterSchema,
  architectPlanRequestSchema,
  architectPlanResponseSchema,
  csaAnswersSchema,
  maturityResultSchema,
  ninetyDayPlanSchema,
} from "./architect";

// Wire schemas are defined here and imported BY the agents (CLAUDE.md: agents/ ->
// schemas), never re-exported from them. An agent's model-facing schema derives from
// its wire schema in the agent's own schema.ts.

export const SCHEMA_VERSIONS = {
  "scout-routing": "v1",
  // v3 / v4 (2026-10-08): the request carries only engagementId + key (+ Envoy's occasion
  // and concerns); every engagement fact is read server-side (`api/_engagement.ts`).
  "envoy-draft": "v3",
  "chronicle-draft": "v4",
  "architect-plan": "v1",
  "pulse-health": "v1",
  "engagement-transition": "v1",
  "scout-approve": "v1",
} as const;

export type SchemaName = keyof typeof SCHEMA_VERSIONS;
