import type { z } from 'zod';
import type {
  chronicleDraftRequestSchema,
  chronicleDraftResponseSchema,
  chronicleDraftSchema,
  chronicleInputSchema,
} from '../schemas/chronicle';

// Wire shapes for /api/chronicle-draft: inferred from src/schemas/chronicle.ts, never
// hand-written beside it (CLAUDE.md "One definition per shape"). Type-only imports.

export type ChronicleDraft = z.infer<typeof chronicleDraftSchema>;
export type ChronicleReadiness = ChronicleDraft['readiness'];
export type ChronicleDraftRequest = z.infer<typeof chronicleDraftRequestSchema>;
/** The draft-generation input, built server-side from engagement rows (`api/_engagement.ts`). */
export type ChronicleInput = z.infer<typeof chronicleInputSchema>;
/** What `/api/chronicle-draft` returns: the draft, which path wrote it, and its ids (null if nothing saved). */
export type ChronicleDraftResponse = z.infer<typeof chronicleDraftResponseSchema>;
