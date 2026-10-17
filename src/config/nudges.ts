/**
 * When the dashboards host suggests the next plan up (Danny, 17 Oct 2026):
 * only when the client's own readings support it, one at a time, and never
 * again for 30 days once dismissed. Every threshold lives here, and
 * src/lib/dash/nudges.ts is the only reader.
 *
 * The defaults lean quiet. A nudge that fires on a client doing well is worse
 * than none: it reads as a sales banner, and Danny's rule is that alwayscited
 * is the plan most clients should stay on.
 */
export const NUDGES = {
  /** No nudge before this many daily readings: a week of answers moves around too much to judge on less. */
  minReadings: 5,
  /** A dismissed nudge stays away this long, per browser. */
  dismissDays: 30,

  /**
   * alwaystracked -> alwaysmentioned: AI rarely names the client. Either the
   * client is named in fewer than `maxNamedRate` of the answers given, or the
   * most-named competitor is named at least `competitorMultiple` times as often.
   */
  mentioned: { maxNamedRate: 0.25, competitorMultiple: 2 },

  /**
   * alwaysmentioned -> alwayscited: the engines name the client but rarely
   * cite its site, AND Google does not rank it on page 1 for the cluster
   * keyword. Both, so a client who ranks well is never told it needs links.
   */
  cited: { maxCitedShare: 0.1, outsidePosition: 10 },

  /**
   * alwayscited -> alwayseverywhere: only with real scope. Either the account
   * tracks more than one market, or the client has been on alwayscited for
   * `minDaysOnPlan` days across `minManagedClusters`+ clusters and the top
   * competitor is still named `competitorMultiple` times as often - the
   * pattern brand PR moves and placements alone do not.
   */
  everywhere: { minMarkets: 2, minDaysOnPlan: 60, minManagedClusters: 3, competitorMultiple: 3 },

  /** An extra tracking pack is offered from this share of any allowance in use. */
  pack: { atShare: 0.8 },
} as const;
