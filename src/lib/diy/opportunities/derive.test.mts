import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { addDays } from "../../tracking/figures.ts";
import { ANSWER_SELECT, answerRow, selectColumns } from "../../tracking/read-shape.ts";

import { citedFacts } from "./cited.ts";
import { type DeriveAnswer, type DeriveInput, COMPETITOR_MIN, citedSummary, competitorBrands, derive, excludeNomadaPlacements, firstCitedAfter, isCompetitorDomain, withoutPlaced } from "./derive.ts";
import { compareOrder, orderKey } from "./order.ts";
import { headerCounts, listRow, tabCounts } from "./payload.ts";
import { opportunityOf } from "./status.ts";
import { storedRow } from "./data.ts";
import type { KindRow, PageFacts } from "./types.ts";

/**
 * The derivation (13 Oct 2026, DIY P7; spec 10 section 6.2 and 7.8's unit
 * tests): qualification and exclusions; Nomada's placements for other
 * clients subtracted from every lens, count and payload while the client's
 * own are not; the four competitor paths; lens routing; `own` rows; the
 * order tuple; and first cited after pursuing. Illustrative: Tallyroo and
 * every brand and site here are made up; "Shopify" is the AGENTS.md case.
 */

const TODAY = "2026-09-29";
const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];

type Spec = { url: string; prompts?: string[]; engines?: string[]; days?: number; named?: number; brands?: string[] };

function answers(specs: Spec[]): DeriveAnswer[] {
  const out: DeriveAnswer[] = [];
  for (const s of specs) {
    let named = s.named ?? 0;
    for (let d = 0; d < (s.days ?? 5); d++)
      for (const q of s.prompts ?? ["q1"])
        for (const e of s.engines ?? ["chatgpt", "perplexity"]) {
          const isNamed = named-- > 0;
          out.push({ run_date: addDays(TODAY, -d), question_id: q, engine: e, answered: true, named: isNamed, brands: s.brands ?? ["Brightly", "Ledgerly"], citations: [{ source_domain: new URL(s.url).hostname, url: s.url }] });
        }
  }
  return out;
}

const read = (urlKey: string, over: Partial<PageFacts> = {}): PageFacts => ({ urlKey, url: `https://${urlKey}`, readAt: `${TODAY}T03:40:00Z`, via: "own", status: "ok", http: 200, title: null, h1: null, updatedOn: null, headings: [], namesClient: false, snippet: null, brandsFound: [], linksToClient: null, linkRel: null, linkAnchor: null, ...over });

function input(specs: Spec[], over: Partial<DeriveInput> = {}): DeriveInput {
  return {
    domain: "tallyroo.com",
    today: TODAY,
    engines: ENGINES,
    answers: answers(specs),
    questions: [
      { id: "q1", cluster_id: "c1" },
      { id: "q2", cluster_id: "c1" },
      { id: "q3", cluster_id: "c2" },
    ],
    clusters: [
      { id: "c1", keyword_id: "k1" },
      { id: "c2", keyword_id: "k2" },
    ],
    keywords: [
      { id: "k1", keyword: "invoicing software", search_volume: 900 },
      { id: "k2", keyword: "bookkeeping software", search_volume: 400 },
    ],
    serpTop: [],
    reads: new Map(),
    kinds: new Map(),
    placedKeys: new Set(),
    keyPages: [],
    ...over,
  };
}

const kinds = (rows: [string, Partial<KindRow>][]) => new Map(rows.map(([k, v]) => [k, { domain_type: null, page_type: null, set_by: "model" as const, ...v }]));
const keys = (r: ReturnType<typeof derive>) => r.rows.map((x) => `${x.lens}:${x.urlKey}`).sort();

