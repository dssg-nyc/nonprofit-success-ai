# Contract & Consent Gate
**Plate:** C4.2 in docs/nonprofit-success-system-design.html
**Status:** GAP
**PRD sections:** §9 CF3

## Responsibility
Presents the engagement charter for partner review, captures a typed-name e-signature, creates an immutable signed record, and advances the engagement stage from Initial Meeting to Budget Check.

## Mechanism
Staff sends charter to partner for signature → partner visits in-app signature page → renders charter preview (read-only, versioned PDF) → partner types full legal name → POST /api/contract-sign → server validates name matches contact record → writes `engagement_contracts` row (immutable) → advances `engagements.stage` to `Budget Check` → emails signed confirmation to partner + dssgnyc@gmail.com with PDF attachment.

No DocuSign or external e-signature provider — the typed-name capture is the legal signature mechanism. The charter preview shown at signing time is locked to the `architect_assessments` version that was approved; a subsequent re-assessment does not invalidate a signed contract.

## Contract
- **Input:** `ContractSignInput` — `engagementId` (FK), `signerName` (string — must match `engagements.contact_name`), `charterVersion` (string — FK to `architect_assessments.id`)
- **Output:** `ContractSignResult` — `contractId` (UUID), `signedAt` (ISO timestamp, server-generated), `newStage` ('Budget Check'), `emailsSent` (string[])
- **Side effects:** Writes one `engagement_contracts` row (immutable — no update, no delete); updates `engagements.stage = 'Budget Check'` and `engagements.contract_id` FK; sends two emails (partner + dssgnyc@gmail.com) with PDF attachment.

## Rules
- `signedAt` is server-generated — never client-supplied. The endpoint must reject any request body that includes a `signedAt` field.
- `engagement_contracts` rows are immutable once written. No update path exists in the API or in RLS policy. A re-signing scenario (revised charter) creates a new row; the engagement carries the latest `contract_id` FK.
- The charter PDF served at signing time is generated server-side from the pinned `charterVersion` — not re-generated from current `architect_assessments` state. The content partner sees must be byte-identical to what gets emailed.
- Stage transition (`Initial Meeting` → `Budget Check`) is part of the same server-side transaction as the contract insert. If either write fails, both roll back.
- Email failure after a successful transaction does not roll back the contract row or stage transition — email failure is logged and retried separately, not a reason to undo a legal signature.
- `hitlTier` is `L3` — staff initiates the signature request; the system does not auto-send to partners. A staff action is required to generate and share the signature link.
- No client-side PDF generation — charter template logic stays out of the browser bundle.

## Dependencies
- **Imports:** `src/types/` (`ContractSignInput`, `ContractSignResult`); Supabase service-role client (`src/lib/supabase.ts`); email service (TBD — Resend or nodemailer); PDF generator (TBD — `@react-pdf/renderer` or puppeteer)
- **Imported by:** In-app signature page component; engagement detail screen (contract status badge, stage display)
- **Data:** `engagement_contracts` table (deferred `supabase/migrations/0005_contracts.sql`); `engagements` table (stage FK update); `architect_assessments` (charter source, read-only at signing time)

## Delta rows
Cited from [`delta.md`](../../../delta.md) — this spec does not mint numbers.

- **D9** — Contract & Consent gate: `/api/contract-sign`, server timestamp, immutable write — GAP
- **D27** — in-app signature UI: charter preview + typed-name form — GAP

## Test contract
- Happy path: valid `signerName` matching contact → 201, row written, `engagements.stage = 'Budget Check'`, two emails sent.
- Name mismatch: `signerName` differs from `contact_name` (case-insensitive) → 422, no row written, stage unchanged.
- Already signed: `engagements.contract_id` already set → 409, no second row written.
- Charter version mismatch: `charterVersion` does not match a completed `architect_assessments` row for this engagement → 422.
- Client-supplied `signedAt`: request body includes `signedAt` field → 400.
- Email failure: email step throws → contract row and stage transition persist; response still 201 with `emailsSent = []` and a warning field.
- Immutability: attempt to UPDATE an `engagement_contracts` row via Supabase client → RLS blocks (integration test against local Supabase).
- Transaction rollback: DB failure on stage transition write → contract row not committed either.

## Open questions
1. Legal text pending DSSG NYC counsel review — spec cannot finalize contract copy until counsel approves.
2. E-signature sufficiency: does typed-name satisfy the legal requirement for this engagement type, or does a more formal e-signature provider (DocuSign, HelloSign) become necessary?
3. Email provider: Resend (Vercel Marketplace integration) or nodemailer + SMTP?
4. PDF generation: `@react-pdf/renderer` (pure JS, works in a Function) vs. puppeteer (heavier, needs a separate container). Charter template complexity determines which is viable.
