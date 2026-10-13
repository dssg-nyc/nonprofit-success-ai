import type { CsaTool, ScoutIntake } from "../../types";

/**
 * Architect's suggested CSA answers, read off the approved Scout intake so the reviewer
 * walks into the kickoff call with a draft instead of a blank form.
 *
 * Every suggestion is a *proposal*: the form marks each one and the reviewer confirms or
 * edits it before the assessment can be submitted (HITL — the maturity score is computed
 * from what a human confirmed, never from what this module guessed). Only questions the
 * intake gives evidence for are suggested; the rest stay empty and are asked on the call.
 *
 * Deterministic and pure, so it is the fallback half of the four-rule contract
 * (design-system.md §2). A model-backed draft can layer on top through the gateway later
 * and must produce the same shape.
 */

/** The CSA fields a suggestion may fill — a subset of the eighteen answers. */
export type SuggestableField =
  | "q1_org_context"
  | "q2_org_size"
  | "q3_poc"
  | "q4_collection_scope"
  | "q5_data_locations"
  | "q6_system_integration"
  | "q10_wished_decisions"
  | "q14_tools"
  | "q17a_wish_list";

/** Which intake answer a suggestion came from, in the words the intake card uses. */
export type SuggestionSource =
  | "What they do"
  | "Who they serve"
  | "Point of contact"
  | "Data and systems today"
  | "The problem, in their words"
  | "What brings them to DSSG";

export interface CsaSuggestion<K extends SuggestableField = SuggestableField> {
  field: K;
  value: K extends "q14_tools" ? CsaTool[] : string;
  source: SuggestionSource;
}

/** The intake answers the suggestions are read from. */
export type SuggestionInput = Pick<
  ScoutIntake,
  | "mission"
  | "scale"
  | "contact_name_role"
  | "current_systems"
  | "problem_description"
  | "primary_need"
  | "primary_need_other"
>;

const TOOL_SIGNALS: { tool: CsaTool; pattern: RegExp }[] = [
  { tool: "spreadsheets", pattern: /spreadsheet|excel|google sheet|\bsheets?\b|\bcsv\b/i },
  {
    tool: "crm_case_tool",
    pattern: /\bcrm\b|salesforce|apricot|case[- ]management|bloomerang|little green light|hubspot/i,
  },
  { tool: "reporting_analytics", pattern: /tableau|power ?bi|looker|metabase|dashboard tool/i },
  { tool: "forms_surveys", pattern: /google form|survey ?monkey|typeform|jotform|\bsurveys?\b|\bforms\b/i },
  { tool: "accounting", pattern: /quickbooks|xero|accounting/i },
];

/** Systems that imply at least some data lives in a real store. */
const STORE_SIGNAL = /crm|salesforce|database|warehouse|data lake|erp|airtable|postgres|sql/i;
/** Wording that says the data is scattered or barely collected. */
const SCATTERED_SIGNAL = /paper|binder|nothing|none\b|no system|ad hoc|scattered|all over|just started|email/i;
/** Wording that says the systems already connect. */
const CONNECTED_SIGNAL = /integrat|sync|connected|talks? to|pipeline|api|zapier/i;

const PRIMARY_NEED_WISH: Record<ScoutIntake["primary_need"], string | null> = {
  analyze_data: "Make sense of the data they already collect and act on what it shows.",
  build_tool: "A working tool, dashboard or workflow that replaces a manual step.",
  ml_predictive: "A predictive model they can trust and act on.",
  organize_data: "Data organised into one reliable place that staff can use.",
  strategy_guidance: "A clear data strategy and a first step they can commit to.",
  something_else: null,
};

const clean = (text: string | undefined | null): string => (text ?? "").trim();

/**
 * Suggest CSA answers from the intake. Returns one entry per field that has evidence,
 * in form order; fields with no evidence are absent, not empty.
 */
export function suggestCsaAnswers(intake: SuggestionInput): CsaSuggestion[] {
  const out: CsaSuggestion[] = [];
  const mission = clean(intake.mission);
  const scale = clean(intake.scale);
  const poc = clean(intake.contact_name_role);
  const systems = clean(intake.current_systems);
  const problem = clean(intake.problem_description);

  if (mission) out.push({ field: "q1_org_context", value: mission, source: "What they do" });
  if (scale) out.push({ field: "q2_org_size", value: scale, source: "Who they serve" });
  if (poc) out.push({ field: "q3_poc", value: poc, source: "Point of contact" });

  if (systems) {
    const hasStore = STORE_SIGNAL.test(systems);
    const scattered = SCATTERED_SIGNAL.test(systems);
    const connected = CONNECTED_SIGNAL.test(systems);
    const tools = TOOL_SIGNALS.filter((t) => t.pattern.test(systems)).map((t) => t.tool);

    // Q4: a named store suggests at least partial collection; scattered wording suggests
    // none yet. Both at once (a CRM plus paper files) is "partial".
    if (hasStore || scattered) {
      out.push({
        field: "q4_collection_scope",
        value: hasStore ? "partial" : "not_systematic",
        source: "Data and systems today",
      });
    }
    out.push({ field: "q5_data_locations", value: systems, source: "Data and systems today" });
    // Q6: "own island" unless the intake says systems connect; "most share" is never
    // suggested — that claim is for the call.
    if (tools.length > 0 || hasStore || scattered) {
      out.push({
        field: "q6_system_integration",
        value: connected ? "some_share" : "own_island",
        source: "Data and systems today",
      });
    }
    if (tools.length > 0) {
      out.push({ field: "q14_tools", value: tools, source: "Data and systems today" });
    }
  }

  if (problem) {
    out.push({ field: "q10_wished_decisions", value: problem, source: "The problem, in their words" });
  }

  const wish =
    intake.primary_need === "something_else"
      ? clean(intake.primary_need_other) || null
      : PRIMARY_NEED_WISH[intake.primary_need];
  if (wish) out.push({ field: "q17a_wish_list", value: wish, source: "What brings them to DSSG" });

  return out;
}