test("qualification: cited on 2 or more of the last 14 days, and not known to name the client", () => {
  const r = derive(
    input([
      { url: "https://lists.example/best-invoicing-apps", days: 3 },
      { url: "https://once.example/best-invoicing-apps", days: 1 },
      { url: "https://named.example/best-invoicing-apps", days: 4, named: 2 },
      { url: "https://read-names.example/best-invoicing-apps", days: 4 },
      { url: "https://read-leaves.example/best-invoicing-apps", days: 4, named: 1 },
      { url: "https://nobrands.example/best-invoicing-apps", days: 4, brands: [] },
    ], {
      reads: new Map([
        ["read-names.example/best-invoicing-apps", read("read-names.example/best-invoicing-apps", { namesClient: true })],
        ["read-leaves.example/best-invoicing-apps", read("read-leaves.example/best-invoicing-apps", { namesClient: false })],
      ]),
    }),
  );
  const got = keys(r).filter((k) => k.startsWith("cited:"));
  assert.deepEqual(got, ["cited:lists.example/best-invoicing-apps", "cited:read-leaves.example/best-invoicing-apps"]);
  // once: one day only; named: an answer named the client (unread falls back to every answer leaving it out);
  // read-names: the read says it names the client; nobrands: no answer named another brand.
});

test("exclusions: the client's own pages, the engines' properties, government and the encyclopaedia", () => {
  const r = derive(
    input([
      { url: "https://tallyroo.com/invoicing", days: 5 },
      { url: `https://${["blog", "tallyroo", "com"].join(".")}/best-tools`, days: 5 },
      { url: `https://${["support", "google", "com"].join(".")}/best-invoicing`, days: 5 },
      { url: "https://perplexity.ai/page/best-invoicing", days: 5 },
      { url: "https://irs.gov/businesses", days: 5 },
      { url: "https://wikipedia.org/wiki/Invoice", days: 5 },
      { url: "https://youtube.com/watch", days: 5 },
      { url: "https://kept.example/best-invoicing-apps", days: 5 },
    ]),
  );
  assert.deepEqual(keys(r).filter((k) => !k.startsWith("own:")), ["cited:kept.example/best-invoicing-apps"]);
});

test("Nomada's placements for other clients: absent from every lens, from the counts, from Cited's leaves and from the payload; the client's own are not", async () => {
  const placedKey = "placed.example/best-invoicing-apps";
  const listKey = "placedlist.example/best-bookkeeping-software";
  const spec = input(
    [
      { url: `https://${placedKey}`, days: 6 },
      { url: "https://ownplacement.example/best-invoicing-apps", days: 6 },
      { url: "https://other.example/best-invoicing-apps", days: 6 },
    ],
    {
      placedKeys: new Set([placedKey, listKey]),
      serpTop: [{ keyword_id: "k2", run_date: TODAY, top: [{ rank: 2, url: `https://${listKey}`, domain: "placedlist.example" }, { rank: 3, url: "https://free.example/best-bookkeeping-software", domain: "free.example" }] }],
      reads: new Map([[placedKey, read(placedKey)]]),
    },
  );
  const r = derive(spec);
  const all = keys(r).join(" ");
  assert.ok(!all.includes("placed.example"), "a cited page that is another client's placement makes no row");
  assert.ok(!all.includes("placedlist.example"), "nor does one on Google's page 1");
  assert.ok(all.includes("ownplacement.example"), "the client's own placement is unaffected");
  assert.ok(all.includes("free.example"));
  assert.ok(!r.unclassified.some((u) => u.urlKey === placedKey), "and it is not even sent to be classified");

  // A row the night made before the placement was logged is subtracted at read time.
  const stale = { ...r.rows[0]!, urlKey: placedKey, url: `https://${placedKey}` };
  const stored = [...r.rows, stale].map((d) => opportunityOf(storedRow("c", d, undefined, TODAY))!);
  const kept = await excludeNomadaPlacements(stored, "c", async () => new Set([placedKey]));
  assert.ok(!kept.some((o) => o.urlKey === placedKey));
  assert.equal(headerCounts(kept).total, headerCounts(stored).total - 1, "the header count drops it too");
  assert.equal(tabCounts(kept).cited, tabCounts(stored).cited - 1);
  const ctx = { today: TODAY, brand: "Tallyroo", clusters: new Map(), reads: new Map(), dark: false, answerLink: () => null, path: (p: string) => p };
  assert.ok(!JSON.stringify(kept.map((o) => listRow(o, ctx))).includes("placed.example"), "nothing in the payload names it");
  assert.deepEqual(withoutPlaced([{ urlKey: "a" }, { urlKey: "b" }], new Set(["b"])), [{ urlKey: "a" }], "the rows to keep, never the matches");

  // Cited pages ?leaves=1: the same subtraction.
  const facts = citedFacts({
    pages: [{ page: placedKey, host: "placed.example" }, { page: "other.example/best-invoicing-apps", host: "other.example" }],
    answers: spec.answers,
    range: { from: addDays(TODAY, -27), to: TODAY },
    reads: new Map([[placedKey, read(placedKey)], ["other.example/best-invoicing-apps", read("other.example/best-invoicing-apps")]]),
    kinds: new Map(),
    placedKeys: new Set([placedKey]),
    rows: kept,
  });
  assert.deepEqual([...facts.leaves], ["other.example/best-invoicing-apps"]);
});

