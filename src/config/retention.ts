/**
 * How long a tracked account's readings stay after its plan ends (Danny, 18 Oct 2026): 90 days. The plan-ended
 * email, the help centre and /legal all read this, so the promise is one number. Nothing in the tree deletes a
 * tracking_answers row (reading-retention.test.mts holds that), so the promise is a floor that holds.
 */
export const KEPT_DAYS = 90;
