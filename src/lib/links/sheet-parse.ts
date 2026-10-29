/**
 * A link tracker sheet's cells -> the rows the dashboard's Link insertions and Placements sections show (Danny,
 * 29 Oct 2026). Pure: the cells come from the agency hub (nomada-dashboards supabase/functions/
 * sync-alwayscited-sheets), which reads the sheet with data@'s Google connection or takes the morning's copy the
 * "Sheet snapshots" routine stored, as generators/pull_sheets.py reads them for the Nomada client dashboards.
 *
 * Columns are found by their header, never by position, and the header row is the first of the top rows that names
 * a link column (WLDM's trackers have a title block above it). Only the columns below are read. A price, cost, fee
 * or balance column is never one of them, so it cannot reach a row, the database or a client; a header that looks
 * like one is refused even when it also names a field ("Price per DR").
 *
 * Nothing is made up. A column the sheet does not have leaves its field empty; the linking domain is the live
 * URL's own host when the sheet has no domain column; authority is labelled DR or DA by the header it came from.
 *
 * A sheet that holds several clients (Kev's tracker: one tab, a Client column) keeps the rows whose client is this
 * one; a sheet with a target column keeps the rows that link to this client's site (WLDM keeps prospect rows for
 * other sites on the same tab - pull_sheets.py does the same).
 *
 * Loadable by node --test: no imports.
 */

export type LinkKind = "insertion" | "placement";

export type SheetLink = {
  url_key: string;
  live_url: string;
  linking_domain: string | null;
  target_keyword: string | null;
  anchor_text: string | null;
  target_page: string | null;
  authority: number | null;
  authority_label: "DR" | "DA" | null;
  page_traffic: number | null;
  status: string | null;
  live_on: string | null;
  live_month: string | null;
  sheet_row: number;
};

export type ParsedSheet = {
  rows: SheetLink[];
  /** Which header each field was read from, for the agency view: an empty map means no header row was found. */
  columns: Record<string, string>;
  skipped: { other_client: number; no_url: number; repeats: number };
  error: string | null;
};

export type Subject = { domain: string; brand: string | null; aliases?: readonly string[]; slug?: string | null };

/** Headers that are a price, whatever else they say. Refused before any field is matched. */
const MONEY = /\b(price|prices|cost|costs|fee|fees|balance|deduction|budget|invoice|paid|spend|rate|£|\$|€|gbp|usd|eur)\b|[£$€]/i;

/** Field -> the headers it is read from, lower case with single spaces. The first header present wins. */
const FIELDS: Record<string, readonly string[]> = {
  live_url: ["live url", "page url", "url", "live link", "placement url", "article url", "post url", "link url", "publication / placement site", "placement site", "published url"],
  linking_domain: ["linking domain", "referring domain", "domain", "website", "publication", "site"],
  target_keyword: ["target keyword", "target keywords", "target kw", "keyword", "keywords"],
  anchor_text: ["anchor text", "anchor"],
  target_page: ["target page", "target link", "target url", "landing page", "destination url", "links to"],
  dr: ["dr", "domain rating", "ahrefs dr"],
  da: ["da", "domain authority", "moz da"],
  page_traffic: ["page traffic", "traffic to page", "page organic traffic"],
  status: ["status", "link status"],
  live_on: ["date it went live", "date live", "live date", "date went live", "went live", "published", "date published", "publish date", "live on"],
  month: ["month"],
  client: ["client", "client name", "customer"],
};

const HEADER_ROWS = 15;

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const head = (v: unknown) => clean(v).toLowerCase().replace(/\s*[:*]$/, "");

/** Scheme, www, query, fragment and a trailing slash ignored, so one page matches however it was typed. */
export function urlKey(raw: string): string {
  const s = clean(raw);
  if (!s) return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host + u.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function hostOf(raw: string): string | null {
  const k = urlKey(raw);
  return k ? k.split("/")[0]! : null;
}

/** '1.3k' -> 1300, '54' -> 54, '2,400' -> 2400; '', '-', 'n/a' -> null. */
export function sheetNumber(raw: unknown): number | null {
  const s = clean(raw).replace(/,/g, "").toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
  return Number.isFinite(v) ? v : null;
}

/** dd/mm/yyyy (the UK sheets), yyyy-mm-dd, or "14 Apr 2026" -> yyyy-mm-dd; anything else -> null. */
export function sheetDate(raw: unknown): string | null {
  const s = clean(raw);
  let y: number, mo: number, d: number;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/i.exec(s))) {
    const i = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2]!.toLowerCase());
    if (i < 0) return null;
    [d, mo, y] = [Number(m[1]), i + 1, Number(m[3])];
  } else return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

