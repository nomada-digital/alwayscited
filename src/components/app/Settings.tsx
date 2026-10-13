import SubmitButton from "@/components/app/SubmitButton";
import TierName, { type TierKey } from "@/components/TierName";
import { APP_LIMITS } from "@/config/contact";
import { TRACKED_PRICE } from "@/config/pricing";
import { trialMoment, trialStatus } from "@/config/trial";
import { T } from "@/config/tokens";
import type { DiyUsage } from "@/lib/diy/core/usage-meter";
import type { UpsellMode } from "@/lib/tracking/ask";
import { checkTime, nextCheckAt } from "@/lib/tracking/check-time";
import { addDays, formatDay } from "@/lib/tracking/figures";
import { KEYWORDS_PER_CLUSTER, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import type { Member } from "@/lib/tracking/settings-data";
import { inviteChoice, removeLine, scopeLine } from "@/lib/tracking/team";

/**
 * Settings (R142 part 1, 1 Oct 2026; BRIEF-4 P2). No board: the Clusters
 * page's shell - title block, bordered sections at 18px, hairlines. Account
 * is read-only for everyone. Team is read-only for editors and viewers; an
 * owner invites, changes a role and removes (part 2), each a plain form posted
 * to /api/app/[client]/member, with "Remove" behind a <details> confirm.
 * Part 3: "Ask us to change these" and Billing's "Ask us" post to the ask
 * route (`about`); Billing is owners only and, until the Stripe portal is
 * checked (blocked.md), says who handles billing; "Sign out of every device"
 * posts `everywhere=1` to logout. Everything here is server drawn, so it all works
 * with JS off.
 */

const SECTION = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", overflow: "hidden" } as const;
const HEAD = { margin: 0, padding: "18px 24px", fontSize: "16px", fontWeight: 700, color: T.ink } as const;
// Each row carries the rule above it, so the head needs none of its own.
const ROW = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 24px", flexWrap: "wrap", padding: "14px 24px", borderTop: `1px solid ${T.line}`, fontSize: "14px" } as const;

/** A London calendar day from a timestamp, as the rest of /app writes days. */
const dayOf = (iso: string) => formatDay(new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" }), true);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const BUTTON = { height: "40px", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "13px", fontWeight: 600, cursor: "pointer" } as const;
const DARK = { ...BUTTON, border: 0, background: T.ink, color: T.surface } as const;
const RADIO = { width: "18px", height: "18px", margin: 0, accentColor: T.accent, cursor: "pointer", flexShrink: 0 } as const;
const FIELD = { height: "40px", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "14px", boxSizing: "border-box" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={ROW}>
      <span style={{ color: T.soft }}>{label}</span>
      <span style={{ color: T.ink, fontWeight: 600, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

/**
 * "This month's research" (13 Oct 2026, DIY P9; spec 10 section 4.13). Every member sees it. Counts only: "Page
 * checks: 3 of 30 used", "Pursuing: 4 of 10", then when the monthly ones reset. A count that could not be read is
 * said as such. While DIY is off, the paid-read counts (page checks, drafted examples, link checks) are left out,
 * as every DIY section that exists only because of a paid read is (spec 10 section 4, the dark rule).
 */
function Research({ usage }: { usage: DiyUsage | { failed: true } }) {
  if ("failed" in usage) {
    return (
      <section aria-labelledby="set-research" style={SECTION} data-research="failed">
        <h2 id="set-research" style={HEAD}>This month&apos;s research</h2>
        <p style={{ ...ROW, margin: 0, color: T.soft }}>We couldn&apos;t read this part just now. The rest of the page is up to date.</p>
      </section>
    );
  }
  const rows = usage.rows.filter((r) => usage.enabled || r.key === "pursuits");
  const monthly = rows.some((r) => r.period === "month");
  return (
    <section aria-labelledby="set-research" style={SECTION} data-research={usage.enabled ? "on" : "dark"}>
      <h2 id="set-research" style={HEAD}>This month&apos;s research</h2>
      {rows.map((r) => (
        <Row key={r.key} label={r.label}>
          <span data-usage-row={r.key}>{r.used === null ? "Not read just now" : `${r.used} of ${r.limit}${r.key === "page_checks" ? " used" : ""}`}</span>
        </Row>
      ))}
      <p style={{ ...ROW, margin: 0, color: T.soft, fontSize: "13px" }}>
        {monthly ? `Resets ${usage.resetsLabel}. ` : ""}Pursuing counts the pages in Pursuing or Pitched now.
      </p>
    </section>
  );
}

export default function Settings({
  domain,
  brand,
  market,
  tier,
  clusterLimit,
  clustersInUse,
  startedOn,
  today,
  aliases,
  members,
  email,
  mode,
  slug,
  owner,
  toast,
  inviteError = null,
  keep = "",
  trialEndsAt = null,
  trialCancelledAt = null,
  ended = false,
  livePrompts = 1,
  accountClients = 1,
  scoping = true,
  research = null,
}: {
  /**
   * This month's research (13 Oct 2026, DIY P9; spec 10 section 4.13): the DIY allowances' counts, never dollars,
   * from P1's loadDiyUsage. Null draws nothing (no DIY read for this page); a row whose count could not be read says
   * so and never reads as 0. While DIY is off only Pursuing shows: the other counts exist only because of paid reads.
   */
  research?: DiyUsage | { failed: true } | null;
  /**
   * Clients on this account (AG-1, 9 Oct 2026). With two or more, owners see
   * which clients each member sees, Remove says what it takes, and the invite
   * asks: this client only (the default) or every client. With one, the
   * invite is this client only and says so (review, 9 Oct). It replaced the
   * 8 Oct line saying everyone saw every client (audit security-2).
   */
  accountClients?: number;
  /** False while dashboard_member_clients is not there yet: every member sees every client, so the invite is to every client and says so (team.ts inviteChoice). */
  scoping?: boolean;
  /** client_domains.status is ended, and how many prompts are live: neither gets "Tomorrow at" a check time (8 Oct 2026, audit activation-4/5). */
  ended?: boolean;
  livePrompts?: number;
  domain: string;
  brand: string | null;
  market: string;
  tier: TierKey;
  clusterLimit: number;
  clustersInUse: number;
  startedOn: string | null;
  /** repo.today(), so a first check still to come is not read as history (DS56). */
  today: string;
  aliases: string[];
  members: Member[];
  /** The signed-in member, for "You". */
  email: string;
  mode: UpsellMode;
  slug: string;
  /** The signed-in member is an owner: the team forms are drawn. */
  owner: boolean;
  /** team.ts teamToast's words, or null. */
  toast: string | null;
  /** team.ts inviteRefusal's words: drawn on the open invite form, just above its email field (R151, 3 Oct 2026). */
  inviteError?: string | null;
  /** The stated range as rangeQuery's "?from=&to=&compare=" or "" (DS40): the team and ask forms post it so their 303 keeps it. */
  keep?: string;
  /** The alwaystracked trial (8 Oct 2026): client_domains.trial_ends_at and trial_cancelled_at. */
  trialEndsAt?: string | null;
  trialCancelledAt?: string | null;
}) {
  const action = `/api/app/${encodeURIComponent(slug)}/member${keep}`;
  const askAction = `/api/app/${encodeURIComponent(slug)}/ask${keep}`;
  const owners = members.filter((m) => m.role === "owner").length;
  const choice = inviteChoice(accountClients, scoping, domain);
  const names = [brand?.trim() || domain, ...aliases.filter((a) => a !== brand)];
  const trial = ended ? null : trialStatus({ trialEndsAt, cancelled: Boolean(trialCancelledAt), market, price: TRACKED_PRICE });
  // A cancelled trial whose end comes before the next run (the cron's hour, check-time.ts) has no next check (review of 2379757).
  const trialStopsFirst = Boolean(trialCancelledAt && trialEndsAt && Date.parse(trialEndsAt) <= nextCheckAt(Date.now()));
  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0, maxWidth: "880px" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Settings</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft }}>Your plan, the names we match and who can see this dashboard.</p>
      </header>
      {toast ? (
        <p role="status" style={{ margin: 0, padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, alignSelf: "flex-start", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "anywhere" }}>
          {toast}
        </p>
      ) : null}

      <section aria-labelledby="set-account" style={SECTION}>
        <h2 id="set-account" style={HEAD}>Account</h2>
        <Row label="Client domain">{domain}</Row>
        <Row label="Market">{market === "UK" ? "UK" : "US"}</Row>
        <Row label="Plan">
          {/* agency mode names no nomada tier (BRIEF-4 rules). */}
          {mode === "agency" ? null : (
            <>
              <TierName tier={tier} />
              {", "}
            </>
          )}
          {`${clusterLimit} clusters: ${clusterLimit * PROMPTS_PER_CLUSTER} prompts and ${clusterLimit * KEYWORDS_PER_CLUSTER} Google keywords, checked daily`}
        </Row>
        {trial ? <Row label="Trial">{trial}</Row> : null}
        <Row label="Clusters in use">{`${clustersInUse} of ${clusterLimit}`}</Row>
        {/* DS56 (2 Oct 2026, R173 pass 6): signup sets started_on to the first check, tomorrow, so "since" read a day still to come. */}
        <Row label={startedOn && startedOn > today ? "Tracking from" : "Tracking since"}>{startedOn ? formatDay(startedOn, true) : "Not started yet"}</Row>
        <Row label="Next check">{ended ? "None - tracking has ended" : trialStopsFirst ? `None - the trial ends ${trialMoment(trialEndsAt!, market)}` : livePrompts ? `Tomorrow at ${checkTime(addDays(today, 1), market)}` : "Once a cluster has prompts"}</Row>
        <div style={{ ...ROW, flexDirection: "column", alignItems: "flex-start", gap: "10px" }}>
          <span style={{ color: T.soft }}>Names we match</span>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {names.map((n) => (
              <li key={n} style={{ padding: "4px 12px", borderRadius: "999px", background: T.chip, border: `1px solid ${T.line}`, fontSize: "13px", fontWeight: 600, color: T.ink }}>
                {n}
              </li>
            ))}
          </ul>
          <span style={{ fontSize: "13px", color: T.soft }}>We count an answer as naming you when it uses one of these.</span>
          {/* Nobody to ask with upsell_mode off (ask.ts askRecipient). */}
          {mode === "off" ? null : (
            <form method="post" action={askAction} style={{ margin: 0 }}>
              <input type="hidden" id="set-ask-aliases" name="about" value="aliases" />
              <SubmitButton busy="Sending..." style={BUTTON}>Ask us to change these</SubmitButton>
            </form>
          )}
        </div>
      </section>

      {research ? <Research usage={research} /> : null}

      <section aria-labelledby="set-team" style={SECTION}>
        <h2 id="set-team" style={HEAD}>Team</h2>
        {members.length === 0 ? (
          <p style={{ margin: 0, padding: "18px 24px", fontSize: "14px", color: T.soft }}>No members to show.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {members.map((m, i) => (
              <li key={m.email} className="set-member" style={{ ...ROW, alignItems: "center", flexWrap: owner ? "wrap" : "nowrap" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 auto" }}>
                  <span style={{ fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>
                    {m.name ?? m.email}
                    {m.email === email ? <span style={{ marginLeft: "8px", padding: "1px 8px", borderRadius: "999px", background: T.wash, border: `1px solid ${T.washLine}`, fontSize: "11px", fontWeight: 700 }}>You</span> : null}
                  </span>
                  {m.name ? <span style={{ fontSize: "13px", color: T.soft, overflowWrap: "anywhere" }}>{m.email}</span> : null}
                  {/* AG-1 (9 Oct 2026): owners see who sees which clients; nobody else is told how many the account has. */}
                  {owner && scopeLine(m.clients, accountClients, domain) ? <span className="set-scope" style={{ fontSize: "13px", color: T.soft, overflowWrap: "anywhere" }}>{scopeLine(m.clients, accountClients, domain)}</span> : null}
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px", fontSize: "13px", flexShrink: 0, textAlign: "right", marginLeft: "auto" }}>
                  <span style={{ fontWeight: 600, color: T.ink }}>{cap(m.role)}</span>
                  {/* DS68 (2 Oct 2026, R173 pass 8): the reader's own row read "You" over "Not signed in yet" when no sign-in date was recorded. */}
                  <span style={{ color: T.soft }}>{m.last_login_at ? `Last signed in on ${dayOf(m.last_login_at)}` : m.email === email ? "Signed in now" : "Not signed in yet"}</span>
                </span>
                {/* Owners change someone else's row; never their own, never the last owner. Owners are made in admin. */}
                {owner && m.email !== email && !(m.role === "owner" && owners <= 1) ? (
                  <span className="set-manage" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "8px", flexShrink: 0, marginLeft: "auto" }}>
                    {m.role !== "owner" ? (
                      <form method="post" action={action} style={{ margin: 0 }}>
                        <input type="hidden" id={`tm-role-op-${i}`} name="op" value="role" />
                        <input type="hidden" id={`tm-role-email-${i}`} name="email" value={m.email} />
                        <input type="hidden" id={`tm-role-role-${i}`} name="role" value={m.role === "editor" ? "viewer" : "editor"} />
                        <SubmitButton busy="Changing..." style={BUTTON}>{m.role === "editor" ? "Make viewer" : "Make editor"}</SubmitButton>
                      </form>
                    ) : null}
                    <details>
                      <summary style={{ ...BUTTON, display: "flex", alignItems: "center", listStyle: "none" }}>Remove</summary>
                      <form method="post" action={action} style={{ margin: "8px 0 0", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", textAlign: "right" }}>
                        <input type="hidden" id={`tm-rm-op-${i}`} name="op" value="remove" />
                        <input type="hidden" id={`tm-rm-email-${i}`} name="email" value={m.email} />
                        <span style={{ fontSize: "13px", color: T.soft, maxWidth: "260px" }}>{removeLine(m.clients, accountClients, domain)}</span>
                        <SubmitButton busy="Removing..." style={DARK}>Remove {m.name ?? m.email}</SubmitButton>
                      </form>
                    </details>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {owner ? (
          <details id="set-invite" className="set-invite" open={inviteError ? true : undefined} style={{ borderTop: `1px solid ${T.line}`, padding: "14px 24px", scrollMarginTop: "24px" }}>
            <summary style={{ ...BUTTON, display: "inline-flex", alignItems: "center", listStyle: "none" }}>Invite someone</summary>
            <form method="post" action={action} style={{ margin: "14px 0 0", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "12px" }}>
              <input type="hidden" id="tm-inv-op" name="op" value="invite" />
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: T.soft, flex: "1 1 240px" }}>
                Email
                <input
                  type="email"
                  id="tm-inv-email"
                  name="email"
                  required
                  maxLength={APP_LIMITS.email}
                  autoComplete="off"
                  aria-invalid={inviteError ? true : undefined}
                  aria-describedby={inviteError ? "tm-inv-error tm-inv-hint" : "tm-inv-hint"}
                  autoFocus={inviteError ? true : undefined}
                  style={{ ...FIELD, width: "100%" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: T.soft }}>
                Role
                <select name="role" defaultValue="editor" style={FIELD}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              {/* AG-1 (9 Oct 2026; review the same day): who the invitee will see, as inviteChoice words it. On an account with two or more clients the owner picks, this client only checked; otherwise one line says what the invite grants. */}
              {choice.ask ? (
                <fieldset style={{ flexBasis: "100%", margin: 0, padding: 0, border: 0, display: "flex", flexWrap: "wrap", gap: "8px 20px", fontSize: "14px", color: T.ink }}>
                  <legend style={{ padding: 0, marginBottom: "6px", fontSize: "13px", color: T.soft }}>Who they see</legend>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "24px", overflowWrap: "anywhere" }}>
                    <input type="radio" id="tm-inv-scope-client" name="scope" value="client" defaultChecked style={RADIO} />
                    {choice.ask.only}
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "24px" }}>
                    <input type="radio" id="tm-inv-scope-account" name="scope" value="account" style={RADIO} />
                    {choice.ask.every}
                  </label>
                </fieldset>
              ) : null}
              {choice.hidden ? <input type="hidden" id="tm-inv-scope" name="scope" value={choice.hidden} /> : null}
              {choice.line ? (
                <span id="tm-inv-scope-line" style={{ flexBasis: "100%", fontSize: "14px", color: T.ink, overflowWrap: "anywhere" }}>
                  {choice.line}
                </span>
              ) : null}
              <SubmitButton busy="Sending invite..." style={DARK}>Send invite</SubmitButton>
              {/* R151 (3 Oct 2026): the refusal on the form it is about (Baymard forms, inline errors; WCAG 2.2 3.3.1). The address is not carried back, so the field is empty. */}
              {inviteError ? (
                <span id="tm-inv-error" role="alert" style={{ flexBasis: "100%", order: -1, fontSize: "13px", fontWeight: 600, color: T.ink }}>
                  {inviteError}
                </span>
              ) : null}
              <span id="tm-inv-hint" style={{ flexBasis: "100%", fontSize: "13px", color: T.soft }}>Editors can add and stop prompts; viewers can only read. We email them; they sign in with that address.</span>
            </form>
          </details>
        ) : (
          // DS30 (R173 pass 2, "editable where rules allow, else the screen says why"): editors and viewers saw no team controls and no reason.
          <p style={{ margin: 0, borderTop: `1px solid ${T.line}`, padding: "14px 24px", fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
            Only owners can invite people, change a role or remove someone - ask one of them to make a change.
          </p>
        )}
      </section>

      {owner ? (
        <section aria-labelledby="set-billing" style={SECTION}>
          <h2 id="set-billing" style={HEAD}>Billing</h2>
          <div style={{ ...ROW, alignItems: "center" }}>
            <span style={{ color: T.soft }}>{mode === "agency" ? "Billing is handled by your account contact." : "Billing is handled directly by nomada digital."}</span>
            {mode === "nomada" ? (
              <form method="post" action={askAction} style={{ margin: 0 }}>
                <input type="hidden" id="set-ask-billing" name="about" value="billing" />
                <SubmitButton busy="Sending..." style={BUTTON}>Ask us</SubmitButton>
              </form>
            ) : null}
          </div>
          {/* "Cancel trial" (Danny, 8 Oct 2026): no Stripe portal, so it is here, behind a confirm like Remove, posted as a plain form. */}
          {trial && !trialCancelledAt && trialEndsAt ? (
            <div style={{ ...ROW, alignItems: "center" }}>
              <span style={{ color: T.soft }}>{`Your free trial ends ${trialMoment(trialEndsAt, market)}. Cancel before then and nothing is charged.`}</span>
              <details>
                <summary style={{ ...BUTTON, display: "flex", alignItems: "center", listStyle: "none" }}>Cancel trial</summary>
                <form method="post" action={`/api/app/${encodeURIComponent(slug)}/trial`} style={{ margin: "8px 0 0", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", textAlign: "right" }}>
                  <input type="hidden" id="set-trial-confirm" name="confirm" value="1" />
                  <span style={{ fontSize: "13px", color: T.soft, maxWidth: "260px" }}>{`Tracking carries on until ${trialMoment(trialEndsAt, market)}, then stops. You are not charged.`}</span>
                  <SubmitButton busy="Cancelling..." style={DARK}>Yes, cancel the trial</SubmitButton>
                </form>
              </details>
            </div>
          ) : null}
        </section>
      ) : trial ? (
        // 8 Oct 2026 (audit activation-12): an editor or viewer saw the trial and no way to act on it.
        <section aria-labelledby="set-billing" style={SECTION}>
          <h2 id="set-billing" style={HEAD}>Billing</h2>
          <p style={{ margin: 0, borderTop: `1px solid ${T.line}`, padding: "14px 24px", fontSize: "14px", lineHeight: 1.5, color: T.soft }}>
            {trialCancelledAt && trialEndsAt
              ? `An owner cancelled the trial. Tracking stops ${trialMoment(trialEndsAt, market)} and nothing is charged.`
              : "Only an owner can cancel the trial or ask us about billing - ask one of them."}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="set-out" style={SECTION}>
        <h2 id="set-out" style={HEAD}>Sign out</h2>
        <div style={ROW}>
          <span style={{ color: T.soft }}>Signed in as {email}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <form method="post" action="/api/app/logout" style={{ margin: 0 }}>
              <button type="submit" style={BUTTON}>
                Sign out
              </button>
            </form>
            <form method="post" action="/api/app/logout" style={{ margin: 0 }}>
              <input type="hidden" id="set-out-all" name="everywhere" value="1" />
              <button type="submit" style={BUTTON}>
                Sign out of every device
              </button>
            </form>
          </span>
        </div>
      </section>
    </div>
  );
}
