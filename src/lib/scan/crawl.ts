import "server-only";

import { outboundLinks } from "../coverage/draft";

import { checkHost } from "./address";
import { decodeEntities, stripNonProse, toProse } from "./prose";

/** Paths worth reading beyond the homepage, in the order we prefer them. */
const INTERESTING =
  /\/(about|services|what-we-do|solutions|sectors|industries|expertise|specialisms|case-stud|our-work|work|clients|portfolio|results)/i;

/**
 * Which linked pages are read first when there are more than the cap.
 *
 * The question set narrows the category by what the site sells and who it
 * sells to, so services and industries come first and case studies next -
 * a firm with four retail case studies serves retail whether or not its
 * homepage says so. "About" is last: it says how a company sees itself, which
 * is exactly what the questions are told not to be built from.
 */
function pageRank(path: string): number {
  if (/services|what-we-do|solutions|expertise|specialisms/i.test(path)) return 0;
  if (/sectors|industries/i.test(path)) return 1;
  if (/case-stud|our-work|work|portfolio|results|clients/i.test(path)) return 2;
  return 3;
}

/**
 * How much of a page is kept, measured after script, style, noscript, svg and
 * comments are stripped - not how much is read.
 *
 * It was a cap on raw bytes until 15 Oct 2026, and on a Wix site that is a cap
 * on CSS: thelabjamaica.com's first 300KB is inline style and script, its
 * `<title>` is at byte 220,446 and its body at 309,232. The crawl read 200KB,
 * kept nothing a person wrote, and found no links to follow. Page builders do
 * this as a matter of course - Wix, Squarespace and their kind are a large
 * share of the small firms who type their address in here.
 */
const PAGE_KEPT_CAP = 200 * 1024;

/**
 * The memory guard the old byte cap was for (see bodyUpTo): no page is read
 * past this, whatever it is made of. Ten times the old cap, read once.
 */
const PAGE_RAW_CAP = 2 * 1024 * 1024;

/** Raw bytes between measurements of what is kept, so the strip runs a few times per page, not per chunk. */
const KEPT_CHECK_EVERY = 256 * 1024;

/**
 * Below this many characters of homepage prose, an about page is fetched
 * whatever else is linked (Danny, 15 Oct 2026). A homepage that says little
 * says it in a hero line and a slogan; the about page is where a small firm
 * says what it does and for whom. It ranks last otherwise, by design - see
 * pageRank - and on a thin homepage last is where it gets crowded out.
 */
const THIN_HOMEPAGE = 1_500;

/** Tried directly when a thin homepage links no about page at all. */
const ABOUT_GUESSES = ["/about", "/about-us"];

const TOTAL_BUDGET_MS = 8_000;
const MAX_EXTRA_PAGES = 6;

/**
 * Redirects followed per page, now that they are followed by hand.
 *
 * fetch would have followed twenty of them. Every hop is a fresh address that
 * has to be checked, and the chains a real site needs - http to https, apex to
 * www, a missing trailing slash - are three at the outside.
 */
const MAX_REDIRECTS = 5;

/** The 3xx statuses that carry a Location worth following. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const USER_AGENT = "alwayscited-scan/1.0 (+https://alwayscited.com)";

/**
 * Why a site could not be read.
 *
 * These were one undifferentiated condition until 19 Sep 2026, and the start
 * route rendered every one of them as "Check the address and try again." Three
 * of the five are not the address being wrong, so that sentence sent a visitor
 * whose site is perfectly fine to go and correct something correct - which
 * leaves them nowhere to go, on the first thing anyone does on the site.
 *
 * It cost the log too. A class of site failing in the funnel and a handful of
 * people mistyping produced the same line.
 */
export type ReadFailure =
  /** Nothing answered on either scheme. The address really is the problem. */
  | "dns"
  /** It answered and refused us. A bot filter or a WAF, usually a 403. */
  | "blocked"
  /** The budget ran out before it answered. A slow site, not a wrong one. */
  | "timeout"
  /** It answered with something that is not a web page. */
  | "not_html"
  /** We read it, and there was too little prose to name a brand from. */
  | "too_thin"
  /**
   * It resolves somewhere that is not a public web server, or it redirected
   * somewhere that is not. Not a site we will read on anyone's behalf.
   */
  | "private";

