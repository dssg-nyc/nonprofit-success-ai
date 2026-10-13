import type { z } from 'zod';
import { pulseSignalSchema } from '../../schemas/pulse';

// The wire schema lives in src/schemas (agents import schemas, never the reverse).
export { pulseSignalSchema };

export type PulseSignalPayload = z.infer<typeof pulseSignalSchema>;
