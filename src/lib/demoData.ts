import { ArchitectAssessment, CsaTool, PrimaryNeed, ScoutIntake } from '../types';
import { routeScoutIntake, getOnboardingKitName, ScoutRoutingInput } from './scoutRouting';
import { scoreAssessment, CsaScoredAnswers } from './architectScoring';
import { generateCharter, generateNinetyDayPlan, PlanGenerationInput } from './architectPlan';
import {
  demoAssessments, demoBusinesses, demoEngagements,
} from './demoStore';
import { buildGraduatedBusiness, buildGraduationEngagement, businessIdForAssessment } from './graduation';

/**
 * Fully-seeded demo dataset: five partner orgs, each already carried all the
 * way through Scout -> Architect -> graduated Business/Engagement. Chosen so
 * the five collectively exercise every 90-day plan shape (build_basics,
 * ship_deliverable, remediation_only, accelerate) and both Architect warning
 * banners (Data Infrastructure override, single required workstream) — so
 * clicking through Review Queue -> Ongoing Projects -> Client Portal for any
 * one of them traces a real, internally-consistent flow end to end.
 */

export const DEMO_USER = { uid: 'demo-user-123', email: 'demo@nyc-dssg.org' };

interface OrgSeed {
  id: string;
  ageSeconds: number;
  intake: ScoutRoutingInput & {
    org_name: string;
    contact_email: string;
    mission: string;
    referral_source: string;
  };
  csa: {
    q1_org_context: string;
    q2_org_size: string;
    q3_poc: string;
    q5_data_locations: string;
    q9_current_decisions: string;
    q10_wished_decisions: string;
    q12_reporting_to: string;
    q17a_wish_list: string;
    q17b_biggest_worry: string;
    q18_past_blockers: string;
  } & CsaScoredAnswers;
}

