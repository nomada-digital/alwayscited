import assert from "node:assert/strict";
import { test } from "node:test";

import { countUsage } from "../core/usage-meter.ts";
import { fakeDiyDb, testClient } from "../core/fake-diy.mts";
import { brief, pitchOutline } from "../opportunities/brief.ts";
import { ADVICE as OPP_ADVICE, PLAYBOOKS } from "../opportunities/playbooks.advice.ts";
import { whyFacts } from "../opportunities/payload.ts";
import { PITCH_ROUTES } from "../opportunities/routes.ts";
import { opportunityOf, planCandidate } from "../opportunities/status.ts";
import { EMPTY_EVIDENCE, type LinkEvidence } from "../opportunities/types.ts";

import { gapEvidence, linkWhyLine, mentionEvidence, targetEvidence } from "./evidence.ts";
import { ADVICE as LINK_ADVICE, ASK_FOR_LINK, EARN_LINK } from "./links.advice.ts";

/**
 * A row pursued or revealed from Links, on its Opportunities page and its
 * Actions card (13 Oct 2026, review of DIY P10: such a row opened on "This
 * route's method is on its own page.", a mention got the best-of-list pitch
 * "You rank tools on ...", a gap domain got none, "Why this page" was empty,
 * and the card read "Pursued from Opportunities."). Built through P7's own
 * functions, as the pages build it. Illustrative: Tallyroo and every site
 * here are made up.
 */

const TODAY = "2026-10-14";
const TARGET = { url: "https://tallyroo.com/", how: "homepage" as const };
const row = (lens: string, route: string, link: LinkEvidence) =>
  opportunityOf({ id: `opp-${lens}`, client_domain_id: "c1", lens, url: lens === "link_domain" ? "https://cashflowwire.example/" : "https://booksandbills.example/blog/our-stack", url_key: lens === "link_domain" ? "cashflowwire.example" : "booksandbills.example/blog/our-stack", domain: lens === "link_domain" ? "cashflowwire.example" : "booksandbills.example", route, status: "pursuing", evidence: { ...EMPTY_EVIDENCE(TODAY), link }, live: true, created_at: `${TODAY}T09:00:00.000Z` })!;
const ctx = { today: TODAY, brand: "Tallyroo", clusters: new Map<string, string>(), reads: new Map(), dark: false, answerLink: () => null, path: (p: string) => `/app/tallyroo${p}` };

test("every route has its method: Links' two playbooks are found by the one lookup the detail page makes, and graded once", () => {
  assert.equal(PLAYBOOKS.earn_link, EARN_LINK);
  assert.equal(PLAYBOOKS.ask_for_link, ASK_FOR_LINK);
  const gap = row("link_domain", "earn_link", gapEvidence({ names: ["ledgerline.com", "brightbook.example"], of: 3, firstSeen: "2025-02-02" }, "2026-09-10"));
  const b = brief({ opp: gap, facts: null, brand: "Tallyroo", target: TARGET });
  assert.equal(b.playbook, EARN_LINK, "never 'This route's method is on its own page.'");
  const ids = [...OPP_ADVICE, ...LINK_ADVICE].map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "each line in one advice file only");
});

test("the pitch outlines: a mention is thanked and asked whether a link would help; a gap domain is offered what was made; blanks, never send-ready", () => {
  assert.ok(PITCH_ROUTES.includes("ask_for_link") && PITCH_ROUTES.includes("earn_link"));
  const ask = pitchOutline({ route: "ask_for_link", facts: null, brand: "Tallyroo", target: TARGET })!;
  assert.equal(ask, ["Subject: Thanks for mentioning Tallyroo", "Hi [first name], thanks for naming Tallyroo in [their page title].", "Would a link to https://tallyroo.com/ help your readers who [what they would do there]?", "[your name, role]"].join("\n"));
  assert.doesNotMatch(ask, /rank tools on|criterion/, "not the best-of-list pitch");
  const earn = pitchOutline({ route: "earn_link", facts: null, brand: "Tallyroo", target: TARGET })!;
  assert.match(earn, /^Subject: \[what you made\] for readers of \[their page title\]/);
  assert.match(earn, /Tallyroo has made \[what you made\], here: https:\/\/tallyroo\.com\/\. \[The one reason it helps their readers\]\./);
  for (const text of [ask, earn]) {
    assert.match(text, /\[first name\]/);
    assert.match(text, /\[your name, role\]/);
    assert.doesNotMatch(text, /anchor|keyword|pay|price|\$/i, "no anchor request, no payment, no price");
  }
});

