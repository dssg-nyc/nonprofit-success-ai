import type { z } from 'zod';
import type {
  nonprofitDetailResponseSchema,
  nonprofitDetailSchema,
  nonprofitFilingSchema,
  nonprofitSearchResponseSchema,
  nonprofitSummarySchema,
} from '../schemas/nonprofit.js';

export type NonprofitSummary = z.infer<typeof nonprofitSummarySchema>;
export type NonprofitFiling = z.infer<typeof nonprofitFilingSchema>;
export type NonprofitDetail = z.infer<typeof nonprofitDetailSchema>;
export type NonprofitSearchResponse = z.infer<typeof nonprofitSearchResponseSchema>;
export type NonprofitDetailResponse = z.infer<typeof nonprofitDetailResponseSchema>;

/** Query of `GET /api/nonprofits/search`. At least one of the four criteria is required. */
export interface NonprofitSearchQuery {
  q?: string;
  /** Two-letter postal code, or `ZZ` for international. */
  state?: string;
  /** NTEE major group, 1-10. */
  ntee?: number;
  /** 501(c) subsection, 2-28 or 92 (4947(a)(1)). */
  cCode?: number;
  /** Zero-based. */
  page?: number;
}