test("competitors, path 1: Shopify named 5 times and classified a platform is no competitor, and its pages are listed", () => {
  const specs: Spec[] = [{ url: "https://shopify.example/blog/best-invoicing-apps", days: 3, prompts: ["q1"], engines: ["chatgpt"], brands: ["Shopify", "Ledgerly"] }, { url: "https://shopify.example/blog/more", days: 2, prompts: ["q2"], engines: ["chatgpt"], brands: ["Shopify"] }];
  const comp = competitorBrands(answers(specs), addDays(TODAY, -27), TODAY);
  assert.equal(comp.get("shopify")?.answers, 5);
  assert.ok(comp.get("shopify")!.answers >= COMPETITOR_MIN);
  const r = derive(input(specs, { kinds: kinds([["d:shopify.example", { domain_type: "platform" }]]) }));
  assert.ok(keys(r).includes("cited:shopify.example/blog/best-invoicing-apps"));
});

test("competitors, path 2: the same Shopify while unclassified is left out (fail closed), and is sent to be classified", () => {
  const specs: Spec[] = [{ url: "https://shopify.example/blog/best-invoicing-apps", days: 5, prompts: ["q1"], engines: ["chatgpt"], brands: ["Shopify", "Ledgerly"] }];
  const r = derive(input(specs));
  assert.ok(!keys(r).some((k) => k.includes("shopify.example")));
  assert.ok(r.unclassified.some((u) => u.domain === "shopify.example" && u.needs.includes("domain")), "an unclassified rival-looking domain waits for its type");
  assert.ok(isCompetitorDomain("shopify.example", r.competitors, new Map()), "never a non-competitor while unclassified, so it never enters a comparison set");
});

test("competitors, path 3: an unclassified rival's own 'X vs Y' page never appears, dark included", () => {
  const specs: Spec[] = [{ url: "https://brightly.example/brightly-vs-ledgerly", days: 6, brands: ["Brightly", "Ledgerly"] }];
  const dark = derive(input(specs, { reads: new Map(), kinds: new Map() }));
  assert.ok(!keys(dark).some((k) => k.includes("brightly.example")));
  const read = derive(input(specs, { reads: new Map([["brightly.example/brightly-vs-ledgerly", { ...readFacts("brightly.example/brightly-vs-ledgerly") }]]) }));
  assert.ok(!keys(read).some((k) => k.includes("brightly.example")), "a read that leaves the client out changes nothing while the type is unknown");
});
const readFacts = (k: string) => read(k);

test("competitors, path 4: a classified vendor rival is excluded; a publisher whose name is not a brand is not", () => {
  const specs: Spec[] = [
    { url: "https://ledgerly.example/ledgerly-vs-brightly", days: 6, brands: ["Brightly", "Ledgerly"] },
    { url: "https://reviewsweekly.example/best-invoicing-apps", days: 6, brands: ["Brightly", "Ledgerly"] },
  ];
  const r = derive(input(specs, { kinds: kinds([["d:ledgerly.example", { domain_type: "vendor" }]]) }));
  assert.deepEqual(keys(r).filter((k) => k.startsWith("cited:")), ["cited:reviewsweekly.example/best-invoicing-apps"]);
  // A review site is never a competitor, whatever brand it spells.
  assert.ok(!isCompetitorDomain("g2.com", new Map([["g2", {}]]), new Map()));
});