test("why this page, and the Actions card: what links to what, from DataForSEO's index with its dates, or our own read of a mention", () => {
  const gapEv = gapEvidence({ names: ["ledgerline.com", "brightbook.example"], of: 3, firstSeen: "2025-02-02" }, "2026-09-10");
  const gap = row("link_domain", "earn_link", gapEv);
  assert.deepEqual(whyFacts(gap, ctx), [{ text: "Links to ledgerline.com and brightbook.example, 2 of the 3 sites you compete with, and not to you. First seen 2 Feb 2025. DataForSEO estimate, read 10 Sep.", href: "/app/tallyroo/links?view=gap#gap" }]);
  assert.equal(planCandidate(gap).why[0]!.text, linkWhyLine(gapEv), "the card says where it came from, not 'Pursued from Opportunities.'");
  assert.equal(brief({ opp: gap, facts: null, brand: "Tallyroo", target: TARGET }).whatItIs.kind, "site", "a whole site is never promised a page read");
  const page = row("link_page", "earn_link", targetEvidence({ links: [{ target: "ledgerline.com", anchor: "Ledgerline" }], firstSeen: "2026-01-01" }, "2026-09-10"));
  assert.equal(whyFacts(page, ctx)[0]!.text, "Links to ledgerline.com from inside an article, with 'Ledgerline', and not to you. First seen 1 Jan 2026. DataForSEO estimate, read 10 Sep.");
  assert.equal(whyFacts(page, ctx)[0]!.href, "/app/tallyroo/links?view=targets#targets");
  const mention = row("mention", "ask_for_link", mentionEvidence("2026-09-10"));
  assert.deepEqual(whyFacts(mention, ctx), [{ text: "Names you, with no link to your site: we read the page ourselves on 10 Sep.", href: "/app/tallyroo/links?view=mentions#mentions" }]);
  // Evidence of another shape is never read back.
  const odd = opportunityOf({ id: "o", client_domain_id: "c1", lens: "mention", url: "https://a.example/", url_key: "a.example", domain: "a.example", route: "ask_for_link", status: "new", evidence: { ...EMPTY_EVIDENCE(TODAY), link: { from: "price", read_on: TODAY, links_to: [], price: 300 } }, live: true, created_at: TODAY })!;
  assert.equal(odd.evidence.link, undefined);
});

test("link checks have one count: the ledger's paid checks and verifications, and the sites logged this month - the one Settings, runOnDemand, Links and Log a site read", async () => {
  const at = "2026-10-05T10:00:00.000Z";
  const read = (action: string, status: string) => ({ id: `${action}-${status}-${Math.random()}`, client_domain_id: "c-tallyroo", door: "onpage", action, status, created_at: at });
  const fake = fakeDiyDb({
    diy_reads: [read("link_check", "ok"), read("verify", "partial"), read("verify", "failed"), read("log", "ok"), read("page_check", "ok")],
    opportunities: [
      { id: "l1", client_domain_id: "c-tallyroo", lens: "logged", status: "new", created_at: at },
      { id: "l2", client_domain_id: "c-tallyroo", lens: "logged", status: "new", created_at: "2026-09-20T10:00:00.000Z" },
      { id: "l3", client_domain_id: "c-other", lens: "logged", status: "new", created_at: at },
    ],
  });
  assert.equal(await countUsage(fake.db, testClient(), "link_checks", Date.parse("2026-10-14T12:00:00Z")), 3, "2 paid checks, 1 site logged this month; a logged site's own read and a failed one are not counted");
});
