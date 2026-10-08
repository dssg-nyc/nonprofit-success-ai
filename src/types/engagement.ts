import type { z } from 'zod';
import type {
  engagementTransitionRequestSchema,
  engagementTransitionResponseSchema,
} from '../schemas/engagement';

// Wire shapes for /api/engagement-transition: inferred from src/schemas/engagement.ts,
// never hand-written beside it (CLAUDE.md "One definition per shape"). The UI-facing
// `Engagement` view model stays in ./domain.

export type EngagementTransitionRequest = z.infer<typeof engagementTransitionRequestSchema>;
export type EngagementTransitionResponse = z.infer<typeof engagementTransitionResponseSchema>;
