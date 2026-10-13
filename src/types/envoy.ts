import type { z } from 'zod';
import type {
  envoyDraftRequestSchema,
  envoyDraftResponseSchema,
  envoyDraftSchema,
  envoyInputSchema,
} from '../schemas/envoy';

// Wire shapes for /api/envoy-draft: inferred from src/schemas/envoy.ts, never hand-written
// beside it (CLAUDE.md "One definition per shape"). Type-only imports, so no runtime cycle.

export type EnvoyDraft = z.infer<typeof envoyDraftSchema>;
export type EnvoyOccasion = EnvoyDraft['occasion'];
export type EnvoyDraftRequest = z.infer<typeof envoyDraftRequestSchema>;
/** The draft-generation input: the request's occasion and concerns plus facts read server-side (`api/_engagement.ts`). */
export type EnvoyInput = z.infer<typeof envoyInputSchema>;
/** What `/api/envoy-draft` returns: the saved draft, which path wrote it, and its ids. */
export type EnvoyDraftResponse = z.infer<typeof envoyDraftResponseSchema>;