const ORG_SEEDS: OrgSeed[] = [
  {
    id: 'demo-scout-1',
    ageSeconds: 86400,
    intake: {
      org_name: 'Uptown Youth Corps',
      contact_name_role: 'Maria Gonzalez, Program Director',
      contact_email: 'maria@uptownyouthcorps.org',
      mission: 'We provide after-school workforce training and mentorship to NYC teens.',
      scale: '~400 participants/year, staff of 18',
      primary_need: 'ml_predictive' as PrimaryNeed,
      problem_description: 'We want to predict which participants are at risk of dropping out of our program so we can intervene early with extra support.',
      current_systems: 'Salesforce CRM with 5 years of program completion data.',
      timeline: 'This quarter, before our next cohort starts in September.',
      referral_source: 'DSSG hackathon alum',
    },
    csa: {
      q1_org_context: 'Uptown Youth Corps runs after-school workforce training and mentorship for NYC teens, serving ~400 participants a year with a staff of 18.',
      q2_org_size: '18 staff, ~400 participants/year',
      q3_poc: 'Maria Gonzalez, Program Director',
      q4_collection_scope: 'partial',
      q5_data_locations: 'Salesforce CRM is the system of record; some program sites still track attendance on paper before entering it later.',
      q6_system_integration: 'some_share',
      q7_integration_familiarity: 'somewhat_familiar',
      q8_quality_confidence: 'mixed',
      q9_current_decisions: 'Program managers pull monthly completion reports from Salesforce to see which sites are lagging.',
      q10_wished_decisions: "We wish we could flag at-risk participants early enough to actually intervene, not just report on dropouts after the fact.",
      q11_decision_empowerment: 'leadership_managers',
      q12_reporting_to: 'Board quarterly, two major funders annually',
      q13_reporting_automation: 'semi_automated',
      q14_tools: ['crm_case_tool'] as CsaTool[],
      q15_staff_confidence: 'some_adhoc',
      q16_budget_speed: 'requires_approval',
      q17a_wish_list: 'A working early-warning model our program managers actually trust and use.',
      q17b_biggest_worry: "That a model will flag kids unfairly based on factors staff can't act on.",
      q18_past_blockers: 'A previous attempt stalled because nobody owned maintaining the model after the volunteer team rolled off.',
    },
  },
  {
    id: 'demo-scout-2',
    ageSeconds: 43200,
    intake: {
      org_name: 'Riverside Family Services',
      contact_name_role: 'Tom Reyes, Development Manager',
      contact_email: 'tom@riversidefamily.org',
      mission: 'We connect low-income families in Queens with housing and legal aid services.',
      scale: '~1200 families/year, staff of 12',
      primary_need: 'ml_predictive' as PrimaryNeed,
      problem_description: 'We really just need a dashboard that shows our board members quarterly funding numbers.',
      current_systems: 'A mix of spreadsheets and an old Access database.',
      timeline: 'Before our next board meeting in October.',
      referral_source: 'Google search',
    },
    csa: {
      q1_org_context: 'Riverside Family Services connects low-income Queens families with housing and legal aid, serving ~1200 families/year with a staff of 12.',
      q2_org_size: '12 staff, ~1200 families/year',
      q3_poc: 'Tom Reyes, Development Manager',
      q4_collection_scope: 'partial',
      q5_data_locations: "Case data lives in a case-management tool; funding and outcomes data sits in spreadsheets and an old Access database that nothing else connects to.",
      q6_system_integration: 'own_island',
      q7_integration_familiarity: 'somewhat_familiar',
      q8_quality_confidence: 'mixed',
      q9_current_decisions: "Program staff use the case tool day-to-day; leadership makes funding decisions from whatever spreadsheet is most recently updated.",
      q10_wished_decisions: 'We wish the board could see live numbers instead of whatever a staffer manually pulled together the week before.',
      q11_decision_empowerment: 'anyone_with_access',
      q12_reporting_to: 'Board quarterly',
      q13_reporting_automation: 'none_manual',
      q14_tools: ['crm_case_tool', 'reporting_analytics'] as CsaTool[],
      q15_staff_confidence: 'dedicated_staff',
      q16_budget_speed: 'fast',
      q17a_wish_list: "One dashboard leadership and the board both trust, instead of three versions of the truth.",
      q17b_biggest_worry: "That we'll build a nice dashboard on top of data that's wrong because our systems don't talk to each other.",
      q18_past_blockers: 'The case tool and the funding spreadsheets have never been connected — every attempt to reconcile them has been done by hand and abandoned.',
    },
  },
  {
    id: 'demo-scout-3',
    ageSeconds: 3600,
    intake: {
      org_name: 'Queens Neighborhood Kitchen',
      contact_name_role: 'Sam',
      contact_email: 'sam@qnkitchen.org',
      mission: 'We run a small community food pantry.',
      scale: 'All-volunteer, 2 people, ~50 families/year',
      primary_need: 'analyze_data' as PrimaryNeed,
      problem_description: 'We want to understand our community better and use data more.',
      current_systems: 'Just a shared Google spreadsheet.',
      timeline: 'Not sure yet.',
      referral_source: 'Word of mouth',
    },
    csa: {
      q1_org_context: 'Queens Neighborhood Kitchen is an all-volunteer community food pantry serving about 50 families a year.',
      q2_org_size: '2 volunteers, no paid staff',
      q3_poc: 'Sam',
      q4_collection_scope: 'not_systematic',
      q5_data_locations: "A single shared Google spreadsheet that whoever is volunteering that week updates, sometimes.",
      q6_system_integration: 'own_island',
      q7_integration_familiarity: 'not_familiar',
      q8_quality_confidence: 'not_confident',
      q9_current_decisions: "Nothing formal — we just remember who's come by before.",
      q10_wished_decisions: "We'd like to know which families we're actually reaching and who we might be missing.",
      q11_decision_empowerment: 'not_from_data',
      q12_reporting_to: 'No formal reporting yet — this is mostly word of mouth in the neighborhood.',
      q13_reporting_automation: 'none_manual',
      q14_tools: ['spreadsheets'] as CsaTool[],
      q15_staff_confidence: 'low_comfort',
      q16_budget_speed: 'case_by_case',
      q17a_wish_list: 'Just knowing, reliably, who we\'ve served and how often would feel like a huge step.',
      q17b_biggest_worry: "That any new tool will be one more thing two volunteers don't have time to maintain.",
      q18_past_blockers: "We've never had anyone with the time or background to set anything up.",
    },
  },
  {
    id: 'demo-scout-4',
    ageSeconds: 200000,
    intake: {
      org_name: 'Sunset Park Senior Center',
      contact_name_role: 'Linda Chen, Executive Director',
      contact_email: 'linda@sunsetparkseniors.org',
      mission: 'We provide meals, health screenings, and social programming for seniors in Sunset Park, Brooklyn.',
      scale: '~50 staff, serving 2,500+ seniors/year',
      primary_need: 'analyze_data' as PrimaryNeed,
      problem_description: 'We want to analyze program outcomes and produce a clear quarterly insight report our board and funders can actually use to see trends across our meal, health, and social programs.',
      current_systems: 'Salesforce CRM integrated with a Tableau reporting layer that most program leads already use.',
      timeline: 'Q1 2027, ahead of our annual funder renewal cycle.',
      referral_source: 'Referred by a current DSSG partner organization',
    },
    csa: {
      q1_org_context: 'Sunset Park Senior Center runs meals, health screenings, and social programming for seniors in Sunset Park, Brooklyn — about 50 staff serving 2,500+ seniors a year.',
      q2_org_size: '~50 staff, 2,500+ seniors/year',
      q3_poc: 'Linda Chen, Executive Director',
      q4_collection_scope: 'systematic',
      q5_data_locations: 'Salesforce CRM is the single system of record across all three program areas, feeding a shared Tableau layer.',
      q6_system_integration: 'most_share_auto',
      q7_integration_familiarity: 'very_familiar',
      q8_quality_confidence: 'very_confident',
      q9_current_decisions: 'Program leads already use live Tableau dashboards to manage caseloads and staffing week to week.',
      q10_wished_decisions: 'We want the board and funders making renewal decisions off the same live data our program leads already trust.',
      q11_decision_empowerment: 'anyone_with_access',
      q12_reporting_to: 'Board quarterly, five institutional funders annually',
      q13_reporting_automation: 'mostly_automated',
      q14_tools: ['crm_case_tool', 'reporting_analytics'] as CsaTool[],
      q15_staff_confidence: 'dedicated_staff',
      q16_budget_speed: 'fast',
      q17a_wish_list: 'A funder-facing version of our internal dashboards, ready before renewal season every year without a manual scramble.',
      q17b_biggest_worry: 'That a board-facing report oversimplifies the story our program leads know is more nuanced.',
      q18_past_blockers: 'Nothing structural — this has mostly been a matter of prioritizing the board-facing layer over internal tooling.',
    },
  },
  {
    id: 'demo-scout-5',
    ageSeconds: 500000,
    intake: {
      org_name: 'East Harlem Tutoring Collective',
      contact_name_role: 'Devon Price, Founder',
      contact_email: 'devon@ehtutoring.org',
      mission: 'We organize free after-school tutoring across five community sites in East Harlem.',
      scale: '~35 volunteer tutors, ~300 students/year across 5 sites',
      primary_need: 'organize_data' as PrimaryNeed,
      problem_description: "Each of our five tutoring sites keeps its own attendance and progress records, and none of it is consolidated, so we can't see the full picture of how a student is doing across sites or organize a clean handoff when a student switches locations.",
      current_systems: 'Each site uses its own mix of paper sign-in sheets and personal spreadsheets — nothing is shared or standardized.',
      timeline: 'Before the next school year starts in September.',
      referral_source: 'DSSG NYC volunteer newsletter',
    },
    csa: {
      q1_org_context: 'East Harlem Tutoring Collective organizes free after-school tutoring across five community sites, run by about 35 volunteer tutors serving 300 students a year.',
      q2_org_size: '35 volunteer tutors, no paid staff, 5 sites',
      q3_poc: 'Devon Price, Founder',
      q4_collection_scope: 'systematic',
      q5_data_locations: "Each of the five sites runs its own instance of a case-management tool with built-in reporting — solid within a site, but the five instances never talk to each other.",
      q6_system_integration: 'own_island',
      q7_integration_familiarity: 'very_familiar',
      q8_quality_confidence: 'very_confident',
      q9_current_decisions: "Site coordinators already make day-to-day tutoring decisions confidently from their own site's data.",
      q10_wished_decisions: "We want to see a student's full history if they move between sites, which we can't do today.",
      q11_decision_empowerment: 'anyone_with_access',
      q12_reporting_to: 'A shared quarterly update to our fiscal sponsor',
      q13_reporting_automation: 'mostly_automated',
      q14_tools: ['crm_case_tool', 'reporting_analytics'] as CsaTool[],
      q15_staff_confidence: 'dedicated_staff',
      q16_budget_speed: 'fast',
      q17a_wish_list: "One shared record per student, no matter which site they're tutored at.",
      q17b_biggest_worry: 'That connecting the sites\' systems becomes a bigger project than five volunteer coordinators can maintain.',
      q18_past_blockers: "Every site set up its own system early on and nobody's had the bandwidth to unify them since.",
    },
  },
];

