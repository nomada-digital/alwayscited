import assert from "node:assert/strict";
import { test } from "node:test";

import { countUsage } from "../core/usage-meter.ts";
import { fakeDiyDb, testClient } from "../core/fake-diy.mts";
import { opportunityOf, planCandidate } from "../opportunities/status.ts";
import { EMPTY_EVIDENCE, type LinkEvidence } from "../opportunities/types.ts";

import { gapEvidence, linkWhyLine, mentionEvidence, targetEvidence } from "./evidence.ts";

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
const row = (lens: string, route: string, link: LinkEvidence) =>
  opportunityOf({ id: `opp-${lens}`, client_domain_id: "c1", lens, url: lens === "link_domain" ? "https://cashflowwire.example/" : "https://booksandbills.example/blog/our-stack", url_key: lens === "link_domain" ? "cashflowwire.example" : "booksandbills.example/blog/our-stack", domain: lens === "link_domain" ? "cashflowwire.example" : "booksandbills.example", route, status: "pursuing", evidence: { ...EMPTY_EVIDENCE(TODAY), link }, live: true, created_at: `${TODAY}T09:00:00.000Z` })!;

// 19 Oct 2026: "every route has its method" and "the pitch outlines" are retired, and "why this page" keeps only its
// live half. Their subjects - opportunities/brief.ts, playbooks.advice.ts, payload.ts (whyFacts) and links.advice.ts -
// were deleted with the old /app dashboard (commit 78b1023); nothing on the dashboards host reads them.

test("the Actions card says what links to what, from DataForSEO's index with its dates, or our own read of a mention", () => {
  const gapEv = gapEvidence({ names: ["ledgerline.com", "brightbook.example"], of: 3, firstSeen: "2025-02-02" }, "2026-09-10");
  const gap = row("link_domain", "earn_link", gapEv);
  assert.equal(planCandidate(gap).why[0]!.text, linkWhyLine(gapEv), "the card says where it came from, not 'Pursued from Opportunities.'");
  const pageEv = targetEvidence({ links: [{ target: "ledgerline.com", anchor: "Ledgerline" }], firstSeen: "2026-01-01" }, "2026-09-10");
  assert.equal(planCandidate(row("link_page", "earn_link", pageEv)).why[0]!.text, linkWhyLine(pageEv));
  const mentionEv = mentionEvidence("2026-09-10");
  assert.equal(planCandidate(row("mention", "ask_for_link", mentionEv)).why[0]!.text, linkWhyLine(mentionEv));
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
