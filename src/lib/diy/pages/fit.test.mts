import assert from "node:assert/strict";
import { test } from "node:test";

import { readings, serp } from "./fake-pages.mts";
import { type FitInput, fitChip, fitEvidence, fitVerdict, fitWords, typeByRule } from "./fit.ts";
import { advice } from "./words.ts";

/**
 * Page fit (13 Oct 2026, DIY P8; spec 10 section 6.4): each verdict, with its
 * denominator stated, and the fit copy with and without P7's count.
 */

const PAGE = "https://tallyroo.com/cloud";
const HOME = "https://tallyroo.com/";
const days = (n: number, pos: number | null, url: string | null) => Array.from({ length: n }, () => [pos, url] as [number | null, string | null]);
const input = (over: Partial<FitInput> & { serp: FitInput["serp"] }): FitInput => ({ pageKey: "tallyroo.com/cloud", pageUrl: PAGE, pageTitle: "Cloud accounting software | Tallyroo", homeKey: "tallyroo.com", titles: new Map(), basicsPass: true, schemaOk: true, ...over });
const mixed = ["https://ledgerline.com/cloud", "https://thesmallbizstack.com/best-cloud-accounting", "https://brightbook.example/features/cloud", "https://ownerledger.co/blog/cloud", "https://countwise.example/product/cloud"];
const lists = Array.from({ length: 9 }, (_, i) => `https://list-${i}.example/best-cloud-accounting-software`);

test("No page: none in the top 20 on at least 20 of the last 28 readings, with the count", () => {
  const v = fitVerdict(input({ serp: serp("k8", readings("2026-09-29", [...days(8, 14, PAGE), ...days(20, null, null)])) }));
  assert.deepEqual(v, { kind: "no_page", homepage: false, out: 20, readings: 28 });
  assert.equal(fitEvidence(v, "cloud accounting software"), "None of your pages was in the top 20 for 'cloud accounting software' on 20 of its last 28 readings.");
  assert.equal(advice("pages.fit.no_page", { keyword: "x" })!.text, "None of your pages ranks in the top 20 for 'x' yet. Pick the page you want to rank.");
});

test("No page: the homepage is what ranks", () => {
  const v = fitVerdict(input({ serp: serp("k6", readings("2026-09-29", days(28, 8, HOME))) }));
  assert.equal(v.kind, "no_page");
  assert.equal((v as { homepage: boolean }).homepage, true);
  assert.equal(fitWords(v, "x", null)!.id, "pages.fit.homepage");
});

test("out of the top 20 on fewer readings than No page asks is said as that, never a fit", () => {
  const v = fitVerdict(input({ serp: serp("k9", readings("2026-09-29", days(14, null, null))) }));
  assert.deepEqual(v, { kind: "out", out: 14, readings: 14 });
  assert.equal(fitChip(v).label, "Not in the top 20");
});

test("Two pages take turns: two of the client's URLs held it on different days, with the days each held", () => {
  const rs = readings("2026-09-29", days(28, 11, PAGE).map((d, i) => (i % 3 === 0 ? [11, "https://tallyroo.com/features/cloud"] : d)));
  const v = fitVerdict(input({ serp: serp("k3", rs) }));
  assert.equal(v.kind, "split");
  assert.deepEqual((v as { held: unknown }).held, [
    { urlKey: "tallyroo.com/cloud", days: 18 },
    { urlKey: "tallyroo.com/features/cloud", days: 10 },
  ]);
  assert.equal(fitEvidence(v, "x"), "tallyroo.com/cloud held it on 18 readings; tallyroo.com/features/cloud held it on 10 readings, of the last 28.");
  assert.equal(advice(fitWords(v, "x", null)!.id)!.chip.label, "Common practice");
});

test("Different page type: at least 7 typed results of one type, the client's own results left out, the denominator stated", () => {
  const top = [...lists.slice(0, 7), PAGE, "https://ledgerline.com/cloud", "https://ownerledger.co/blog/cloud"];
  const v = fitVerdict(input({ serp: serp("k8", readings("2026-09-29", days(28, 8, PAGE)), top) }));
  assert.deepEqual(v, { kind: "different", dominant: "best_of", n: 7, typed: 8, yours: null });
  const w = fitWords(v, "cloud accounting software", null)!;
  assert.equal(advice(w.id, w.vars)!.text, "Google answers 'cloud accounting software' with best-of lists: 7 of the 8 we could type. Two routes: get onto those best-of lists (see Opportunities), or publish your own comparison.");
  const counted = fitWords(v, "cloud accounting software", 6)!;
  assert.match(advice(counted.id, counted.vars)!.text, /\(Opportunities, 6 found\)/);
  const six = fitVerdict(input({ serp: serp("k8", readings("2026-09-29", days(28, 8, PAGE)), [...lists.slice(0, 5), ...mixed]) }));
  assert.notEqual(six.kind, "different", "6 of one type (5 lists and one more in the mix) is not enough");
});

