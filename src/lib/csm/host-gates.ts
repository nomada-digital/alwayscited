/**
 * The shortlist's two quality gates (7 Nov 2026). AGENCY ONLY. Kev's first shortlist for Common, a UK Craft CMS agency,
 * was viiewerr.com and heightsplatform.com - US traffic, though Fatgrid labels the first a UK publication - and rgm.press,
 * a music site. So a host is let through on what it is, not on Fatgrid's labels:
 *
 * 1. Market: its share of organic traffic in the client's market, from DataForSEO Labs' domain_rank_overview read with
 *    no location (every location in one task, about $0.02). On 6 Nov 2026 that read viiewerr.com at 8% UK and
 *    heightsplatform.com at 1%; rgm.press at 62%. A share under MIN_MARKET_SHARE fails, and so does a host with too
 *    little traffic anywhere to measure. Cited hosts are measured and shown but not gated: the engines citing them for
 *    this client's questions is the evidence, as it is for their DR.
 * 2. Topic: one model call reads the homepage's title, description and headlines against the client's profile (its
 *    clusters, its own homepage, and the hosts Kev rejected as off-topic) and says whether the host covers that topic,
 *    with a one-line reason. Only a yes passes: a site that cannot be read is not evidence of fit.
 *
 * Pure. Imports are relative and carry the extension, for the reason dataforseo-request.ts gives.
 */

/** DataForSEO location codes for the markets a client can have. A market not here is not geo-gated. */
export const MARKET_LOCATION: Readonly<Record<string, number>> = { UK: 2826, US: 2840 };

/**
 * The least share of a host's organic traffic that must come from the client's market. 35%: a UK publication reads
 * well over half UK (rgm.press 62%), a US site with a UK label well under a fifth (viiewerr.com 8%); a third leaves
 * room for international titles whose largest single audience is still the client's.
 */
export const MIN_MARKET_SHARE = 0.35;
/** Below this estimated monthly organic traffic across every location, a share is noise, so the host fails as unmeasured. */
export const MIN_TOTAL_ETV = 50;
/** How long a host's reading is kept before it is read again. Audiences move slowly; a re-read costs money. */
export const HOST_CHECK_TTL_DAYS = 30;
/** The most hosts one run reads afresh (about $0.02 of DataForSEO each, and a share of one model call). */
export const HOST_CHECKS_PER_RUN = 24;

export type HostCheck = {
  domain: string;
  market: string | null;
  marketShare: number | null;
  marketEtv: number | null;
  totalEtv: number | null;
  fits: boolean | null;
  fitReason: string | null;
};

export type GateVerdict = { pass: boolean; why: string };

type LocationRow = { location_code?: unknown; metrics?: { organic?: { etv?: unknown } } };

/** A host's traffic in one location against its traffic everywhere, from domain_rank_overview's items. */
export function marketShare(items: readonly LocationRow[], locationCode: number): { share: number | null; marketEtv: number; totalEtv: number } {
  let total = 0;
  let market = 0;
  for (const i of items) {
    const etv = Number(i?.metrics?.organic?.etv);
    if (!Number.isFinite(etv) || etv <= 0) continue;
    total += etv;
    if (Number(i.location_code) === locationCode) market += etv;
  }
  return { share: total >= MIN_TOTAL_ETV ? market / total : null, marketEtv: market, totalEtv: total };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Gate 1. A market with no location code, or a cited host, is measured but never refused. */
export function marketVerdict(c: Pick<HostCheck, "market" | "marketShare" | "totalEtv">, opts: { cited: boolean }): GateVerdict {
  if (!c.market || !(c.market in MARKET_LOCATION)) return { pass: true, why: "market not measured" };
  if (c.totalEtv === null) return opts.cited ? { pass: true, why: "cited; traffic not read" } : { pass: false, why: `${c.market} share not proven: traffic could not be read` };
  if (c.marketShare === null) {
    return opts.cited ? { pass: true, why: "cited; too little traffic to measure" } : { pass: false, why: `too little organic traffic to measure its ${c.market} share` };
  }
  const why = `${pct(c.marketShare)} ${c.market} traffic`;
  if (opts.cited || c.marketShare >= MIN_MARKET_SHARE) return { pass: true, why };
  return { pass: false, why: `${why}, under ${pct(MIN_MARKET_SHARE)}` };
}

/** Gate 2. Only a yes from the model passes. */
export function topicVerdict(c: Pick<HostCheck, "fits" | "fitReason">): GateVerdict {
  if (c.fits === true) return { pass: true, why: c.fitReason ?? "on topic" };
  if (c.fits === false) return { pass: false, why: `off topic: ${c.fitReason ?? "does not cover the client's subject"}` };
  return { pass: false, why: "topic not confirmed: the site could not be read" };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", hellip: "..." };
const text = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-z0-9#]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/\s+/g, " ")
    .trim();

/**
 * What a homepage says it is about: the title, the meta description, the headings, and link text long enough to be a
 * headline. Scripts, styles and navigation-length links are left out. At most `maxLines` lines and `maxChars` in all,
 * so a batch of hosts stays inside one model call.
 */
export function homepageHeadlines(html: string, maxLines = 30, maxChars = 1800): string[] {
  const body = html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string, prefix = "") => {
    const t = text(raw);
    // Letter-spaced display type ("C O M M O N") reads as noise to the model: a line mostly of single letters is left out.
    const words = t.split(" ");
    if (t.length < 4 || seen.has(t.toLowerCase()) || words.filter((w) => w.length === 1).length > words.length / 2) return;
    seen.add(t.toLowerCase());
    out.push(prefix + t.slice(0, 160));
  };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  if (title) push(title[1]!, "Title: ");
  const desc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(body) ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(body);
  if (desc) push(desc[1]!, "Description: ");
  for (const m of body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) push(m[1]!);
  for (const m of body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const t = text(m[1]!);
    if (t.length >= 25 && t.length <= 140) push(t);
  }
  const lines: string[] = [];
  let used = 0;
  for (const l of out) {
    if (lines.length >= maxLines || used + l.length > maxChars) break;
    lines.push(l);
    used += l.length;
  }
  return lines;
}

/** The client as the topic gate reads it. Off-topic rejections are the client's own counter-examples. */
export function clientProfile(p: { brand: string | null; domain: string; topic: string | null; clusters: readonly string[]; homepage: readonly string[]; offTopic: readonly { domain: string; note: string | null }[] }): string {
  return [
    `Client: ${p.brand ?? p.domain} (${p.domain})`,
    p.topic ? `Topic: ${p.topic}` : null,
    p.clusters.length ? `What they want to be found for: ${p.clusters.join("; ")}` : null,
    p.homepage.length ? `Their own homepage says:\n${p.homepage.map((l) => `  ${l}`).join("\n")}` : null,
    p.offTopic.length ? `Sites the account manager already rejected as off-topic for this client:\n${p.offTopic.map((r) => `  ${r.domain}${r.note ? ` - ${r.note}` : ""}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