const words = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** The names a sheet may call this client by: its brand, aliases, domain with and without its ending, and slug. */
export function clientNames(s: Subject): Set<string> {
  const bare = s.domain.toLowerCase().replace(/^www\./, "");
  const stem = bare.split(".")[0] ?? bare;
  const out = new Set([s.brand ?? "", ...(s.aliases ?? []), bare, stem, words(bare), (s.slug ?? "").replace(/-/g, " ")].map(words).filter((n) => n.length >= 2));
  return out;
}

/** Where the header row is and which column each field is read from. */
export function readHeader(cells: readonly (readonly unknown[])[]): { at: number; col: Map<string, number>; from: Record<string, string> } | null {
  for (let i = 0; i < Math.min(cells.length, HEADER_ROWS); i++) {
    const row = (cells[i] ?? []).map(head);
    const col = new Map<string, number>();
    const from: Record<string, string> = {};
    for (const [field, names] of Object.entries(FIELDS)) {
      for (const n of names) {
        const j = row.findIndex((h) => h === n && !MONEY.test(h));
        if (j >= 0) {
          col.set(field, j);
          from[field] = clean(cells[i]![j]);
          break;
        }
      }
    }
    if (col.has("live_url")) return { at: i, col, from };
  }
  return null;
}

/** The sheet's rows for this client, in sheet order, one per live URL. */
export function parseLinkSheet(cells: readonly (readonly unknown[])[], subject: Subject): ParsedSheet {
  const skipped = { other_client: 0, no_url: 0, repeats: 0 };
  if (!Array.isArray(cells) || !cells.length) return { rows: [], columns: {}, skipped, error: "The sheet is empty." };
  const h = readHeader(cells);
  if (!h) return { rows: [], columns: {}, skipped, error: "No header row naming a link column (Page URL, Live URL, URL or Publication / placement site) in the first 15 rows." };
  const own = subject.domain.toLowerCase().replace(/^www\./, "");
  const names = clientNames(subject);
  const authorityLabel: "DR" | "DA" | null = h.col.has("dr") ? "DR" : h.col.has("da") ? "DA" : null;
  const rows: SheetLink[] = [];
  const seen = new Set<string>();
  let month = "";
  for (let i = h.at + 1; i < cells.length; i++) {
    const r = cells[i] ?? [];
    const cell = (f: string) => (h.col.has(f) ? clean(r[h.col.get(f)!]) : "");
    if (cell("month")) month = cell("month");
    const url = cell("live_url");
    if (!/^https?:\/\//i.test(url) || !urlKey(url)) {
      if (r.some((c: unknown) => clean(c))) skipped.no_url += 1;
      continue;
    }
    if (h.col.has("client") && !names.has(words(cell("client")))) {
      skipped.other_client += 1;
      continue;
    }
    const target = cell("target_page");
    if (target && !h.col.has("client")) {
      const t = hostOf(target);
      if (t && t !== own && !t.endsWith(`.${own}`)) {
        skipped.other_client += 1;
        continue;
      }
    }
    const key = urlKey(url);
    if (seen.has(key)) {
      skipped.repeats += 1;
      continue;
    }
    seen.add(key);
    const authority = authorityLabel === "DR" ? sheetNumber(cell("dr")) : authorityLabel === "DA" ? sheetNumber(cell("da")) : null;
    const traffic = sheetNumber(cell("page_traffic"));
    rows.push({
      url_key: key,
      live_url: url,
      linking_domain: cell("linking_domain") ? (hostOf(cell("linking_domain")) ?? cell("linking_domain")) : hostOf(url),
      target_keyword: cell("target_keyword") || null,
      anchor_text: cell("anchor_text") || null,
      target_page: target || null,
      authority,
      authority_label: authority === null ? null : authorityLabel,
      page_traffic: traffic === null ? null : Math.round(traffic),
      status: cell("status") || null,
      live_on: sheetDate(cell("live_on")),
      live_month: h.col.has("month") && month ? month : null,
      sheet_row: i + 1,
    });
  }
  const columns: Record<string, string> = {};
  for (const [f, v] of Object.entries(h.from)) if (f !== "dr" && f !== "da") columns[f] = v;
  if (authorityLabel) columns.authority = h.from[authorityLabel.toLowerCase()]!;
  return { rows, columns, skipped, error: null };
}

/** The Google Sheet a pasted URL names: its id, and the tab when the URL carries one (#gid= or ?gid=). */
export function sheetRef(raw: string): { id: string; gid: number | null } | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(clean(raw));
  if (!m) return null;
  const g = /[#?&]gid=(\d+)/.exec(raw);
  return { id: m[1]!, gid: g ? Number(g[1]) : null };
}
