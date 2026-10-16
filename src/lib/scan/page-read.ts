/**
 * Reading one page off the wire, and judging whether anything a person wrote
 * came with it.
 *
 * Extracted from crawl.ts on 16 Oct 2026 for the reason prose.ts was: crawl.ts
 * opens with `import "server-only"`, so nothing in it loads under `node --test`,
 * and the defect this file exists for was one that only a real page streamed
 * through the real reader shows. page-read.test.mts does exactly that with a
 * saved page-builder homepage.
 *
 * The defect, thelabjamaica.com on 15 Oct 2026. The crawl kept the first 200KB
 * of raw bytes. A Wix homepage is 808KB and its first 300KB is inline CSS and
 * JavaScript: `<title>` at byte 220,446, `<body>` at 309,232, the first line of
 * copy at about 331,796. The read stopped before all three, the CSS it did keep
 * cleared the too_thin check, and the visitor was shown a report built from
 * nothing that looked like any other report.
 */

import { decodeEntities, stripNonProse, toProse } from "./prose.ts";

/**
 * How much of a page is kept, measured after script, style, noscript, svg and
 * comments are stripped - not how much is read. It was a cap on raw bytes until
 * 15 Oct 2026, and on a page builder that is a cap on CSS.
 */
export const PAGE_KEPT_CAP = 200 * 1024;

/**
 * The memory guard the old byte cap was for: no page is read past this,
 * whatever it is made of. 3MB, about four times the heaviest homepage seen so
 * far (16 Oct 2026). The address is typed by a visitor on a public endpoint, so
 * the size of the response is chosen by whoever is asking.
 */
export const PAGE_RAW_CAP = 3 * 1024 * 1024;

/**
 * How long one page's body may take to arrive once its headers have, before
 * what is in hand is kept and the rest abandoned. Inside the crawl's 8 second
 * budget for the whole site, so a homepage dripping in slowly cannot spend all
 * of it and leave nothing for the about page.
 */
export const PAGE_READ_MS = 5_000;

/** Raw bytes between measurements of what is kept, so the strip runs a few times per page, not per chunk. */
const KEPT_CHECK_EVERY = 256 * 1024;

/**
 * Why a read stopped. `end` is the only one where the whole page arrived;
 * `kept_cap` is a page with more prose than is wanted, which is fine. The other
 * three cut the page short, and are what a too_thin is reported as when it
 * happens on a page that came back empty.
 */
export type ReadStop = "end" | "kept_cap" | "raw_cap" | "time" | "aborted";

export type PageRead = {
  /** The page with its non-prose blocks stripped, at most PAGE_KEPT_CAP of it. Tags survive, so links do. */
  html: string;
  stop: ReadStop;
  /** Raw bytes read off the wire. */
  bytes: number;
  /** `<script` tags in what was read, before the strip - the JavaScript-rendered tell. */
  scripts: number;
};