test("Fits: none of the above, the basics pass and the schema is fine; it says 'probably', and counts its #11-#20 readings for U6", () => {
  const v = fitVerdict(input({ serp: serp("k8", readings("2026-09-29", days(28, 14, PAGE)), mixed) }));
  assert.deepEqual(v, { kind: "fits", offPage1: 28, readings: 28 });
  assert.equal(advice(fitWords(v, "x", null)!.id)!.text, "The page matches what ranks. The page is probably not the problem.");
  assert.equal(fitEvidence(v, "cloud accounting software"), "'cloud accounting software' read #11-#20 on 28 of its last 28 readings.");
  assert.deepEqual(fitVerdict(input({ basicsPass: false, serp: serp("k8", readings("2026-09-29", days(28, 14, PAGE)), mixed) })), { kind: "fix_first", what: "basics" });
  assert.deepEqual(fitVerdict(input({ schemaOk: false, serp: serp("k8", readings("2026-09-29", days(28, 14, PAGE)), mixed) })), { kind: "fix_first", what: "schema" });
  assert.deepEqual(fitVerdict(input({ serp: serp("k8", []) })), { kind: "none_read" });
});

test("only the last 28 readings count: a keyword's old split is not today's", () => {
  const rs = readings("2026-09-29", [...days(10, 12, "https://tallyroo.com/old"), ...days(28, 12, PAGE)]);
  assert.equal(fitVerdict(input({ serp: serp("k8", rs, mixed) })).kind, "fits");
});

test("page types by rule: by path, and by title for the top 3; one the rules cannot tell is null", () => {
  assert.equal(typeByRule("https://a.example/"), "homepage");
  assert.equal(typeByRule("https://a.example/ledgerline-alternatives"), "alternatives");
  assert.equal(typeByRule("https://a.example/tallyroo-vs-ledgerline"), "comparison");
  assert.equal(typeByRule("https://a.example/top-10-invoicing-apps"), "best_of");
  assert.equal(typeByRule("https://a.example/p/123", "The 12 best invoicing apps for 2026"), "best_of");
  assert.equal(typeByRule("https://a.example/blog/invoices/"), "article");
  assert.equal(typeByRule("https://a.example/pricing"), "product");
  assert.equal(typeByRule("https://a.example/cloud"), null);
});

test("Another page ranks: the homepage serving a cluster that another URL ranks for is not judged against that URL's readings - no Fits, no U6 count", () => {
  // The review's case (13 Oct 2026): 28 readings at #14, held by a URL that is not a key page; the homepage serves the cluster because no key page holds it.
  const guide = "https://tallyroo.com/blog/payroll-guide";
  const home = input({ pageKey: "tallyroo.com", pageUrl: HOME, pageTitle: "Tallyroo | Accounting", serp: serp("k9", readings("2026-09-29", days(28, 14, guide)), mixed) });
  const v = fitVerdict(home);
  assert.deepEqual(v, { kind: "elsewhere", urlKey: "tallyroo.com/blog/payroll-guide", position: 14, day: "2026-09-29" });
  assert.deepEqual(fitChip(v), { label: "Another page ranks", tone: "none" });
  assert.equal(fitEvidence(v, "payroll software"), "tallyroo.com/blog/payroll-guide held 'payroll software' at #14 at the latest reading.");
  const w = fitWords(v, "payroll software", null)!;
  assert.equal(advice(w.id, w.vars)!.text, "Another of your pages is the one that ranks for 'payroll software', so this page's fit isn't read for it. Open that page's fit, or add it as a key page.");
  // Any key page, not only the homepage: a ranking page the ranking URL has since moved away from.
  assert.equal(fitVerdict(input({ serp: serp("k8", readings("2026-09-29", days(28, 9, "https://tallyroo.com/features/cloud")), mixed) })).kind, "elsewhere");
  // Two URLs taking turns, neither of them this page: still another page's, not a split of this one.
  const twoOthers = readings("2026-09-29", days(28, 12, guide).map((d, i) => (i % 2 ? [12, "https://tallyroo.com/payroll"] : d)));
  assert.equal(fitVerdict({ ...home, serp: serp("k9", twoOthers) }).kind, "elsewhere");
  // It is judged when it is the ranking URL, or when none of the client's pages ranks.
  assert.equal(fitVerdict(input({ serp: serp("k8", readings("2026-09-29", days(28, 14, PAGE)), mixed) })).kind, "fits");
  assert.equal(fitVerdict({ ...home, serp: serp("k9", readings("2026-09-29", days(28, null, null))) }).kind, "no_page");
});

test("a page where Nomada has placed another client is neither typed nor counted", () => {
  const top = [...lists.slice(0, 7), PAGE, "https://ledgerline.com/cloud", "https://ownerledger.co/blog/cloud"];
  const rs = readings("2026-09-29", days(28, 8, PAGE));
  assert.equal(fitVerdict(input({ serp: serp("k8", rs, top) })).kind, "different");
  // One of the seven lists is another client's placement: six of one type is not enough, and it is not in the denominator either.
  const placed = new Set(["list-0.example/best-cloud-accounting-software"]);
  const v = fitVerdict(input({ placed, serp: serp("k8", rs, top) }));
  assert.equal(v.kind, "fits");
  const two = fitVerdict(input({ placed: new Set(["ownerledger.co/blog/cloud"]), serp: serp("k8", rs, top) }));
  assert.deepEqual(two, { kind: "different", dominant: "best_of", n: 7, typed: 7, yours: null }, "the denominator drops the placed page");
});