test("lens routing: threads, profiles, cited; a reference page is left out; send_correction for a comparison that names you", () => {
  const r = derive(
    input(
      [
        { url: "https://reddit.com/r/smallbusiness/comments/1/best_app", days: 4 },
        { url: "https://g2.com/categories/invoicing", days: 4 },
        { url: "https://guides.example/how-to-send-an-invoice", days: 4 },
        { url: "https://compare.example/tallyroo-vs-ledgerly", days: 4 },
      ],
      { reads: new Map([["compare.example/tallyroo-vs-ledgerly", read("compare.example/tallyroo-vs-ledgerly", { namesClient: true })]]) },
    ),
  );
  const by = new Map(r.rows.map((x) => [x.urlKey, x]));
  assert.equal(by.get("reddit.com/r/smallbusiness/comments/1/best_app")?.lens, "threads");
  assert.equal(by.get("reddit.com/r/smallbusiness/comments/1/best_app")?.route, "answer_thread");
  assert.equal(by.get("g2.com/categories/invoicing")?.lens, "profiles");
  assert.equal(by.get("g2.com/categories/invoicing")?.route, "get_listed");
  assert.equal(by.get("guides.example/how-to-send-an-invoice")?.route, "offer_resource");
  assert.equal(by.get("compare.example/tallyroo-vs-ledgerly")?.route, "send_correction");
});

test("lists: Google's top 10 best-of lists, comparisons and alternatives, not cited, not the client's, not known to name it", () => {
  const r = derive(
    input([], {
      serpTop: [
        {
          keyword_id: "k1",
          run_date: addDays(TODAY, -1),
          top: [
            { rank: 1, url: "https://tallyroo.com/invoicing", domain: "tallyroo.com" },
            { rank: 2, url: "https://lists.example/best-invoicing-software", domain: "lists.example" },
            { rank: 3, url: "https://guides.example/how-to-invoice", domain: "guides.example" },
            { rank: 4, url: "https://namesyou.example/top-10-invoicing-tools", domain: "namesyou.example" },
            { rank: 12, url: "https://deep.example/best-invoicing-tools", domain: "deep.example" },
          ],
        },
        { keyword_id: "k1", run_date: addDays(TODAY, -40), top: [{ rank: 1, url: "https://old.example/best-invoicing", domain: "old.example" }] },
      ],
      reads: new Map([["namesyou.example/top-10-invoicing-tools", read("namesyou.example/top-10-invoicing-tools", { namesClient: true })]]),
    }),
  );
  const lists = r.rows.filter((x) => x.lens === "lists");
  assert.deepEqual(lists.map((x) => x.urlKey), ["lists.example/best-invoicing-software"]);
  assert.equal(lists[0]!.evidence.rank, 2);
  assert.equal(lists[0]!.evidence.keyword, "invoicing software");
  assert.equal(lists[0]!.clusterId, "c1");
});