/**
 * Still-pending intakes — separate from ORG_SEEDS above, which are all
 * already reviewed/graduated. These exist so Review Queue has fresh material
 * to demo Approve/Edit/Redirect against, spanning a clean auto-bucket case,
 * a "something else" case (no auto-bucket, needs manual assignment), and a
 * Q6/Q7 mismatch case (Scout re-bucketed, worth a second look).
 */
const PENDING_ORG_SEEDS: { id: string; ageSeconds: number; intake: OrgSeed['intake'] & { primary_need_other?: string } }[] = [
  {
    id: 'demo-scout-6',
    ageSeconds: 7200,
    intake: {
      org_name: 'Bed-Stuy Reads',
      contact_name_role: 'Angela Brooks, Executive Director',
      contact_email: 'angela@bedstuyreads.org',
      mission: 'We run community literacy programs and book drives for children in Bedford-Stuyvesant.',
      scale: '~800 children/year, staff of 9',
      primary_need: 'analyze_data' as PrimaryNeed,
      problem_description: 'We want to analyze reading level improvements across our programs and identify which interventions actually move the needle, using the assessment data we already collect each semester.',
      current_systems: 'A custom-built reporting database that our part-time data volunteer maintains.',
      timeline: 'Ideally starting next month, ahead of our spring literacy report.',
      referral_source: 'NYC nonprofit data slack',
    },
  },
  {
    id: 'demo-scout-7',
    ageSeconds: 14400,
    intake: {
      org_name: 'Bronx Community Fridge Network',
      contact_name_role: 'Jordan Lee, Coordinator',
      contact_email: 'jordan@bxfridges.org',
      mission: 'We maintain a network of community fridges across the Bronx providing free food access.',
      scale: '12 fridge sites, ~15 volunteer stewards',
      primary_need: 'something_else' as PrimaryNeed,
      primary_need_other: 'We just want someone to help us figure out what kind of data work would even help us.',
      problem_description: "Honestly we're not sure what's possible — we just know we're flying blind on which fridges run empty most often.",
      current_systems: 'A group chat where stewards report fridge status.',
      timeline: 'No specific deadline.',
      referral_source: 'Instagram',
    },
  },
  {
    id: 'demo-scout-8',
    ageSeconds: 1800,
    intake: {
      org_name: 'Financial District Volunteer Legal Clinic',
      contact_name_role: 'Priya Shah, Clinic Director',
      contact_email: 'priya@fidivlc.org',
      mission: 'We provide free legal consultations to low-income NYC residents facing eviction.',
      scale: '~600 consultations/year, staff of 6, ~40 volunteer attorneys',
      primary_need: 'ml_predictive' as PrimaryNeed,
      problem_description: 'We want an app that helps volunteer attorneys track case status and automatically send reminder emails to clients.',
      current_systems: 'Paper intake forms and a shared email inbox.',
      timeline: 'Whenever it can be built, no rush.',
      referral_source: 'Bar association newsletter',
    },
  },
];