export class UnreachableDomain extends Error {
  readonly reason: ReadFailure;
  /** The status it refused us with, where there was one. */
  readonly status?: number;

  constructor(domain: string, reason: ReadFailure, status?: number) {
    super(`could not read ${domain}: ${reason}`);
    this.name = "UnreachableDomain";
    this.reason = reason;
    this.status = status;
  }
}

/**
 * A read either produced a page or it did not, and when it did not the reason
 * is the whole point: it is what separates a wrong address from a site that is
 * up and behind a bot filter.
 */
type Fetched =
  /**
   * `url` is the address that actually answered, after every redirect this
   * followed by hand - not the one we asked for.
   *
   * It is carried because relative links are resolved against it. getText
   * follows the chain internally and used to return only the prose, so the
   * caller's `base` stayed the URL it had requested. On a homepage that
   * redirects into a subdirectory - `/en/`, `/uk/`, any locale split, which is
   * ordinary on the British and European sites this reads - an `href="about"`
   * in the answering page resolved against the apex and became `/about`
   * instead of `/en/about`. Those fetches 404, and they do it inside the
   * allSettled below, so all five "about us" reads were dropped without a
   * word on exactly that class of site.
   *
   * Same shape as the `@`-in-the-query-string fault in normalizeDomain: a URL
   * assembled in steps, where a later step invalidates a value an earlier one
   * produced and nothing carries the correction forward.
   */
  | { ok: true; html: string; url: string }
  | { ok: false; why: "status"; status: number }
  | { ok: false; why: "not_html" }
  | { ok: false; why: "private" }
  | { ok: false; why: "network" };

// The three refusals that carry nothing of their own, named once so the read
// loop keeps its branches on one line each.
const FAILED_NETWORK: Fetched = { ok: false, why: "network" };
const FAILED_PRIVATE: Fetched = { ok: false, why: "private" };
const FAILED_NOT_HTML: Fetched = { ok: false, why: "not_html" };

/**
 * The first PAGE_BYTE_CAP bytes, and no more of them read than that.
 *
 * `await res.arrayBuffer()` and then slicing capped the *decode* and not the
 * read: the whole response was pulled into memory first, so the cap bounded
 * nothing that costs anything. The address is typed by a visitor on a public
 * endpoint, so the size of that response is chosen by whoever is asking - a few
 * hundred megabytes of anything, served slowly enough to stay inside the
 * budget, is a function killed for memory on the first thing anyone does here.
 *
 * Reading the stream and cancelling at the cap also stops the transfer, which
 * the old shape could not: it had already paid for every byte before it threw
 * any of them away.
 */
async function bodyUpTo(body: ReadableStream<Uint8Array>, cap: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    // The stream is either finished or being abandoned mid-body. Both want the
    // same call, and a reader that has already ended treats it as a no-op.
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(Math.min(total, cap));
  let at = 0;
  for (const chunk of chunks) {
    if (at >= out.length) break;
    const take = Math.min(chunk.byteLength, out.length - at);
    out.set(chunk.subarray(0, take), at);
    at += take;
  }
  return out;
}

/**
 * The encoding the response declared, or utf-8 where it declared nothing.
 *
 * TextDecoder was built with no argument, which is utf-8 whatever the site
 * said. A page served as windows-1252 or iso-8859-1 - still ordinary on older
 * British and European sites, which is the market this scans - reached the
 * brand read with a replacement character wherever an accent or a curly quote
 * had been. That is not a rendering blemish here: the prose it mangles is the
 * only thing the model is given to name the company from.
 *
 * The header is the authority and a meta tag inside the document is not read.
 * An unknown label makes TextDecoder throw, so that falls back rather than
 * failing the read.
 */
function decodeBody(bytes: Uint8Array, contentType: string): string {
  const declared = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // Not a label TextDecoder knows. utf-8 below.
    }
  }
  return new TextDecoder().decode(bytes);
}

