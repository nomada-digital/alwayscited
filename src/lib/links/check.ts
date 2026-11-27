/**
 * "Is our link on the page" (25 Nov 2026): fetch a live URL and look for a link to the customer's site. Pure parts
 * (`findLink`, `blockedHost`) are tested; `checkLink` fetches. Server side only.
 *
 * The URL is typed by staff but is still fetched by our server, so it is never trusted: http and https only, a host
 * that is a private, loopback or link-local address (or resolves to one) is refused, redirects are followed by hand and
 * each hop checked, the body is cut at 3MB and the wait at 12s. Nothing is stored but the result.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type LinkCheck = { ok: boolean; found: boolean; status: number | null; href: string | null; anchor: string | null; rel: string | null; error: string | null; checked_at: string; final_url: string | null };

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 12_000;
const MAX_HOPS = 4;

/** A host this server must not fetch: loopback, private, link-local, carrier-grade NAT, metadata, or a bare name. */
export function blockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(h) === 6) return h === "::1" || h === "::" || /^f[cd]/i.test(h) || /^fe[89ab]/i.test(h) || /^::ffff:/i.test(h);
  return false;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** The first link in the page whose address is the customer's site (its domain or a subdomain), with its anchor and rel. */
export function findLink(html: string, domain: string, base?: string): { href: string; anchor: string; rel: string | null } | null {
  const own = domain.toLowerCase().replace(/^www\./, "");
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1]!;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = decode((href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim());
    if (!raw) continue;
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== own && !host.endsWith(`.${own}`)) continue;
    const rel = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    return { href: u.toString(), anchor: text(m[2]!).slice(0, 200), rel: (rel?.[1] ?? rel?.[2] ?? null) || null };
  }
  return null;
}

export type Fetch = typeof fetch;

export async function checkLink(url: string, domain: string, opts: { fetchImpl?: Fetch; resolve?: (host: string) => Promise<string[]>; now?: () => Date } = {}): Promise<LinkCheck> {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const fail = (error: string, extra: Partial<LinkCheck> = {}): LinkCheck => ({ ok: false, found: false, status: null, href: null, anchor: null, rel: null, error, checked_at: now, final_url: null, ...extra });
  const doFetch = opts.fetchImpl ?? fetch;
  const resolve = opts.resolve ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address));
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return fail("That is not a web address.");
  }
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") return fail("Only http and https pages can be checked.");
    if (blockedHost(current.hostname)) return fail("That address is not a public website.");
    try {
      if (isIP(current.hostname.replace(/^\[|\]$/g, "")) === 0 && (await resolve(current.hostname)).some(blockedHost)) return fail("That address is not a public website.");
    } catch {
      return fail(`Could not find ${current.hostname}.`);
    }
    let res: Response;
    try {
      res = await doFetch(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0 (compatible; alwayscited-link-check)", accept: "text/html,application/xhtml+xml" } });
    } catch (err) {
      return fail(`The page could not be fetched: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location");
      if (!to) return fail(`The page redirected (${res.status}) with nowhere to go.`, { status: res.status });
      current = new URL(to, current);
      continue;
    }
    if (res.status < 200 || res.status >= 300) return fail(`The page answered ${res.status}.`, { status: res.status, final_url: current.toString() });
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const dec = new TextDecoder();
      let n = 0;
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        n += r.value.byteLength;
        html += dec.decode(r.value, { stream: true });
        if (n > MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    } else html = await res.text();
    const hit = findLink(html, domain, current.toString());
    return hit
      ? { ok: true, found: true, status: res.status, href: hit.href, anchor: hit.anchor, rel: hit.rel, error: null, checked_at: now, final_url: current.toString() }
      : fail(`The page loads, but no link to ${domain} was found on it.`, { status: res.status, final_url: current.toString() });
  }
  return fail("Too many redirects.");
}
