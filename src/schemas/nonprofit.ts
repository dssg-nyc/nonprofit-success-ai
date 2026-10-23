import { z } from 'zod';

/**
 * Wire shapes of the ProPublica Nonprofit Explorer proxy:
 * `GET /api/nonprofits/search` and `GET /api/nonprofits/:ein`.
 * Not an agent path: no model, no tier. `source` records where the data came from.
 */

/** IRS form family. ProPublica's `formtype` is 0 / 1 / 2; anything else is null. */
export const nonprofitFormTypeSchema = z.enum(['990', '990EZ', '990PF']);

/** One search hit. Search results carry no financials. */
export const nonprofitSummarySchema = z.object({
  /** 9 digits, no dash, leading zeros kept. */
  ein: z.string().regex(/^\d{9}$/),
  /** `NN-NNNNNNN`, for display. */
  strein: z.string().regex(/^\d{2}-\d{7}$/),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  nteeCode: z.string().nullable(),
  /** 501(c) subsection, e.g. 3 for 501(c)(3). */
  subsectionCode: z.number().nullable(),
  source: z.literal('propublica'),
});

/** A filing ProPublica has extracted financials for. PF filings may leave the totals null. */
export const nonprofitFilingSchema = z.object({
  taxYear: z.number(),
  formType: nonprofitFormTypeSchema.nullable(),
  totalRevenue: z.number().nullable(),
  totalExpenses: z.number().nullable(),
  totalAssets: z.number().nullable(),
  totalLiabilities: z.number().nullable(),
  pdfUrl: z.string().nullable(),
});

/** A filing with only a scanned or e-filed PDF, no extracted numbers. */
export const nonprofitPdfFilingSchema = z.object({
  taxYear: z.number(),
  formType: nonprofitFormTypeSchema.nullable(),
  pdfUrl: z.string().nullable(),
});

/**
 * One organization by EIN. An organization with no extracted filings is still a 200:
 * `latestFiling` is null and `irs` (the IRS Business Master File, refreshed monthly)
 * may still carry a revenue figure.
 */
export const nonprofitDetailSchema = nonprofitSummarySchema.extend({
  irs: z.object({
    revenueAmount: z.number().nullable(),
    assetAmount: z.number().nullable(),
    /** `YYYY-MM-DD`, the period the master-file amounts cover. */
    taxPeriod: z.string().nullable(),
  }),
  /** Newest filing with extracted financials. */
  latestFiling: nonprofitFilingSchema.nullable(),
  /** Newest PDF-only filing, often a year ahead of `latestFiling`. */
  latestPdfFiling: nonprofitPdfFilingSchema.nullable(),
  filingCount: z.object({ withData: z.number(), pdfOnly: z.number() }),
});

export const nonprofitSearchResponseSchema = z.object({
  results: z.array(nonprofitSummarySchema),
  total: z.number(),
  /** Zero-based, as sent. */
  page: z.number(),
  numPages: z.number(),
});

export const nonprofitDetailResponseSchema = z.object({
  result: nonprofitDetailSchema,
});
