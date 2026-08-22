import type {
  EnvoyDraft,
  EnvoyInput,
  EnvoyOccasion,
} from "../../types/envoy";

function cadenceLine(cadence?: string): string {
  return cadence
    ? `We'll keep to our agreed rhythm of ${cadence}.`
    : "We'll agree a check-in rhythm that suits you.";
}

function projectLine(planTitle?: string): string {
  return planTitle ? ` on ${planTitle}` : "";
}

const SIGN_OFF = "Best regards,\nThe DSSG team";

function greeting(orgName: string): string {
  return `Hi ${orgName} team,`;
}

export function generateEnvoyDraft(input: EnvoyInput): EnvoyDraft {
  const { occasion, orgName, planTitle, cadence, concerns } = input;

  let subject: string;
  let paragraphs: string[];

  switch (occasion) {
    case "kickoff":
      subject = planTitle
        ? `Kicking off ${planTitle}`
        : `Kicking off our work with ${orgName}`;
      paragraphs = [
        `We're glad to be getting started${projectLine(planTitle)}.`,
        cadenceLine(cadence),
        "If anything changes on your side, tell us early — it is much easier to adjust the plan than to work around it.",
      ];
      break;

    case "check_in":
      subject = planTitle
        ? `Checking in on ${planTitle}`
        : `Checking in with ${orgName}`;
      paragraphs = [
        `A quick check-in${projectLine(planTitle)} to see how things are going from where you sit.`,
        cadenceLine(cadence),
        "Anything you need from us before the next session?",
      ];
      break;

    case "milestone_reached":
      subject = planTitle
        ? `A milestone reached on ${planTitle}`
        : `A milestone reached with ${orgName}`;
      paragraphs = [
        `We've reached a milestone${projectLine(planTitle)} and wanted to mark it with you.`,
        "Thank you for the time your team has put in — that is what makes this work.",
        cadenceLine(cadence),
      ];
      break;

    case "at_risk_follow_up":
      subject = planTitle
        ? `Following up on ${planTitle}`
        : `Following up with ${orgName}`;
      paragraphs = [
        `We wanted to follow up${projectLine(planTitle)} and check how things are going.`,
        concerns?.length
          ? `From our side we noticed ${concerns.join(", ")}. That may be nothing at all — we would rather ask than assume.`
          : "We may have missed an update on our side — we would rather ask than assume.",
        "If something is blocking progress, let us know and we will work out the next step together.",
      ];
      break;

    case "wrap_up":
      subject = planTitle
        ? `Wrapping up ${planTitle}`
        : `Wrapping up our work with ${orgName}`;
      paragraphs = [
        `We're wrapping up our work${projectLine(planTitle)}.`,
        "Thank you for having us — we would value your honest read on what worked and what did not.",
        "If it would be useful to write up what came out of this, we will check with you before anything is shared publicly.",
      ];
      break;
  }

  return {
    engagementId: input.engagementId,
    occasion: occasion as EnvoyOccasion,
    subject,
    body: [greeting(orgName), "", paragraphs.join("\n\n"), "", SIGN_OFF].join(
      "\n",
    ),
    hitlTier: "L3",
  };
}