test("own rows: publish your own when the cluster's pages are best-of lists and you have none; refresh when yours is neither cited nor top 5", () => {
  const top = (rank: number) => ({ keyword_id: "k1", run_date: TODAY, top: [{ rank: 1, url: "https://lists.example/best-invoicing-software", domain: "lists.example" }, { rank: 2, url: "https://lists2.example/top-10-invoicing", domain: "lists2.example" }, { rank, url: "https://tallyroo.com/best-invoicing-apps", domain: "tallyroo.com" }] });
  const publish = derive(input([], { serpTop: [{ keyword_id: "k1", run_date: TODAY, top: top(3).top.slice(0, 2) }] }));
  const own = publish.rows.filter((x) => x.lens === "own");
  assert.deepEqual(own.map((x) => [x.route, x.urlKey, x.evidence.own_seen]), [["publish_own", "own:c1:best_of", 2]]);
  const refresh = derive(input([], { serpTop: [top(14)] }));
  assert.deepEqual(refresh.rows.filter((x) => x.lens === "own").map((x) => [x.route, x.urlKey]), [["refresh_own", "tallyroo.com/best-invoicing-apps"]]);
  const fine = derive(input([], { serpTop: [top(4)] }));
  assert.deepEqual(fine.rows.filter((x) => x.lens === "own"), [], "in the top 5: nothing to do");
  const keyPage = derive(input([], { serpTop: [{ keyword_id: "k1", run_date: TODAY, top: top(3).top.slice(0, 2) }], keyPages: [{ url: "https://tallyroo.com/compare/best-invoicing-apps", clusterIds: ["c1"] }] }));
  assert.deepEqual(keyPage.rows.filter((x) => x.lens === "own").map((x) => x.route), ["refresh_own"], "a key page serving the cluster counts as having one");
});

test("cluster: the cluster whose prompts produced the most citing answers, ties to the higher keyword volume", () => {
  const r = derive(input([{ url: "https://split.example/best-tools", prompts: ["q1", "q3"], days: 4 }]));
  assert.equal(r.rows.find((x) => x.urlKey === "split.example/best-tools")?.clusterId, "c1", "a tie goes to invoicing software, 900 a month");
  const r2 = derive(input([{ url: "https://split.example/best-tools", prompts: ["q3"], days: 4 }, { url: "https://split.example/best-tools", prompts: ["q1"], days: 2 }]));
  assert.equal(r2.rows.find((x) => x.urlKey === "split.example/best-tools")?.clusterId, "c2");
});

test("evidence: our counts only - answers, those leaving you out, prompts, engines in tier order, competitors, days, rank", () => {
  const r = derive(input([{ url: "https://lists.example/best-invoicing-apps", prompts: ["q1", "q2"], engines: ["perplexity", "chatgpt"], days: 3, brands: ["Ledgerly", "Brightly"] }]));
  const e = r.rows.find((x) => x.lens === "cited")!.evidence;
  assert.equal(e.answers, 12);
  assert.equal(e.leaves_out, 12);
  assert.equal(e.prompt_count, 2);
  assert.deepEqual(e.engines, ["chatgpt", "perplexity"]);
  assert.deepEqual(e.competitors, ["Brightly", "Ledgerly"]);
  assert.equal(e.days_14, 3);
  assert.equal(e.days_7, 3);
  assert.equal(e.last_cited, TODAY);
  assert.deepEqual(e.open, { prompt: "q1", day: TODAY, engine: "chatgpt" });
  assert.deepEqual(Object.keys(e).sort(), ["answers", "competitors", "days_14", "days_7", "engines", "keyword", "last_cited", "leaves_out", "open", "others_named", "prompt_count", "prompts", "rank", "to"]);
});

test("the order tuple: leaving-out answers, prompts, best-of or comparison, top 10, cited this week, newest", () => {
  const e: { leaves_out: number; prompt_count: number; rank: number | null; days_7: number } = { leaves_out: 5, prompt_count: 2, rank: null, days_7: 1 };
  const k = (over: Partial<typeof e>, type: Parameters<typeof orderKey>[1] = null, seen = "2026-09-01") => ({ key: orderKey({ ...e, ...over }, type, seen), urlKey: JSON.stringify(over) + type + seen });
  const sorted = [k({}, null), k({ leaves_out: 9 }), k({ prompt_count: 4 }), k({}, "best_of"), k({ rank: 4 }), k({ days_7: 0 }), k({}, null, "2026-09-20")].sort(compareOrder).map((x) => x.urlKey);
  assert.deepEqual(sorted, [
    JSON.stringify({ leaves_out: 9 }) + "null2026-09-01",
    JSON.stringify({ prompt_count: 4 }) + "null2026-09-01",
    JSON.stringify({}) + "best_of2026-09-01",
    JSON.stringify({ rank: 4 }) + "null2026-09-01",
    JSON.stringify({}) + "null2026-09-20",
    JSON.stringify({}) + "null2026-09-01",
    JSON.stringify({ days_7: 0 }) + "null2026-09-01",
  ]);
});