/** A streaming decoder for the declared charset, falling back to utf-8 as decodeBody does. */
function decoderFor(contentType: string): TextDecoder {
  const declared = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared);
    } catch {
      // Not a label TextDecoder knows. utf-8 below.
    }
  }
  return new TextDecoder();
}

/**
 * The page with its non-prose blocks stripped, read until PAGE_KEPT_CAP of
 * that is in hand or PAGE_RAW_CAP has been read, whichever comes first.
 *
 * Stripped here rather than only in toProse because the cap is the point: it
 * has to measure what will be kept. The links sameHostLinks wants are tags,
 * and tags survive the strip. Decoded as it streams, with `stream: true`, so a
 * character straddling two chunks is not split; the reader is cancelled at the
 * cap, so the transfer stops there as it did under bodyUpTo.
 */
async function readPage(body: ReadableStream<Uint8Array>, contentType: string): Promise<string> {
  const reader = body.getReader();
  const decoder = decoderFor(contentType);
  let raw = "";
  let bytes = 0;
  let checkedAt = 0;
  let finished = false;
  try {
    while (bytes < PAGE_RAW_CAP) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      if (!value?.byteLength) continue;
      const room = PAGE_RAW_CAP - bytes;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      raw += decoder.decode(chunk, { stream: true });
      bytes += chunk.byteLength;
      if (bytes - checkedAt >= KEPT_CHECK_EVERY) {
        checkedAt = bytes;
        if (stripNonProse(raw).length >= PAGE_KEPT_CAP) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (finished) raw += decoder.decode();
  return stripNonProse(raw).slice(0, PAGE_KEPT_CAP);
}

/**
 * Fetch one page, following redirects by hand so that every hop is checked.
 *
 * redirect: follow handed the whole chain to fetch, which left only the first
 * address ours to judge. A public site answering 302 to a link-local address
 * was followed with nothing looking at it - and that is the cheaper half of
 * this, because it needs no DNS record of your own at all.
 *
 * trusted is the hostname the caller has already resolved and cleared, which
 * is the scanned domain itself. Every other host, including a www variant of
 * it, is checked here before it is fetched.
 */
async function getText(url: string, signal: AbortSignal, trusted: string): Promise<Fetched> {
  let current = url;

  for (let hop = 0; ; hop++) {
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      return FAILED_NETWORK;
    }
    // A redirect to file: or data: is not a page, and not ours to open.
    if (target.protocol !== "https:" && target.protocol !== "http:") return FAILED_NETWORK;
    if (target.hostname !== trusted) {
      const where = await checkHost(target.hostname, signal);
      if (where === "private") return FAILED_PRIVATE;
      if (where === "unresolved") return FAILED_NETWORK;
    }

    let res: Response;
    try {
      res = await fetch(current, {
        signal,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT },
      });
    } catch {
      return FAILED_NETWORK;
    }

    const location = REDIRECTS.has(res.status) ? res.headers.get("location") : null;
    if (location) {
      // The body of a redirect is never read, whatever size it arrived at.
      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) return FAILED_NETWORK;
      try {
        current = new URL(location, current).toString();
      } catch {
        return FAILED_NETWORK;
      }
      continue;
    }

    // Nothing reads the body on either refusal, so it is dropped rather than
    // left for the collector at whatever size it arrived.
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, why: "status", status: res.status };
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) {
      await res.body?.cancel().catch(() => {});
      return FAILED_NOT_HTML;
    }
    if (!res.body) return { ok: true, html: "", url: current };

    // readPage strips and caps what is kept; see PAGE_KEPT_CAP.
    //
    // Wrapped, because the headers arriving is not the body arriving. The only
    // try/catch in here was around fetch(), which resolves as soon as the
    // status line is in - so a site that answered inside the budget and was
    // still streaming when the 8 second controller fired rejected inside
    // bodyUpTo and threw straight out of readSite.
    //
    // Checked rather than reasoned: a fetch aborted after its headers have
    // arrived rejects at reader.read(), not at fetch(). readSite's whole
    // contract is that it throws UnreachableDomain, and the start route splits
    // its five 422s from the 502 on exactly that - so the escape turned the
    // slow site the `timeout` reason exists to name into "read_failed", which
    // is the code that means the language model was the problem. It also
    // logged through describeAnthropicError and wrote a model-call debit for a
    // call that was never made.
    try {
      return { ok: true, html: await readPage(res.body, type), url: current };
    } catch {
      return FAILED_NETWORK;
    }
  }
}

