import type { SupabaseClient } from "@supabase/supabase-js";

import { PAYMENT_BANNER_READ, type PaymentView, withPayment } from "../checkout/payment.ts";

import { scopesFrom, visibleClients } from "./scope.ts";

/**
 * Which clients a signed-in member may see, in one read (13 Oct 2026,
 * dashboard speed work). Every /app page and route starts here, through
 * member.ts clientsFor.
 *
 * Until today that was four reads, each waiting on the one before: the
 * memberships, then their scope (AG-1), then the clients on those accounts,
 * then BL-2's payment columns. Each is a PostgREST round trip, 55-120 ms on
 * production with tails to 950 ms, paid on every click before a page read
 * anything of its own. Now it is one read of dashboard_members that embeds
 * through the foreign keys: each live membership with its own live scope rows
 * (dashboard_member_clients.member_id) and its account's clients
 * (client_domains.account_id), the payment columns among them.
 *
 * The rules are the ones the four reads kept:
 *
 * - live memberships only (R141), and only clients with a slug;
 * - AG-1 (scope.ts): live scope rows only, and visibleClients decides - no
 *   rows is every client on the account, rows are exactly those clients. A
 *   member's scope comes back under that member's own row, so it can never
 *   limit or widen anyone else's;
 * - a failed read throws, so it is never read as "no clients", which would
 *   be a 404;
 * - BL-2: the payment columns cost only the banner. When the read with them
 *   fails it is made once more without them, and only a failure of that one
 *   throws.
 *
 * The client embed is hinted by its foreign key: `scans` also points at both
 * accounts and client_domains, so the hint keeps a later junction from making
 * the embed ambiguous, which PostgREST answers with an error.
 *
 * Plain module, relative imports, the database handed in: node --test runs
 * it (shell.test.mts).
 */

export type MemberClient = {
  id: string;
  slug: string;
  domain: string;
  brand: string | null;
  market: string;
  tier: string;
  started_on: string | null;
  question_limit: number;
  keyword_limit: number;
  /** BRIEF-3 C2: 10 plus 5 per pack, set by the webhook only. Absent in fixtures cut before clusters. */
  cluster_limit?: number;
  /** The alwaystracked trial (8 Oct 2026): when it ends, and when an owner cancelled it. Absent in fixtures. */
  trial_ends_at?: string | null;
  trial_cancelled_at?: string | null;
  /** client_domains.status: active, paused or ended (a cancelled subscription ends it). Absent in older fixtures. */
  status?: string;
} & Partial<PaymentView>;

/** What a page draws from the client row, account_id for AG-1's join, and created_at for the order. */
const CLIENT_COLUMNS = "id, account_id, slug, domain, brand_name, market, tier, started_on, question_limit, keyword_limit, cluster_limit, trial_ends_at, trial_cancelled_at, status, created_at";

/** The shell's read: memberships, each with its live scope and its account's clients, payment columns included. */
export const SHELL_READ = `id, account_id, role, dashboard_member_clients(client_domain_id), accounts(client_domains!client_domains_account_id_fkey(${CLIENT_COLUMNS}, ${PAYMENT_BANNER_READ}))`;

/** The same read without the payment columns, made only when the one with them failed (BL-2). */
export const SHELL_READ_UNPAID = `id, account_id, role, dashboard_member_clients(client_domain_id), accounts(client_domains!client_domains_account_id_fkey(${CLIENT_COLUMNS}))`;

type ShellRow = {
  id: unknown;
  account_id: unknown;
  role: unknown;
  dashboard_member_clients: { client_domain_id: unknown }[] | null;
  accounts: { client_domains: Record<string, unknown>[] | null } | { client_domains: Record<string, unknown>[] | null }[] | null;
};

const at = (r: Record<string, unknown>) => {
  const t = Date.parse(String(r.created_at ?? ""));
  return Number.isFinite(t) ? t : 0;
};

/** Every client this email may see, oldest first, with the member's role on it. Throws when it cannot be read. */
export async function readShell(db: SupabaseClient, email: string): Promise<(MemberClient & { role: string })[]> {
  const { data: paid, error: paidErr } = await db.from("dashboard_members").select(SHELL_READ).eq("email", email).is("removed_at", null).is("dashboard_member_clients.removed_at", null).not("accounts.client_domains.slug", "is", null);
  let read: unknown = paid;
  if (paidErr) {
    const { data: unpaid, error: unpaidErr } = await db.from("dashboard_members").select(SHELL_READ_UNPAID).eq("email", email).is("removed_at", null).is("dashboard_member_clients.removed_at", null).not("accounts.client_domains.slug", "is", null);
    if (unpaidErr) throw new Error(`could not read memberships: ${unpaidErr.message}`);
    console.warn(`[app] payment state not read, no payment banner: ${paidErr.message}`);
    read = unpaid;
  }
  const members = (read ?? []) as ShellRow[];
  const mine = members.map((m) => ({ id: String(m.id), account_id: String(m.account_id), role: String(m.role) }));
  // AG-1: the live scope rows, grouped by member as readScopes groups them.
  const scopes = scopesFrom(members.flatMap((m) => (m.dashboard_member_clients ?? []).map((s) => ({ member_id: m.id, client_domain_id: s.client_domain_id }))));
  // Oldest first across every account, as the separate read's order by created_at had them.
  const rows = members
    .flatMap((m) => (Array.isArray(m.accounts) ? m.accounts : m.accounts ? [m.accounts] : []).flatMap((a) => a.client_domains ?? []))
    .sort((a, b) => at(a) - at(b)) as { id: string; account_id: string; [k: string]: unknown }[];
  // Named fields only: account_id is used for the join and never returned.
  const clients = visibleClients(mine, scopes, rows).map(({ client: r, role }) => ({
    id: r.id,
    slug: r.slug as string,
    domain: r.domain as string,
    brand: r.brand_name as string | null,
    market: r.market as string,
    tier: r.tier as string,
    started_on: r.started_on as string | null,
    question_limit: r.question_limit as number,
    keyword_limit: r.keyword_limit as number,
    cluster_limit: r.cluster_limit as number,
    trial_ends_at: (r.trial_ends_at as string | null) ?? null,
    trial_cancelled_at: (r.trial_cancelled_at as string | null) ?? null,
    status: (r.status as string | null) ?? "active",
    role,
  }));
  return withPayment(clients, paidErr ? null : rows);
}
