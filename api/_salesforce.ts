import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { errorName, log } from '../src/observability/log.js';
import type { UserClient } from './_auth.js';

/**
 * The one door to Salesforce (NPS #52). Salesforce owns relationship data — the people and
 * organizations — and Supabase stores only their ids, so a route that receives a name or
 * an email hands it here and keeps what comes back.
 *
 * Today the other side is the LOCAL-ONLY stand-in, `supabase/migrations/reference/salesforce/schema.sql`: a
 * `salesforce` schema with the same objects and id shapes, reached through its RPCs on
 * the caller's own client. The hosted project has no such schema, so there every call
 * fails `unavailable` and the intake route answers 502 rather than filing an intake with
 * no contact behind it. When the integration lands, the body of each function below
 * switches to the Salesforce REST API under a server-side integration user; the
 * signatures, and every caller, stay as they are.
 *
 * Logs carry the step and a code only: the arguments are the applicant's PII.
 */

/** An 18- or 15-char Salesforce id with a given key prefix (001 Account, 003 Contact). */
const sfId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$`));

const applicantSchema = z.object({
  account_id: sfId('001'),
  contact_id: sfId('003'),
});

export interface SalesforceApplicant {
  accountId: string;
  contactId: string;
}

export interface ApplicantFields {
  orgName: string;
  ein?: string;
  contactNameRole: string;
  contactEmail: string;
}

export type SalesforceResult<T> = { ok: true; value: T } | { ok: false; code: string };

/**
 * Stage one of the two-stage recording: upsert the applicant Account (by EIN) and its
 * primary Contact, both unverified, and return their ids. Idempotent — a resubmission
 * gets the same ids back, so a retried intake does not duplicate the relationship record.
 */
export async function upsertApplicant(
  client: UserClient,
  fields: ApplicantFields,
): Promise<SalesforceResult<SalesforceApplicant>> {
  try {
    // The stand-in schema is not in the generated `Database` type (it is not part of the
    // app's schema), so the call goes through an untyped view of the same client and the
    // reply is checked at runtime instead.
    const { data, error } = await (client as unknown as SupabaseClient)
      .schema('salesforce')
      .rpc('upsert_applicant', {
        p_org_name: fields.orgName,
        p_ein: fields.ein ?? null,
        p_contact_name_role: fields.contactNameRole,
        p_contact_email: fields.contactEmail,
      });
    if (error) {
      log('error', 'route_failure', { step: 'salesforce_upsert_applicant', code: error.code ?? 'rpc_failed' });
      return { ok: false, code: 'unavailable' };
    }
    const parsed = applicantSchema.safeParse(data);
    if (!parsed.success) {
      log('error', 'route_failure', { step: 'salesforce_upsert_applicant', code: 'bad_result' });
      return { ok: false, code: 'bad_result' };
    }
    return { ok: true, value: { accountId: parsed.data.account_id, contactId: parsed.data.contact_id } };
  } catch (err) {
    log('error', 'route_failure', { step: 'salesforce_upsert_applicant', code: 'threw', errorName: errorName(err) });
    return { ok: false, code: 'unavailable' };
  }
}