/**
 * Internal links worth following, resolved against the URL that actually
 * answered rather than a hardcoded https. Built against https unconditionally,
 * every extra page on an http-only site resolved to the scheme that had just
 * failed, so the five "about us" reads were thrown away on exactly the sites
 * least likely to have much on the homepage.
 *
 * "The URL that actually answered" was only true of the scheme until the
 * redirect chain started reporting its destination. It described what the
 * caller intended rather than what it passed, which is why the path half of
 * the same fault sat under this comment: a redirect into `/en/` left `base` at
 * the apex, and a relative href resolved a directory too high. Both halves are
 * the same argument, and it holds for both now.
 */
function sameHostLinks(html: string, domain: string, base: string, thinHomepage: boolean): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    /**
     * Decoded, because an attribute value is entity-encoded in the source and
     * the address is what it decodes to. A perfectly ordinary
     * `href="/about?ref=a&amp;p=2"` was fetched with a literal "&amp;" in its
     * query string - a different request from the one the link makes, on the
     * pages this bothers to read at all. Same fault as the prose decode below
     * it, found in the same pass.
     */
    const href = decodeEntities(m[1]);
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue; // Ignore unparseable hrefs.
    }
    if (url.hostname.replace(/^www\./, "") !== domain) continue;
    /**
     * Matched against the resolved path, not against the raw href, and the
     * difference is the case this whole function was fixed for.
     *
     * INTERESTING wants a "/" before the word, so it was deciding on a string
     * that may not carry one yet. `href="about"` - the example the comment on
     * `Fetched` and the header of crawl.test.mts both reach for - has no slash
     * in it at all, so it failed this test and was dropped here, one step
     * before the resolution those two comments are about. Carrying `base`
     * forward fixed `./about` and `en/about`; the bare form never got far
     * enough to benefit, and nothing said so because a link that is never
     * followed looks exactly like a link that is not there.
     *
     * Resolving first also narrows what can match. The raw href was tested
     * whole, so a "/about" sitting in a query string or a fragment counted;
     * `url.pathname` is the path and only the path.
     *
     * The cost is parsing every href on the page rather than the few that
     * matched, which is bounded by the 200KB page cap and is microseconds
     * against an 8 second network budget.
     */
    if (!INTERESTING.test(url.pathname)) continue;
    url.hash = "";
    out.add(url.toString());
  }
  // Stable sort: within a rank, the order the links appear on the page.
  const ranked = [...out]
    .map((u, i) => ({ u, i, r: pageRank(new URL(u).pathname) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.u);
  const picked = ranked.slice(0, MAX_EXTRA_PAGES);
  if (!thinHomepage || picked.some(isAbout)) return picked;

  // A thin homepage gets an about page whatever it ranks (see THIN_HOMEPAGE):
  // the first one it links, or the usual addresses tried blind when it links
  // none. A guess that 404s is dropped like any other failed extra read.
  const linked = ranked.find(isAbout);
  const about = linked ? [linked] : ABOUT_GUESSES.map((p) => new URL(p, base).toString());
  return [...picked.slice(0, MAX_EXTRA_PAGES - about.length), ...about];
}

/** `<meta name="description">`, or og:description, in either attribute order; "" when neither is there. */
function metaDescription(html: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\b(?:name|property)\s*=\s*["'](?:og:)?description["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const text = decodeEntities(content?.[1] ?? content?.[2] ?? "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 500);
  }
  return "";
}

function isAbout(url: string): boolean {
  return /\/about/i.test(new URL(url).pathname);
}

/**
 * Which failure to report when the homepage never arrived.
 *
 * An expired budget outranks whatever the individual attempts said: once the
 * controller has fired, every fetch after it rejects instantly, so their
 * reasons describe the abort rather than the site.
 */
function failureFor(
  domain: string,
  signal: AbortSignal,
  first: Exclude<Fetched, { ok: true }> | null,
): UnreachableDomain {
  if (signal.aborted) return new UnreachableDomain(domain, "timeout");
  if (first?.why === "private") return new UnreachableDomain(domain, "private");
  if (first?.why === "status") return new UnreachableDomain(domain, "blocked", first.status);
  if (first?.why === "not_html") return new UnreachableDomain(domain, "not_html");
  return new UnreachableDomain(domain, "dns");
}

/** One placed piece as the coverage draft reads it. A piece that could not be read still counts as coverage. */
export type PieceRead = { url: string; ok: true; text: string; links: string[] } | { url: string; ok: false };

/**
 * Read placed pieces for the /coverage-check draft (R140), through the same
 * guarded fetch as readSite - every host checked, every redirect hop checked,
 * bytes capped - inside one 8 second budget for all of them, in parallel.
 * Never throws: a paywall, a block or a timeout is `ok: false` for that piece,
 * and step 2 names it.
 */
export async function readPieces(urls: string[]): Promise<PieceRead[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS);
  try {
    const got = await Promise.allSettled(
      urls.map((u) => {
        const url = /^https?:\/\//i.test(u) ? u : `https://${u}`;
        // No trusted host: every hostname, the first included, goes through checkHost.
        return getText(url, controller.signal, "");
      }),
    );
    return urls.map((url, i): PieceRead => {
      const page = got[i]!;
      if (page.status !== "fulfilled" || !page.value.ok) return { url, ok: false };
      const text = toProse(page.value.html).slice(0, 12_000);
      if (text.length < 200) return { url, ok: false };
      return { url, ok: true, text, links: outboundLinks(page.value.html, page.value.url) };
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the homepage plus up to five "about us" style pages, within one 8 second
 * budget for the whole operation. Throws UnreachableDomain when the homepage
 * yields nothing usable, carrying the reason so the caller can say which of the
 * five things went wrong rather than blaming the address for all of them.
 */
export async function readSite(domain: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS);

  try {
    // Where the address points is settled before a single byte is fetched.
    // Both schemes below share the hostname, so this is one lookup for the pair
    // rather than one per attempt.
    const where = await checkHost(domain, controller.signal);
    if (where === "private") throw new UnreachableDomain(domain, "private");
    if (where === "unresolved") throw failureFor(domain, controller.signal, null);

    let html: string | null = null;
    let base = `https://${domain}/`;
    let firstFailure: Exclude<Fetched, { ok: true }> | null = null;

    for (const scheme of ["https", "http"] as const) {
      const url = `${scheme}://${domain}/`;
      const got = await getText(url, controller.signal, domain);
      if (got.ok) {
        html = got.html;
        // The address that answered, not the one we asked for. See Fetched.
        base = got.url;
        break;
      }
      // The https attempt is the one worth reporting: it is what a visitor
      // means by their address, and an http retry against a host that just
      // refused us only repeats the refusal.
      firstFailure ??= got;
    }

    // `html === null` rather than `!html`, because "" is a page that answered.
    // A 200 carrying text/html and an empty body took the falsy branch, and
    // with no failure recorded against it failureFor fell through to `dns` -
    // "Nothing answered at yourdomain.com. Check the address and try again."
    // Something did answer; there was nothing in it. That is `too_thin`, which
    // the length check below reaches now that "" gets there.
    if (html === null) throw failureFor(domain, controller.signal, firstFailure);

    // Empty prose stays empty, so the too_thin check below still measures words.
    const labelled = (url: string, page: string) => {
      const prose = toProse(page);
      return prose ? "Page: " + url + "\n" + prose : "";
    };
    // The meta description, where the homepage has one, ahead of its prose. It
    // is a tag, so toProse drops it - and on a thin homepage it is often the one
    // sentence that says what the firm does (15 Oct 2026: a Wix agency homepage
    // whose copy was a slogan, and whose description named the business).
    const description = metaDescription(html);
    const home = labelled(base, html);
    const parts = [description && home ? home.replace("\n", "\nDescription: " + description + "\n") : home];
    const links = sameHostLinks(html, domain, base, toProse(html).length < THIN_HOMEPAGE);

    // Remaining pages share whatever is left of the budget, in parallel.
    //
    // allSettled, because these are best effort and the loop below already
    // says so by testing `ok`. Under Promise.all a single rejection discarded
    // the homepage prose that had already been read and failed the whole scan
    // - and it fired on exactly the sites where the extra pages are worth
    // most, the ones whose homepage ate enough of the budget to leave these
    // mid-body when the controller fired.
    const extra = await Promise.allSettled(links.map((u) => getText(u, controller.signal, domain)));
    // Each page headed with its address, so the brand read can tell a case
    // study from the homepage. `links` and `extra` share an index.
    extra.forEach((page, i) => {
      if (page.status === "fulfilled" && page.value.ok) parts.push(labelled(links[i], page.value.html));
    });

    const text = parts.filter(Boolean).join("\n\n").slice(0, 60_000);
    if (text.length < 200) throw new UnreachableDomain(domain, "too_thin");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One guarded read of any URL, for the DIY platform's own fetches (13 Oct
 * 2026, DIY P1; spec 10 section 5.4): robots.txt, llms.txt, key pages, and the
 * first-pass verification of a pursued page. Used through
 * `src/lib/diy/core/fetch.ts`, which checks robots.txt for a third-party page
 * before it is read.
 *
 * The same guard as `getText` above, hop for hop - every hostname checked by
 * `checkHost`, redirects followed by hand up to MAX_REDIRECTS, bytes capped
 * by `bodyUpTo` as they stream - with two differences that are the reason it
 * is a second loop rather than a flag on the first: it trusts no host, not
 * even the first, and it answers whatever status and type the page has
 * (a robots.txt is text/plain, a 404 is an answer), with its headers.
 * `fetch.test.mts` holds the two loops to the same guard.
 *
 * `allowHop` (13 Oct 2026, review of DIY P1) is asked before each redirect is
 * followed, with the URL it points at: fetch.ts checks that URL's robots.txt
 * for a third-party read, so a page that redirects to a host or path that
 * disallows us is not read. A hop it refuses answers `refused`.
 */
export type GuardedRead =
  | { ok: true; status: number; html: string; headers: Record<string, string>; url: string }
  | { ok: false; why: "network" | "private" | "timeout" | "refused" };

export async function guardedRead(
  url: string,
  opts: { capBytes: number; ua: string; timeoutMs: number; allowHop?: (next: string) => Promise<boolean> },
): Promise<GuardedRead> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      let target: URL;
      try {
        target = new URL(current);
      } catch {
        return { ok: false, why: "network" };
      }
      if (target.protocol !== "https:" && target.protocol !== "http:") return { ok: false, why: "network" };
      const where = await checkHost(target.hostname, signal);
      if (where === "private") return { ok: false, why: "private" };
      if (where === "unresolved") return { ok: false, why: "network" };

      let res: Response;
      try {
        res = await fetch(current, { signal, redirect: "manual", headers: { "user-agent": opts.ua } });
      } catch {
        return { ok: false, why: signal.aborted ? "timeout" : "network" };
      }

      const location = REDIRECTS.has(res.status) ? res.headers.get("location") : null;
      if (location) {
        await res.body?.cancel().catch(() => {});
        if (hop >= MAX_REDIRECTS) return { ok: false, why: "network" };
        try {
          current = new URL(location, current).toString();
        } catch {
          return { ok: false, why: "network" };
        }
        if (opts.allowHop && !(await opts.allowHop(current))) return { ok: false, why: "refused" };
        continue;
      }

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value.slice(0, 500);
      });
      const type = res.headers.get("content-type") ?? "";
      const html = res.body ? decodeBody(await bodyUpTo(res.body, opts.capBytes), type) : "";
      return { ok: true, status: res.status, html, headers, url: current };
    }
  } catch {
    return { ok: false, why: signal.aborted ? "timeout" : "network" };
  }
}
