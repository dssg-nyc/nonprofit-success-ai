/** Helpers the Scout admin screens share that are not components (kept apart for fast refresh). */

export function relativeTime(seconds?: number): string {
  if (!seconds) return '';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** What the review banner says for each `/api/scout-approve` error code. */
export function decisionErrorMessage(code: string): string {
  switch (code) {
    case 'unauthorized':
    case 'network_error':
      return 'Could not reach the server. Check your connection and sign-in, then try again. Nothing was changed.';
    case 'forbidden':
      return 'Only an admin of the organization this intake belongs to can approve it.';
    case 'already_approved':
      return 'This intake is already in the pipeline — its business has an engagement. Nothing was changed.';
    case 'already_reviewed':
      return 'This intake was already reviewed with a different bucket. Nothing was changed.';
    case 'guard_unmet':
      return 'This intake was declined. Reopen it from the Declined tab to approve it. Nothing was changed.';
    case 'organization_required':
      return 'You administer more than one organization; this intake needs one chosen before it can be approved.';
    case 'bucket_required':
      return 'Choose a bucket before approving — Scout could not assign one.';
    default:
      return 'Could not save the review decision. Nothing was changed.';
  }
}