test("first cited after pursuing: per engine, the first day after the pursuit, kept once found", () => {
  const a = answers([{ url: "https://lists.example/best-invoicing-apps", engines: ["chatgpt"], days: 6 }]);
  const first = firstCitedAfter(a, "lists.example/best-invoicing-apps", addDays(TODAY, -3));
  assert.deepEqual(first, { chatgpt: { day: addDays(TODAY, -2), prompt: "q1" } }, "the pursuit's own day is before it");
  const kept = firstCitedAfter(a, "lists.example/best-invoicing-apps", addDays(TODAY, -3), { chatgpt: { day: "2026-09-01", prompt: "q9" } });
  assert.deepEqual(kept.chatgpt, { day: "2026-09-01", prompt: "q9" });
  assert.deepEqual(firstCitedAfter(a, "other.example/x", addDays(TODAY, -3)), {});
});

test("a cited URL that is not a web address is never kept as one", async () => {
  const { citationKey } = await import("./derive.ts");
  assert.equal(citationKey({ source_domain: "lists.example", url: "javascript:alert(1)" })?.url, "https://lists.example/");
  assert.equal(citationKey({ source_domain: "lists.example", url: "https://lists.example/best" })?.url, "https://lists.example/best");
  assert.equal(citationKey({ source_domain: "", url: "https://lists.example/best" })?.host, "lists.example", "a URL alone gives its host");
});

/**
 * The cited tab's empty state on its narrow read (13 Oct 2026, review of the dashboard speed work). The page begins
 * that read on every view of the cited tab, the default one, and throws it away whenever the tab has rows, so it reads
 * the answers' citations without their brands (world.ts citedWorld, read-shape.ts "cites"). Held here to summarise
 * exactly what the whole read does - an unread brand answer, the client's own page and an engine's property among
 * them - and the read held to that shape, as read-shape.test.mts holds the dashboard's narrow reads.
 */
test("the cited tab's empty-state summary is the same on its citations-only read as on the whole read", () => {
  const whole = answers([
    { url: "https://lists.example/best-invoicing-apps", named: 3 },
    { url: "https://forum.example/thread/1", prompts: ["q1", "q3"], brands: ["Brightly"] },
    { url: "https://tallyroo.com/pricing", prompts: ["q3"] },
    { url: "https://perplexity.ai/page/best-invoicing" },
  ]).map((a, i): DeriveAnswer => (i % 7 === 0 ? { ...a, brands_ok: false } : a));
  const narrow: DeriveAnswer[] = whole.map((a) => answerRow(selectColumns(a, ANSWER_SELECT.cites)));
  assert.ok(whole.some((a) => a.brands.length > 0) && narrow.every((a) => a.brands.length === 0 && a.brands_ok === undefined), "the narrow read kept a brand");
  const reads = new Map([["lists.example/best-invoicing-apps", read("lists.example/best-invoicing-apps", { namesClient: true })]]);
  const at = { questions: input([]).questions, today: TODAY, domain: "tallyroo.com", engines: ENGINES };
  const summary = citedSummary({ ...at, answers: whole }, reads);
  assert.deepEqual(summary, { pages: 2, readNamingYou: 1, own: 1 }, "the whole read's summary is not the one this test was written for, so it compares less than it says");
  assert.deepEqual(citedSummary({ ...at, answers: narrow }, reads), summary);
  const world = readFileSync(new URL("./world.ts", import.meta.url), "utf8");
  assert.match(world, /return trackingWorld\(repo, client, \{ structure, answers: "cites" \}\);/, "citedWorld no longer reads the narrow shape");
  assert.match(world, /answers: opts\.answers \?\? "full"/, "the derivation's read is no longer whole by default");
  assert.match(readFileSync(new URL("../../../app/app/[client]/opportunities/page.tsx", import.meta.url), "utf8"), /lens === "cited" \? citedWorld\(repo, client, structureP\)/);
});
