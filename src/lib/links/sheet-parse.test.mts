import assert from "node:assert/strict";
import { test } from "node:test";

import { clientNames, parseLinkSheet, sheetDate, sheetNumber, sheetRef, urlKey } from "./sheet-parse.ts";

// Shaped like WLDM's tracker: a title block, then the header, a Price column at the end, a prospect row for another site.
const insertions = [
  ["", "", "", "[ Client logo ]"],
  ["Example Co · Backlink Tracker"],
  [],
  ["Month", "#", "Page URL", "DR", "Page Traffic", "Total Traffic ", "Highest ranking kwrd", "Status", "Anchor", "Target Link", "NOTE", "Price"],
  ["July ", "1", "https://blog.example.org/best-tools/", "57", "1.3k", "9k", "seo tool api", "Live", " best tools", "https://example.com/", "", "£120"],
  ["", "2", "https://www.news.example.net/a?utm=x", "", "", "", "", "Pending", "", "https://example.com/pricing", "", "£80"],
  ["", "3", "https://other.example.org/x", "40", "10", "", "", "Live", "", "https://not-this-client.test/", "", "£50"],
  ["", "4", "https://blog.example.org/best-tools", "57", "11", "", "", "Live", "", "https://example.com/", "", ""],
];

// Shaped like Kev's tracker: every client on one tab, DA, no anchor, target or status column.
const placements = [
  ["Client", "Target keyword", "Listicle (L) or Guest Post (GP)", "Listicle / guest Post title", "Publication / placement site", "Date it went live", "Links", "DA", "Domain traffic", "Page traffic"],
  ["Example", "example keyword", "L", "Best things", "https://mag.example.org/best/", "14/04/2026", "2 links", "73", "22.6k", "0"],
  ["Someone Else", "other keyword", "GP", "Other", "https://mag.example.org/other/", "15/04/2026", "1 link", "60", "1k", "5"],
];

const subject = { domain: "example.com", brand: "Example", slug: "example-com" };

test("insertions: header found below the title block, mapped by name, the Price column never read", () => {
  const p = parseLinkSheet(insertions, subject);
  assert.equal(p.error, null);
  assert.equal(p.rows.length, 2, "the other site's row and the repeat are left out");
  assert.deepEqual(p.skipped, { other_client: 1, no_url: 0, repeats: 1 });
  const [a, b] = p.rows;
  assert.equal(a!.live_url, "https://blog.example.org/best-tools/");
  assert.equal(a!.linking_domain, "blog.example.org");
  assert.equal(a!.authority, 57);
  assert.equal(a!.authority_label, "DR");
  assert.equal(a!.page_traffic, 1300);
  assert.equal(a!.anchor_text, "best tools");
  assert.equal(a!.target_page, "https://example.com/");
  assert.equal(a!.status, "Live");
  assert.equal(a!.live_month, "July");
  assert.equal(a!.target_keyword, null, "'Highest ranking kwrd' is the linking page's keyword, not the target: left empty");
  assert.equal(a!.live_on, null, "no date column: no date made up");
  assert.equal(b!.authority, null);
  assert.equal(b!.authority_label, null, "no figure, no label");
  assert.equal(b!.live_month, "July", "a blank month carries the one above");
  for (const r of p.rows) assert.ok(!JSON.stringify(r).includes("£"), "no price reaches a row");
  assert.ok(!Object.values(p.columns).some((h) => /price/i.test(h)));
});

test("placements: only this client's rows, DA labelled DA, the UK date read", () => {
  const p = parseLinkSheet(placements, subject);
  assert.equal(p.rows.length, 1);
  assert.equal(p.skipped.other_client, 1);
  const r = p.rows[0]!;
  assert.equal(r.authority_label, "DA");
  assert.equal(r.authority, 73);
  assert.equal(r.live_on, "2026-04-14");
  assert.equal(r.target_keyword, "example keyword");
  assert.equal(r.page_traffic, 0);
  assert.equal(r.anchor_text, null);
  assert.equal(r.target_page, null);
  assert.equal(r.status, null, "the sheet has no status column");
  assert.equal(p.columns.live_url, "Publication / placement site");
});

test("columns are found by header wherever they sit", () => {
  const moved = placements.map((r) => [...r].reverse());
  const p = parseLinkSheet(moved, subject);
  assert.equal(p.rows[0]!.live_url, "https://mag.example.org/best/");
  assert.equal(p.rows[0]!.authority, 73);
});

test("a money header is refused even when it names a field", () => {
  const p = parseLinkSheet([["Page URL", "DR price", "Status"], ["https://a.example.org/x", "£40", "Live"]], subject);
  assert.equal(p.rows[0]!.authority, null);
  assert.equal(p.columns.authority, undefined);
});

test("no header row, or an empty sheet, is an error and no rows", () => {
  assert.match(parseLinkSheet([["a", "b"], ["c", "d"]], subject).error!, /No header row/);
  assert.match(parseLinkSheet([], subject).error!, /empty/);
});

test("the small readers", () => {
  assert.equal(urlKey("HTTPS://WWW.Example.com/a/?q=1#x"), "example.com/a");
  assert.equal(sheetNumber("2,400"), 2400);
  assert.equal(sheetNumber("-"), null);
  assert.equal(sheetDate("31/02/2026"), null);
  assert.equal(sheetDate("3 Oct 2026"), "2026-10-03");
  assert.ok(clientNames({ domain: "common.example", brand: null, slug: "common-example" }).has("common"));
  assert.deepEqual(sheetRef("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=42"), { id: "1AbCdEfGhIjKlMnOpQrStUvWxYz", gid: 42 });
  assert.equal(sheetRef("https://example.com/sheet"), null);
});
