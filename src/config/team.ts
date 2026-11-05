/**
 * The people behind alwayscited's clients, and where they talk (Danny, 5 Nov 2026). From 1 Dec Kev is customer
 * success manager for every client, on top of placements, and escalates to Danny in #alwayscited; Naz owns on-site
 * work on the alwayscited plan. Slack ids are not secrets - they identify, they do not authorise - so they live here,
 * in the repo; the bot token that posts with them is SLACK_BOT_TOKEN, set in Vercel by Danny, and lib/slack.ts
 * posts nothing until it exists.
 */
export const SLACK_CHANNEL = { name: "alwayscited", id: "C0BPDBA7M0U" } as const;

export const TEAM = {
  kev: { name: "Kev", email: "kev@nomadadigital.co.uk", slack: "U079E59PX0V", role: "Customer success and placements" },
  naz: { name: "Naz", slack: "U096LLURBBM", role: "On-site work" },
  danny: { name: "Danny", email: "danny@nomadadigital.co.uk", slack: "U077D6KPKA6", role: "Escalations" },
} as const;

/** The human point of contact on every tier. */
export const ACCOUNT_MANAGER = TEAM.kev;

/** A Slack mention of a team member: <@U...>. */
export const mention = (who: keyof typeof TEAM) => `<@${TEAM[who].slack}>`;
