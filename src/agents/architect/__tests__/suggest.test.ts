import { describe, expect, it } from "vitest";
import { suggestCsaAnswers } from "../suggest";
import type { SuggestionInput } from "../suggest";

const BASE: SuggestionInput = {
  mission: "We run a food pantry serving 600 households a week.",
  scale: "4 staff, 40 volunteers, ~$900k budget",
  contact_name_role: "Dana Reyes, Executive Director",
  current_systems: "Salesforce for donors, Google Sheets for visit logs, paper sign-in sheets.",
  problem_description: "We cannot tell funders how many repeat visitors we serve.",
  primary_need: "analyze_data",
};

const byField = (input: SuggestionInput) =>
  Object.fromEntries(suggestCsaAnswers(input).map((s) => [s.field, s]));

describe("suggestCsaAnswers", () => {
  it("copies the narrative intake answers into the matching CSA fields", () => {
    const s = byField(BASE);
    expect(s.q1_org_context?.value).toBe(BASE.mission);
    expect(s.q2_org_size?.value).toBe(BASE.scale);
    expect(s.q3_poc?.value).toBe(BASE.contact_name_role);
    expect(s.q5_data_locations?.value).toBe(BASE.current_systems);
    expect(s.q10_wished_decisions?.value).toBe(BASE.problem_description);
  });

  it("names the intake answer each suggestion came from", () => {
    const s = byField(BASE);
    expect(s.q1_org_context?.source).toBe("What they do");
    expect(s.q14_tools?.source).toBe("Data and systems today");
  });

  it("reads tools from the systems description", () => {
    expect(byField(BASE).q14_tools?.value).toEqual(["spreadsheets", "crm_case_tool"]);
  });

  it("suggests partial collection and islands for a CRM plus paper", () => {
    const s = byField(BASE);
    expect(s.q4_collection_scope?.value).toBe("partial");
    expect(s.q6_system_integration?.value).toBe("own_island");
  });

  it("suggests no systematic collection when nothing is tracked", () => {
    const s = byField({ ...BASE, current_systems: "Nothing yet — paper and email." });
    expect(s.q4_collection_scope?.value).toBe("not_systematic");
    expect(s.q14_tools).toBeUndefined();
  });

  it("suggests some sharing only when the intake says systems connect", () => {
    const s = byField({ ...BASE, current_systems: "Airtable synced to our CRM via Zapier." });
    expect(s.q6_system_integration?.value).toBe("some_share");
  });

  it("never suggests the strongest scored options", () => {
    for (const s of suggestCsaAnswers(BASE)) {
      expect(s.value).not.toBe("systematic");
      expect(s.value).not.toBe("most_share_auto");
    }
  });

  it("phrases the wish list from the primary need, or the applicant's own words", () => {
    expect(byField(BASE).q17a_wish_list?.value).toMatch(/already collect/);
    expect(
      byField({ ...BASE, primary_need: "something_else", primary_need_other: "A volunteer roster" })
        .q17a_wish_list?.value,
    ).toBe("A volunteer roster");
    expect(byField({ ...BASE, primary_need: "something_else" }).q17a_wish_list).toBeUndefined();
  });

  it("leaves fields with no evidence out rather than empty", () => {
    const fields = suggestCsaAnswers({ ...BASE, current_systems: "   " }).map((s) => s.field);
    expect(fields).not.toContain("q5_data_locations");
    expect(fields).not.toContain("q14_tools");
    expect(fields).not.toContain("q8_quality_confidence");
  });
});