/** A streaming decoder for the declared charset, falling back to utf-8 where it names none or one TextDecoder does not know. */
export function decoderFor(contentType: string): TextDecoder {
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
 * The page with its non-prose blocks stripped, read until PAGE_KEPT_CAP of that
 * is in hand, PAGE_RAW_CAP has been read, or `readMs` has passed - whichever
 * comes first.
 *
 * Stripped here rather than only in toProse because the cap is the point: it
 * has to measure what will be kept. Decoded as it streams, with `stream: true`,
 * so a character straddling two chunks is not split; the reader is cancelled at
 * the stop, so the transfer stops there too.
 *
 * A page cut short by the clock, or by the crawl's abort firing mid-body, keeps
 * what had arrived. It used to reject, and the homepage that had answered
 * inside the budget was reported as a timeout with its first 150KB of prose
 * thrown away. Only a read that got nothing at all still throws.
 */
export async function readPage(
  body: ReadableStream<Uint8Array>,
  contentType: string,
  readMs: number = PAGE_READ_MS,
): Promise<PageRead> {
  const reader = body.getReader();
  const decoder = decoderFor(contentType);
  let raw = "";
  let bytes = 0;
  let checkedAt = 0;
  let stop: ReadStop = "raw_cap";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeUp = new Promise<"time">((resolve) => {
    timer = setTimeout(() => resolve("time"), readMs);
  });
  try {
    while (bytes < PAGE_RAW_CAP) {
      let got: ReadableStreamReadResult<Uint8Array> | "time";
      try {
        got = await Promise.race([reader.read(), timeUp]);
      } catch (err) {
        // The crawl's controller fired mid-body. Keep what came, if anything did.
        if (!bytes) throw err;
        stop = "aborted";
        break;
      }
      if (got === "time") {
        stop = "time";
        break;
      }
      if (got.done) {
        stop = "end";
        break;
      }
      const value = got.value;
      if (!value?.byteLength) continue;
      const room = PAGE_RAW_CAP - bytes;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      raw += decoder.decode(chunk, { stream: true });
      bytes += chunk.byteLength;
      if (bytes - checkedAt >= KEPT_CHECK_EVERY) {
        checkedAt = bytes;
        if (stripNonProse(raw).length >= PAGE_KEPT_CAP) {
          stop = "kept_cap";
          break;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
  if (stop === "end") raw += decoder.decode();
  return {
    html: stripNonProse(raw).slice(0, PAGE_KEPT_CAP),
    stop,
    bytes,
    scripts: (raw.match(/<script\b/gi) ?? []).length,
  };
}

/** The `<title>`, decoded and collapsed; "" when there is none. */
export function pageTitle(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]!).replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

/** `<meta name="description">`, or og:description, in either attribute order; "" when neither is there. */
export function metaDescription(html: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\b(?:name|property)\s*=\s*["'](?:og:)?description["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const text = decodeEntities(content?.[1] ?? content?.[2] ?? "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 500);
  }
  return "";
}

/**
 * The prose inside `<body>`, which is what a visitor reads - the whole page's
 * prose where there is no body tag, because a fragment is all body. toProse on
 * the whole page counts the title too, and the title is judged on its own.
 */
export function bodyText(html: string): string {
  const at = html.search(/<body\b/i);
  return toProse(at < 0 ? html : html.slice(at));
}

/**
 * Below this much body text, with no title and no description either, a page
 * gave us nothing to read (16 Oct 2026).
 */
export const MIN_BODY_TEXT = 200;

/**
 * Why a site we reached gave us nothing to read. Logged with the URL, and
 * chosen between in the sentence the visitor is shown.
 */
export type ThinReason =
  /** The raw ceiling ran out before the page's words began. */
  | "raw_cap"
  /** The page was still arriving when its time, or the crawl's, ran out. */
  | "time"
  /** It arrived whole, carrying script and no words: rendered in the browser. */
  | "js_only"
  /** It arrived whole and there was nothing in it. */
  | "empty";

/**
 * Whether the homepage, with whatever else was read beside it, gave us enough
 * to build a report from - `null` when it did, the reason when it did not.
 *
 * The rule (16 Oct 2026): no title, no meta description, and under
 * MIN_BODY_TEXT of body text across every page read. Any one of the three is
 * something a person wrote about the business, and the brand read can work
 * from it; none of them is a report built from nothing, which is the one
 * outcome this exists to stop. `bodyChars` is summed over pages because a
 * homepage that is only a splash can have an about page that says it all.
 */
export function thinReason(home: Pick<PageRead, "html" | "stop" | "scripts">, bodyChars: number): ThinReason | null {
  if (pageTitle(home.html) || metaDescription(home.html) || bodyChars >= MIN_BODY_TEXT) return null;
  return whyThin(home);
}

/** The cause of a page that gave us too little, read off how its read stopped. */
export function whyThin(home: Pick<PageRead, "stop" | "scripts">): ThinReason {
  if (home.stop === "raw_cap") return "raw_cap";
  if (home.stop === "time" || home.stop === "aborted") return "time";
  return home.scripts > 0 ? "js_only" : "empty";
}