function buildPendingIntake(seed: typeof PENDING_ORG_SEEDS[number]): ScoutIntake {
  const routing = routeScoutIntake(seed.intake);
  return {
    id: seed.id,
    org_name: seed.intake.org_name,
    contact_name_role: seed.intake.contact_name_role,
    contact_email: seed.intake.contact_email,
    mission: seed.intake.mission,
    scale: seed.intake.scale,
    primary_need: seed.intake.primary_need,
    primary_need_other: seed.intake.primary_need_other,
    problem_description: seed.intake.problem_description,
    current_systems: seed.intake.current_systems,
    timeline: seed.intake.timeline,
    referral_source: seed.intake.referral_source,
    submittedAt: { seconds: Date.now() / 1000 - seed.ageSeconds },
    ...routing,
    reviewStatus: 'pending',
  };
}

function buildReviewedIntake(seed: OrgSeed): ScoutIntake {
  const routing = routeScoutIntake(seed.intake);
  const finalBucket = routing.bucket!; // every seed org has a concrete primary_need, never 'something_else'
  return {
    id: seed.id,
    org_name: seed.intake.org_name,
    contact_name_role: seed.intake.contact_name_role,
    contact_email: seed.intake.contact_email,
    mission: seed.intake.mission,
    scale: seed.intake.scale,
    primary_need: seed.intake.primary_need,
    problem_description: seed.intake.problem_description,
    current_systems: seed.intake.current_systems,
    timeline: seed.intake.timeline,
    referral_source: seed.intake.referral_source,
    submittedAt: { seconds: Date.now() / 1000 - seed.ageSeconds },
    ...routing,
    reviewStatus: 'reviewed',
    reviewAction: 'approved',
    finalBucket,
    reviewedBy: DEMO_USER.uid,
    reviewedByEmail: DEMO_USER.email,
    reviewedAt: { seconds: Date.now() / 1000 - seed.ageSeconds + 3600 },
    onboardingKit: getOnboardingKitName(finalBucket),
  };
}

