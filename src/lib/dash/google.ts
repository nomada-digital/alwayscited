/**
 * Search Console and GA4, connected direct (Danny, 15 Nov 2026, option 1 "add our email"). The customer adds the
 * hub's Google service account to their own property - Restricted in Search Console, Viewer in GA4 - and "Check
 * connection" lists the properties it can see for their domain, through the hub's edge function google-data, which
 * alone holds the key (google-io.ts). This replaces the Windsor route of 2 Nov (connect.ts) for these two; Bing stays
 * on it.
 *
 * The pure half: the address, the deep links, what a permission level allows, the windows a pull reads, and how
 * Google's rows become ours. No imports with `@/`, so google.test.mts runs it under node --test.
 */

export type GoogleProvider = "gsc" | "ga4";

/** The address the customer adds: the hub's service account, a plain grant with no delegation. */
export const GOOGLE_ACCESS_EMAIL = "nomada-hub-mail@plucky-paratext-514819-v0.iam.gserviceaccount.com";

/** Shown under both cards (Danny's copy, 15 Nov 2026). */
export const READ_ONLY_NOTE = "Read-only. We can't change anything in your Search Console or Analytics, and you can remove access at any time.";

/** Search Console's Users and permissions page, for the property when we know it, else its property picker. */
export function gscUsersLink(property: string | null): string {
  return property ? `https://search.google.com/search-console/users?resource_id=${encodeURIComponent(property)}` : "https://search.google.com/search-console/users";
}

/** Search Console permission levels as sites.list names them, in plain words. */
export const PERMISSION: Record<string, string> = {
  siteOwner: "Owner",
  siteFullUser: "Full",
  siteRestrictedUser: "Restricted",
  siteUnverifiedUser: "Not verified",
};

/** Submitting a sitemap is a write: Google refuses it below Full user. Reading and URL Inspection work on Restricted. */
export const canSubmit = (permission: string | null | undefined): boolean => permission === "siteOwner" || permission === "siteFullUser";

/** The sitemap a site most likely serves: the property's own root, or https://<domain>/ for a domain property. */
export function sitemapFor(property: string): string {
  const root = property.startsWith("sc-domain:") ? `https://${property.slice("sc-domain:".length)}/` : property.endsWith("/") ? property : `${property}/`;
  return `${root}sitemap.xml`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (t: number) => new Date(Math.floor(t / 86400000) * 86400000);

/** Search Console's data settles about two days behind: the last day a pull asks for. */
export const lastFinalDay = (now: number): string => iso(utc(now - 2 * 86400000));

/**
 * Calendar months to read, oldest first, ending with the month holding `end`. 16 on the first connect (all Search
 * Console keeps), the last 2 each morning so the current month and a late-settling previous one are both fresh.
 */
export function monthWindows(end: string, months: number): { start: string; end: string }[] {
  const e = new Date(`${end}T00:00:00Z`);
  const out: { start: string; end: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const s = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    out.push({ start: iso(s), end: iso(last < e ? last : e) });
  }
  return out;
}

/** The first day of a backfill: 16 months back from `end`, on the 1st. */
export const backfillStart = (end: string): string => monthWindows(end, 16)[0].start;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** searchAnalytics rows by date into gsc_daily rows. */
export function gscDailyRows(clientId: string, rows: unknown[]): { client_domain_id: string; day: string; clicks: number; impressions: number; ctr: number | null; position: number | null }[] {
  return rows.flatMap((r) => {
    const x = (r ?? {}) as { keys?: unknown[]; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown };
    const day = String(x.keys?.[0] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const imp = Math.round(num(x.impressions));
    return [{ client_domain_id: clientId, day, clicks: Math.round(num(x.clicks)), impressions: imp, ctr: imp > 0 ? r4(num(x.ctr)) : null, position: imp > 0 ? r2(num(x.position)) : null }];
  });
}

/** searchAnalytics rows by query and page into the shape connect.ts queryRows sums ({query, page, ...}). */
export function gscQueryPageRows(rows: unknown[]): { query: string; page: string; clicks: number; impressions: number; position: number }[] {
  return rows.flatMap((r) => {
    const x = (r ?? {}) as { keys?: unknown[]; clicks?: unknown; impressions?: unknown; position?: unknown };
    const query = String(x.keys?.[0] ?? "");
    return query ? [{ query, page: String(x.keys?.[1] ?? ""), clicks: num(x.clicks), impressions: num(x.impressions), position: num(x.position) }] : [];
  });
}

export type Ga4Report = { dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string }[]; rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[] };

/** A runReport answer as plain objects keyed by dimension and metric name. */
export function ga4Rows(rep: Ga4Report | null | undefined): Record<string, string | number>[] {
  const dims = (rep?.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (rep?.metricHeaders ?? []).map((h) => h.name);
  return (rep?.rows ?? []).map((row) => {
    const o: Record<string, string | number> = {};
    dims.forEach((d, i) => (o[d] = row.dimensionValues?.[i]?.value ?? ""));
    mets.forEach((m, i) => (o[m] = num(row.metricValues?.[i]?.value)));
    return o;
  });
}

/** GA4's date dimension (20261115) as 2026-11-15. */
export const ga4Day = (d: string): string | null => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

/** The runReport requests a pull makes: sessions by channel and day, organic landing pages, key events by name. */
export const GA4_REQUESTS = {
  channels: (start: string, end: string) => ({ dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }], limit: 100000 }),
  pages: (start: string, end: string) => ({
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: "landingPagePlusQueryString" }],
    metrics: [{ name: "sessions" }, { name: "keyEvents" }],
    dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } },
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 500,
  }),
  events: (start: string, end: string) => ({ dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: "eventName" }], metrics: [{ name: "keyEvents" }], limit: 200 }),
};

/** Whether a property listed for a check is one of the customer's: the edge function already narrowed it by domain. */
export function pickable(provider: GoogleProvider, property: string, listed: { id: string }[]): boolean {
  return listed.some((p) => p.id === property) && (provider === "gsc" ? /^(sc-domain:|https?:\/\/)/.test(property) : /^properties\/\d+$/.test(property));
}
