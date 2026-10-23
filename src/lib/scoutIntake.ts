import type { ScoutIntake } from '../types';

/**
 * A `scout_intakes` row, as `rowToDomain` / `liveQuery` deliver it, as a `ScoutIntake`.
 *
 * `ScoutIntake` is mixed-case on purpose: the applicant's answers and the readiness scores
 * keep the form's snake_case because `routeScoutIntake()` and `/api/route-intake` take that
 * exact shape, while the review fields are camelCase like every other domain type. The
 * generic row mapper camelCases every column, so without this step `org_name`,
 * `composite_signal` and the scores read as `undefined` and the review queue renders blank
 * cards against real rows (demo fixtures are built in snake_case, which hid it).
 */
export function scoutIntakeFromRow(row: Record<string, unknown>): ScoutIntake {
  const {
    orgName, contactNameRole, contactEmail, primaryNeed, primaryNeedOther,
    problemDescription, currentSystems, referralSource,
    pocScore, clarityScore, footholdScore, compositeSignal,
    ...rest
  } = row;
  return {
    ...(rest as Omit<ScoutIntake, SnakeField>),
    org_name: orgName as string,
    contact_name_role: contactNameRole as string,
    contact_email: contactEmail as string,
    primary_need: primaryNeed as ScoutIntake['primary_need'],
    primary_need_other: (primaryNeedOther as string | null | undefined) ?? undefined,
    problem_description: problemDescription as string,
    current_systems: currentSystems as string,
    referral_source: referralSource as string,
    poc_score: pocScore as ScoutIntake['poc_score'],
    clarity_score: clarityScore as ScoutIntake['clarity_score'],
    foothold_score: footholdScore as ScoutIntake['foothold_score'],
    composite_signal: compositeSignal as ScoutIntake['composite_signal'],
  };
}

/** The `ScoutIntake` keys that stay snake_case — the form's and the scorer's shape. */
type SnakeField =
  | 'org_name' | 'contact_name_role' | 'contact_email' | 'primary_need' | 'primary_need_other'
  | 'problem_description' | 'current_systems' | 'referral_source'
  | 'poc_score' | 'clarity_score' | 'foothold_score' | 'composite_signal';