function buildAssessment(seed: OrgSeed, intake: ScoutIntake): ArchitectAssessment {
  const bucket = intake.finalBucket!;
  const maturity = scoreAssessment(seed.csa, bucket);
  const genInput: PlanGenerationInput = {
    orgName: intake.org_name,
    bucket,
    maturity,
    q1_org_context: seed.csa.q1_org_context,
    q9_current_decisions: seed.csa.q9_current_decisions,
    q10_wished_decisions: seed.csa.q10_wished_decisions,
    q17a_wish_list: seed.csa.q17a_wish_list,
    q17b_biggest_worry: seed.csa.q17b_biggest_worry,
    q18_past_blockers: seed.csa.q18_past_blockers,
  };

  return {
    id: seed.id,
    scoutIntakeId: seed.id,
    org_name: intake.org_name,
    scoutBucket: bucket,
    scoutConfidence: intake.confidence,
    scoutReadiness: intake.composite_signal,
    q1_org_context: seed.csa.q1_org_context,
    q2_org_size: seed.csa.q2_org_size,
    q3_poc: seed.csa.q3_poc,
    q4_collection_scope: seed.csa.q4_collection_scope,
    q5_data_locations: seed.csa.q5_data_locations,
    q6_system_integration: seed.csa.q6_system_integration,
    q7_integration_familiarity: seed.csa.q7_integration_familiarity,
    q8_quality_confidence: seed.csa.q8_quality_confidence,
    q9_current_decisions: seed.csa.q9_current_decisions,
    q10_wished_decisions: seed.csa.q10_wished_decisions,
    q11_decision_empowerment: seed.csa.q11_decision_empowerment,
    q12_reporting_to: seed.csa.q12_reporting_to,
    q13_reporting_automation: seed.csa.q13_reporting_automation,
    q14_tools: seed.csa.q14_tools,
    q15_staff_confidence: seed.csa.q15_staff_confidence,
    q16_budget_speed: seed.csa.q16_budget_speed,
    q17a_wish_list: seed.csa.q17a_wish_list,
    q17b_biggest_worry: seed.csa.q17b_biggest_worry,
    q18_past_blockers: seed.csa.q18_past_blockers,
    ...maturity,
    charter: generateCharter(genInput),
    ninetyDayPlan: generateNinetyDayPlan(genInput),
    createdBy: DEMO_USER.uid,
    createdByEmail: DEMO_USER.email,
    createdAt: { seconds: Date.now() / 1000 - seed.ageSeconds + 7200 },
    updatedAt: { seconds: Date.now() / 1000 - seed.ageSeconds + 7200 },
  };
}

export const DEMO_INTAKES: ScoutIntake[] = [
  ...ORG_SEEDS.map(buildReviewedIntake),
  ...PENDING_ORG_SEEDS.map(buildPendingIntake),
];

const DEMO_INTAKES_BY_ID = new Map(DEMO_INTAKES.map(i => [i.id, i]));

let seeded = false;
function seedDemoData() {
  if (seeded) return;
  seeded = true;

  ORG_SEEDS.forEach((seed) => {
    const intake = DEMO_INTAKES_BY_ID.get(seed.id)!;
    const assessment = buildAssessment(seed, intake);
    demoAssessments.set(assessment.id, assessment);

    const businessId = businessIdForAssessment(assessment.id);
    if (!demoBusinesses.has(businessId)) {
      demoBusinesses.set(businessId, buildGraduatedBusiness(assessment, DEMO_USER.uid));
      demoEngagements.set(businessId, [buildGraduationEngagement(businessId, DEMO_USER.uid)]);
    }
  });
}

// Runs once, the first time anything imports this module (Review Queue,
// Ongoing Projects, or Dashboard) — no separate init call needed.
seedDemoData();
