/**
 * What the funnel needs, and how a set of environment values is judged against
 * it. Pure: no `process.env` read, no `server-only`, so Node's own runner can
 * execute it and `readiness.test.mts` can census it against the tree.
 *
 * Split out of `readiness.ts` on 20 September 2026. That file was one of the
 * source files named by no test, and the defect in it was not in any of its
 * assertions - it was in the list. A check whose whole job is "everything the
 * funnel needs" is only ever as good as its denominator, and nothing anywhere
 * compared the list to the variables the code actually reads.
 */

export type Requirement = { key: string; why: string };

/** Without any one of these a scan cannot be completed at all. */
export const REQUIRED: Requirement[] = [
  { key: "SUPABASE_URL", why: "where scans are stored" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", why: "server-side database access" },
  { key: "ANTHROPIC_API_KEY", why: "reads the site and writes the questions" },
  { key: "DATAFORSEO_LOGIN", why: "asks the engines" },
  { key: "DATAFORSEO_PASSWORD", why: "asks the engines" },
  { key: "IP_HASH_SALT", why: "the per-IP limit will not run without it" },
];

/**
 * Turnstile is only enforced in production, matching verifyTurnstile. Without
 * the secret every live submission would be refused, so in production it is
 * part of being ready rather than an optional extra.
 */
export const PRODUCTION_ONLY: Requirement[] = [
  { key: "TURNSTILE_SECRET_KEY", why: "verifies the bot check server side" },
  { key: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", why: "renders the bot check" },
];

/** Not needed to run a scan, but the funnel leaks without them. */
export const RECOMMENDED: Requirement[] = [
  { key: "RESEND_API_KEY", why: "sign-up notifications and the contact form" },
  /**
   * Added 20 September 2026, having been read by four senders and named by no
   * list. Every one of them falls back to `alwayscited <onboarding@resend.dev>`
   * - a domain this project does not own - so with `RESEND_API_KEY` set and
   * this one unset, `scanReadiness()` reported ready with nothing missing while
   * the unlock email, the verification email and both form notifications went
   * out from somebody else's domain. The unlock email is the thing an address
   * is traded for, which makes it the worst one on the list to get wrong
   * silently.
   */
  { key: "SCAN_FROM_EMAIL", why: "the address our own mail is sent from" },
  { key: "CONTACT_EMAIL_DESTINATION", why: "where the contact form and waitlist land" },
  /**
   * The cron routes fail shut with a 503 when this is unset, which is the right
   * refusal and is tested. What it costs is the reaper: a scan that stalls then
   * stays at `running` for ever, and the result screen polls that status every
   * 2.5 seconds with no end.
   */
  { key: "CRON_SECRET", why: "the stall reaper and the purge job refuse to run without it" },
  { key: "ADMIN_USER", why: "/admin/scans stays shut without it" },
  { key: "ADMIN_PASSWORD", why: "/admin/scans stays shut without it" },
  /** 25 Sep 2026. Unset, every placement reads "Not scored"; nothing else changes. */
  { key: "FATGRID_API_KEY", why: "scores how hard each placement is to land" },
  /** 29 Sep 2026 (R91). Unset, /api/checkout sends every buyer to "Book a call" instead of Stripe. */
  { key: "STRIPE_SECRET_KEY", why: "opens a live Stripe Checkout; without it checkout falls back to a call" },
  /** 30 Sep 2026 (BRIEF-3 C4). Unset, /api/stripe/webhook answers 503 and no paid checkout becomes a client. */
  { key: "STRIPE_WEBHOOK_SECRET", why: "verifies Stripe's webhook; without it a paid checkout sets nothing up" },
];

/**
 * Read somewhere under `src` and deliberately not a readiness requirement.
 * Named rather than merely absent, so that the census in `readiness.test.mts`
 * has to be told about a new variable instead of quietly not noticing it.
 */
export const NOT_REQUIRED: Record<string, string> = {
  NODE_ENV: "set by the runtime, never by us",
  VERCEL_ENV: "set by the platform",
  VERCEL_REGION: "set by the platform",
  VERCEL_GIT_COMMIT_SHA: "set by the platform",
  VERCEL_GIT_COMMIT_REF: "set by the platform",
  NEXT_PUBLIC_SITE_URL: "falls back to the canonical origin in config/schema.ts, which is the real value",
  // M1 (6 Oct 2026): the dashboard's own host. Unset is the behaviour the
  // site has always had - every path under /app, on the marketing host - so
  // nothing is unready without it, and it is deliberately absent until the
  // domain is added in Vercel (D1/D2 of the host-move brief).
  APP_HOST: "optional: unset means the dashboard stays at /app on the marketing host",
  // 13 Oct 2026: read by components/DplGuard.tsx, which the build replaces
  // with the deployment id Vercel sets; a build without one renders nothing.
  NEXT_DEPLOYMENT_ID: "set by the platform at build; absent means no deployment-id guard is needed",
};

/**
 * Present means a value with something in it.
 *
 * The check was `!process.env[key]`, which reads a single pasted space as a
 * value. That is not a hypothetical shape: these are set by hand in a dashboard
 * and a trailing blank line or a stray space is the commonest way one goes
 * wrong. A whitespace-only credential reported ready and then failed auth on
 * every call - the funnel live, the domain field accepting a brand, and the
 * scan dying at the reading step, which is the exact outcome the doc comment on
 * this module says it exists to prevent.
 */
export function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export type Readiness = {
  ready: boolean;
  missingRequired: Requirement[];
  missingRecommended: Requirement[];
};

export function readinessOf(env: Record<string, string | undefined>, isProduction: boolean): Readiness {
  const missing = (list: Requirement[]) => list.filter((r) => !isSet(env[r.key]));
  const required = [...REQUIRED, ...(isProduction ? PRODUCTION_ONLY : [])];
  const missingRequired = missing(required);
  return {
    ready: missingRequired.length === 0,
    missingRequired,
    missingRecommended: missing(RECOMMENDED),
  };
}
