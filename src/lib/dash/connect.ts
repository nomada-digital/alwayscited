/**
 * Connect your data, self serve (2 Nov 2026, Danny, sg-37). Windsor's own
 * connect link sends a customer to Windsor's sign-in, so instead the customer
 * adds our access address to their Search Console, Google Analytics 4 or Bing
 * Webmaster Tools, and "Check connection" asks Windsor whether the property is
 * now among the accounts our Windsor account can read (connect-io.ts).
 *
 * The pure half: which property ids to look for, what Windsor's answer means,
 * how pulled rows become search_console_queries rows, and the line for the
 * daily run-health mail when a customer has been stuck for a day. No imports,
 * so connect.test.mts runs it under node --test.
 *
 * One thing this cannot fix from here: Windsor answers only for the accounts
 * configured on its data sources ("Account x is not available. The configured
 * accounts are: ..."). If a new property only appears once it is ticked in
 * Windsor, the 24 hour line is how Danny hears about it.
 */

export type ConnectProvider = "gsc" | "ga4" | "bing";

/** The address the customer adds, the same for all three (team@, Danny's instruction of 2 Nov 2026). */
export const ACCESS_EMAIL = "team@nomadadigital.co.uk";

/** Windsor's connector for each provider. */
export const CONNECTOR: Record<ConnectProvider, string> = { gsc: "searchconsole", ga4: "googleanalytics4", bing: "bing_webmaster" };

/** A customer still not connected this long after their first check is in the morning mail to Danny. */
export const STALE_MS = 24 * 60 * 60 * 1000;

/** example.com from "https://www.Example.com/path", "sc-domain:example.com" or "example.com". */
export function bareDomain(input: string): string {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/\.$/, "");
}

/** A GA4 property id (digits) from what the customer typed, or null. A measurement id (G-...) is not one. */
export function gaPropertyId(input: unknown): string | null {
  const m = /^\s*(?:properties\/)?(\d{6,12})\s*$/.exec(String(input ?? ""));
  return m ? m[1] : null;
}

/** The Windsor account ids to try, most likely first. */
export function candidates(provider: ConnectProvider, domain: string, gaId?: string | null): string[] {
  if (provider === "ga4") return gaId ? [gaId] : [];
  const d = bareDomain(domain);
  if (!d) return [];
  const urls = [`https://${d}/`, `https://www.${d}/`, `http://${d}/`, `http://www.${d}/`];
  return provider === "gsc" ? [`sc-domain:${d}`, ...urls] : urls;
}

/**
 * Whether Windsor can read the account: a data array and no error. An account
 * it cannot read answers {"error": "Account ... is not available ..."}; one it
 * can read with nothing in the window answers {"data": []}, which still counts.
 */
export function windsorVisible(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as { data?: unknown; error?: unknown };
  return !b.error && Array.isArray(b.data);
}

/** Windsor's error text with the key taken out, short. */
export function windsorWhy(body: unknown, key: string): string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const why = String(b.error ?? b.detail ?? b.message ?? "no data in the answer");
  return (key ? why.split(key).join("***") : why).slice(0, 200);
}

export type QueryRow = {
  client_domain_id: string;
  provider: "gsc" | "bing";
  period_start: string;
  period_end: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * Windsor's rows for one window, summed per query and page, into
 * search_console_queries rows: the most impressions first, at most `cap`.
 * CTR is worked out again from the sums; position is the impression-weighted mean.
 */
export function queryRows(p: { clientId: string; provider: "gsc" | "bing"; from: string; to: string; rows: unknown[]; cap?: number }): QueryRow[] {
  const by = new Map<string, { q: string; page: string; c: number; i: number; pw: number; pi: number }>();
  for (const r of p.rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const q = String(x.query ?? "").trim().slice(0, 300);
    if (!q) continue;
    const page = String(x.page ?? "").slice(0, 500);
    const k = `${q}\u0000${page}`;
    const cur = by.get(k) ?? { q, page, c: 0, i: 0, pw: 0, pi: 0 };
    const imp = num(x.impressions);
    cur.c += num(x.clicks);
    cur.i += imp;
    if (x.position != null && imp > 0) {
      cur.pw += num(x.position) * imp;
      cur.pi += imp;
    }
    by.set(k, cur);
  }
  return [...by.values()]
    .sort((a, b) => b.i - a.i || b.c - a.c)
    .slice(0, p.cap ?? 1000)
    .map((v) => ({
      client_domain_id: p.clientId,
      provider: p.provider,
      period_start: p.from,
      period_end: p.to,
      query: v.q,
      page: v.page,
      clicks: Math.round(v.c),
      impressions: Math.round(v.i),
      ctr: v.i > 0 ? Math.round((v.c / v.i) * 10000) / 10000 : null,
      position: v.pi > 0 ? Math.round((v.pw / v.pi) * 100) / 100 : null,
    }));
}

const NAME: Record<ConnectProvider, string> = { gsc: "Search Console", ga4: "GA4", bing: "Bing Webmaster" };

/**
 * The run-health mail's line (sendRunHealth): customers whose first check is
 * a day old with no connection, so somebody looks. Null when there are none.
 */
export function staleLine(rows: { domain: string; provider: ConnectProvider; property: string | null; requested_at: string | null; status: string }[], now: number): string | null {
  const stuck = rows.filter((r) => r.status !== "connected" && r.requested_at && now - Date.parse(r.requested_at) >= STALE_MS);
  if (!stuck.length) return null;
  const days = (t: string) => Math.max(1, Math.floor((now - Date.parse(t)) / 86400000));
  return [
    `Data connections not visible to Windsor after a day (${stuck.length}): the customer has been through the steps and pressed Check connection. Tick the property in Windsor if it is listed there but not configured, or ask them to recheck the address (${ACCESS_EMAIL}).`,
    ...stuck.map((r) => `- ${r.domain}: ${NAME[r.provider]}${r.property ? ` (${r.property})` : ""}, waiting ${days(r.requested_at as string)} day${days(r.requested_at as string) === 1 ? "" : "s"}`),
  ].join("\n");
}
