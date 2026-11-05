import assert from "node:assert/strict";
import { test } from "node:test";

import type { Listing } from "./fatgrid-request.ts";
import { PER_MONTH, rankShortlist } from "./shortlist-rank.ts";

// Made-up hosts and prices: no Fatgrid data is ever written into this public repository.
const listing = (domain: string, dr: number, traffic: number, offers: [("guest_post" | "link_insertion"), number][]): Listing => ({
  domain, dr, traffic, bestPrice: Math.min(...offers.map((o) => o[1])), offers: offers.map(([type, price]) => ({ type, price })), categories: [], language: "en", sponsored: false, linkFollow: "dofollow",
});

const base = {
  clientDomain: "client.example",
  clientDr: null as number | null,
  floor: 50,
  keyword: "craft cms agency",
  cited: [
    { opportunityId: "o1", url: "https://lists.example/best-agencies", domain: "lists.example", route: "ask_added", answers: 12 },
    { opportunityId: "o2", url: "https://blog.example/guide", domain: "blog.example", route: "offer_resource", answers: 4 },
    { opportunityId: "o3", url: "https://notbuyable.example/x", domain: "notbuyable.example", route: "ask_added", answers: 30 },
  ],
  listings: new Map([
    ["lists.example", listing("lists.example", 35, 800, [["link_insertion", 120], ["guest_post", 260]])],
    ["blog.example", listing("blog.example", 60, 20000, [["guest_post", 300]])],
  ]),
  inventory: [
    { listing: listing("cheap.example", 55, 9000, [["guest_post", 90]]), offer: "guest_post" as const },
    { listing: listing("dear.example", 70, 80000, [["guest_post", 640]]), offer: "guest_post" as const },
    { listing: listing("weak.example", 30, 50000, [["guest_post", 50]]), offer: "guest_post" as const },
    { listing: listing("dead.example", 65, 10, [["guest_post", 60]]), offer: "guest_post" as const },
    { listing: listing("client.example", 65, 10000, [["guest_post", 60]]), offer: "guest_post" as const },
  ],
};

test("a cited list page on a buyable host is a link insertion the client can see; a cited host taking guest posts is a new listicle", () => {
  const items = rankShortlist(base);
  const byKey = new Map(items.map((i) => [`${i.domain}|${i.kind}`, i]));
  const ins = byKey.get("lists.example|link_insertion")!;
  assert.equal(ins.pageUrl, "https://lists.example/best-agencies");
  assert.equal(ins.clientVisible, true, "client can see this one, we can buy it");
  assert.equal(ins.dr, 35, "a cited host is kept below the floor: the engines citing it is the evidence");
  assert.equal(byKey.get("blog.example|new_listicle")!.clientVisible, true);
  assert.equal(items.some((i) => i.domain === "notbuyable.example"), false, "not on Fatgrid, not on the shortlist");
});

test("inventory must reach the floor and show traffic; the client's own domain is never bought", () => {
  const domains = rankShortlist(base).map((i) => i.domain);
  assert.ok(domains.includes("cheap.example") && domains.includes("dear.example"));
  for (const d of ["weak.example", "dead.example", "client.example"]) assert.equal(domains.includes(d), false, d);
});

test("month 1 is the cheap quick wins, cited and pricier items follow; over $500 is flagged", () => {
  const items = rankShortlist(base);
  assert.equal(items.find((i) => i.domain === "cheap.example")!.queueMonth, 1);
  assert.notEqual(items.find((i) => i.domain === "lists.example")!.queueMonth, 1, "cited items are the higher-impact months");
  assert.match(items.find((i) => i.domain === "dear.example")!.note ?? "", /Over \$500/);
  assert.ok(items.filter((i) => i.queueMonth === 2).length <= PER_MONTH);
});

test("the client's own listicle only when its DR reaches the floor", () => {
  assert.equal(rankShortlist(base).some((i) => i.ownSite), false, "no DR known, no own-site listicle");
  assert.equal(rankShortlist({ ...base, clientDr: 42 }).some((i) => i.ownSite), false, "below the floor");
  const own = rankShortlist({ ...base, clientDr: 58 }).find((i) => i.ownSite)!;
  assert.deepEqual([own.domain, own.kind, own.queueMonth], ["client.example", "new_listicle", 1]);
});
