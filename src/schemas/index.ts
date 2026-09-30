/**
 * Versioned wire-contract schemas — the request/response shapes that cross the
 * /api boundary. NOT the model-internal schemas (those stay with their agents
 * at src/agents/star/schema.ts).
 *
 * Each schema exports a version string recorded in `agent_runs.prompt_version`.
 */

export { scoutResultSchema } from "../agents/scout/schema";
export type { ScoutResultPayload } from "../agents/scout/schema";

// Re-export the wire contract types for consumers. The schemas themselves are
// Zod objects defined in their respective agent schema files. This barrel
// provides a single import path for code that needs the wire shape (e.g. the
// gateway, the client API layer) without reaching into agent internals.

export const SCHEMA_VERSIONS = {
  "scout-routing": "v1",
  "envoy-draft": "v1",
  "chronicle-draft": "v1",
} as const;

export type SchemaName = keyof typeof SCHEMA_VERSIONS;
