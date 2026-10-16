import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  bodyText,
  metaDescription,
  PAGE_RAW_CAP,
  pageTitle,
  readPage,
  thinReason,
  whyThin,
} from "./page-read.ts";

/**
 * The page-builder regression, run against the real reader (16 Oct 2026).
 *
 * thelabjamaica.com, a Wix site, came back from the free scan as a blank
 * report on 15 Oct 2026: the crawl kept the first 200KB of raw bytes, and on
 * that homepage the title starts at byte 220,446 and the copy at about 331,796.
 * The fixture is built the same way - over 250KB of inline CSS and script, with
 * markup-looking strings inside the script, before the `<title>` - and is
 * streamed through readPage in network-sized chunks, as fetch would hand it.
 */

const FIXTURE = readFileSync(new URL("./page-builder-homepage.fixture.html", import.meta.url));

/** A response body that hands `bytes` over in `size`-byte chunks. */
function streamOf(bytes: Uint8Array, size = 16 * 1024): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.subarray(at, at + size));
      at += size;
    },
  });
}

test("the fixture still puts its title and copy past 250KB of inline CSS and script", () => {
  // If this fails the fixture has stopped testing the defect, whatever the rest says.
  const at = FIXTURE.indexOf("<title>");
  assert.ok(at > 250 * 1024, `<title> is at byte ${at}`);
  assert.ok(FIXTURE.indexOf("<body>") > 250 * 1024);
  // And the old 200KB read would have seen none of it.
  const old = new TextDecoder().decode(FIXTURE.subarray(0, 200 * 1024));
  assert.equal(pageTitle(old), "");
  assert.doesNotMatch(old, /We Build Brands/);
});

test("a heavy page-builder homepage yields its title, meta description and body copy", async () => {
  const page = await readPage(streamOf(FIXTURE), "text/html; charset=utf-8");
  assert.equal(page.stop, "end");
  assert.equal(page.bytes, FIXTURE.length);

  assert.equal(pageTitle(page.html), "Northgate Studio | We Build Brands and Create Entertainment");
  assert.match(metaDescription(page.html), /^Northgate Studio is a creative agency in Kingston/);

  const body = bodyText(page.html);
  assert.ok(body.length >= 200, `body text is ${body.length} chars`);
  assert.match(body, /We Build Brands and Create Entertainment/);
  assert.match(body, /full-service creative agency/);
  assert.match(body, /© 2026 Northgate Studio/);

  // None of the CSS, script, noscript, svg or comment text reached it.
  for (const junk of ["comp-k", "placeholder copy", "Not the title", "tracking pixel", "svg label", "should be stripped", "builder:"]) {
    assert.doesNotMatch(page.html, new RegExp(junk), `"${junk}" was kept`);
  }
  // The nav survives the strip, so the about page can still be followed.
  assert.match(page.html, /href="\/about-us"/);
  assert.equal(thinReason(page, body.length), null);
});

test("the raw ceiling still ends a page that is nothing but script", async () => {
  const filler = new TextEncoder().encode("<script>" + "x".repeat(PAGE_RAW_CAP + 512 * 1024) + "</script>");
  const page = await readPage(streamOf(filler, 64 * 1024), "text/html");
  assert.equal(page.stop, "raw_cap");
  assert.equal(page.bytes, PAGE_RAW_CAP);
  assert.equal(bodyText(page.html), "");
  assert.equal(thinReason(page, 0), "raw_cap");
});

test("a page still arriving when its time is up keeps what came", async () => {
  const head = new TextEncoder().encode("<html><head><title>Slow Co</title></head><body><p>Some copy.</p>");
  let sent = false;
  const dripping = new ReadableStream<Uint8Array>({
    pull(c) {
      if (!sent) {
        sent = true;
        c.enqueue(head);
      }
      // Then nothing more, ever.
      return new Promise(() => {});
    },
  });
  const page = await readPage(dripping, "text/html", 50);
  assert.equal(page.stop, "time");
  assert.equal(pageTitle(page.html), "Slow Co");
});

test("a page that gave us nothing says why, and is never treated as readable", () => {
  const jsShell = { html: '<html><head></head><body><div id="root"></div></body></html>', stop: "end" as const, scripts: 3 };
  assert.equal(thinReason(jsShell, bodyText(jsShell.html).length), "js_only");
  assert.equal(thinReason({ ...jsShell, scripts: 0 }, 0), "empty");
  assert.equal(whyThin({ stop: "aborted", scripts: 0 }), "time");
  // Any one of title, description or 200 chars of body is enough to read from.
  assert.equal(thinReason({ ...jsShell, html: "<title>Acme</title>" }, 0), null);
  assert.equal(thinReason({ ...jsShell, html: '<meta name="description" content="Acme makes widgets.">' }, 0), null);
  assert.equal(thinReason(jsShell, 200), null);
  assert.equal(thinReason(jsShell, 199), "js_only");
});
