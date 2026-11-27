import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { blockedHost, checkLink, findLink } from "./check.ts";
import { stageOfStatus } from "./stage.ts";
import { OVERRIDE_STATUSES, applyOverride, isOverrideStatus, sheetAgrees, stageOfOverride as stageOf, stateOfOverride, type Override } from "./override-rules.ts";

/**
 * Manual overrides on placements and link insertions (25 Nov 2026): the stage rules, how an override sits over the
 * sheet's row and when the sheet has caught up, the link check, and the migration read as text.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SQL = readFileSync(path.join(ROOT, "supabase/migrations/20261125010000_link_overrides.sql"), "utf8").replace(/--[^\n]*/g, "");

const row: { kind: string; url_key: string; live_url: string; anchor_text: string | null; status: string | null; live_on: string | null; state?: string | null } = { kind: "placement", url_key: "agilityportal.io/blog/best-cms-for-intranet", live_url: "https://agilityportal.io/blog/best-cms-for-intranet", anchor_text: null as string | null, status: "In progress" as string | null, live_on: null as string | null };
const live: Override = { source: "sheet_link", kind: "placement", item_key: row.url_key, status: "Live", live_url: "https://agilityportal.io/blog/best-cms-for-intranet", anchor_text: "craft cms agency", live_on: "2026-11-20", active: true };

test("stages: the same three the customer's pill reads, and every override status reads as intended", () => {
  assert.equal(stageOf("Live"), "live");
  assert.equal(stageOf("Published"), "live");
  assert.equal(stageOf("In progress"), "progress");
  assert.equal(stageOf("Content written"), "progress");
  assert.equal(stageOf("Awaiting publication"), "progress");
  assert.equal(stageOf("Lost - removed"), "off");
  assert.equal(stageOf("Not live"), "off");
  assert.equal(stageOfStatus(null), "progress");
  assert.deepEqual(OVERRIDE_STATUSES.map(stageOf), ["progress", "progress", "live", "live", "off"]);
  assert.equal(isOverrideStatus("Live"), true);
  assert.equal(isOverrideStatus("live"), false);
  assert.equal(isOverrideStatus("Whatever"), false);
});

test("an override wins over the sheet's row, and only its own row", () => {
  const merged = applyOverride(row, live);
  assert.equal(merged.status, "Live");
  assert.equal(merged.live_on, "2026-11-20");
  assert.equal(merged.anchor_text, "craft cms agency");
  assert.equal(merged.state, "live", "state is set too, so one the audit wrote cannot outrank the override");
  assert.equal(applyOverride({ ...row, state: "in_review" }, live).state, "live");
  assert.deepEqual(OVERRIDE_STATUSES.map(stateOfOverride), ["in_progress", "in_progress", "live", "live", "removed"]);
  assert.equal(merged.url_key, row.url_key, "the key stays the sheet's, so the next sync still matches it");
  assert.equal(row.status, "In progress", "the sheet's row is not mutated");
  const partial = applyOverride({ ...row, anchor_text: "from the sheet", live_on: "2026-11-01" }, { ...live, anchor_text: null, live_on: null, live_url: null });
  assert.equal(partial.anchor_text, "from the sheet", "a field the override leaves empty is the sheet's");
  assert.equal(partial.live_on, "2026-11-01");
});

test("the sheet has caught up when it reads the same stage (and, live, the same page); not before", () => {
  assert.equal(sheetAgrees({ status: "In progress", live_url: row.live_url }, live), false, "still behind: the override stands");
  assert.equal(sheetAgrees({ status: "Live", live_url: row.live_url }, live), true);
  assert.equal(sheetAgrees({ status: "Published", live_url: "https://www.agilityportal.io/blog/best-cms-for-intranet/" }, live), true, "wording and a www differ, the page is the same");
  assert.equal(sheetAgrees({ status: "Live", live_url: "https://agilityportal.io/blog/another" }, live), false, "live, but a different page");
  assert.equal(sheetAgrees({ status: "Lost" , live_url: row.live_url }, live), false);
  assert.equal(sheetAgrees(null, live), false, "a row that is not on the sheet is not agreement");
  assert.equal(sheetAgrees({ status: "Awaiting publication", live_url: "" }, { status: "Content written", live_url: null }), true, "two in-progress wordings are the same stage");
});

test("link check: finds a link to the customer's domain or a subdomain, with its anchor and rel", () => {
  const html = `<p>Many businesses also work with a <a href="https://www.common.agency/craft-cms" title="x">craft cms <b>agency</b></a> to customise.</p><a href="https://other.com">no</a>`;
  const hit = findLink(html, "common.agency");
  assert.deepEqual(hit, { href: "https://www.common.agency/craft-cms", anchor: "craft cms agency", rel: null });
  assert.equal(findLink(`<a href='https://blog.common.agency/x' rel="nofollow sponsored">x &amp; y</a>`, "common.agency")?.rel, "nofollow sponsored");
  assert.equal(findLink(`<a href="https://notcommon.agency/">x</a><a href="mailto:a@common.agency">m</a><a href="/relative">r</a>`, "common.agency"), null, "a lookalike host, a mailto and a relative link are not ours");
  assert.equal(findLink(`<a href="/about">about</a>`, "common.agency", "https://agilityportal.io/blog/x"), null, "a relative link on the publisher's page points at the publisher");
});

test("link check: never fetches a private address, however it is spelled or reached", async () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.9", "172.16.5.5", "169.254.169.254", "100.64.0.1", "[::1]", "metadata.internal", "intranet", "0.0.0.0", "foo.local"]) assert.equal(blockedHost(h), true, h);
  for (const h of ["agilityportal.io", "8.8.8.8", "common.agency", "172.15.0.1", "172.32.0.1"]) assert.equal(blockedHost(h), false, h);
  const calls: string[] = [];
  const spy = (async (u: URL | string) => { calls.push(String(u)); return new Response("", { status: 200 }); }) as typeof fetch;
  assert.equal((await checkLink("http://127.0.0.1/x", "a.com", { fetchImpl: spy })).ok, false);
  assert.equal((await checkLink("file:///etc/passwd", "a.com", { fetchImpl: spy })).ok, false);
  assert.equal((await checkLink("https://sneaky.example/", "a.com", { fetchImpl: spy, resolve: async () => ["10.0.0.5"] })).ok, false, "a public name that resolves to a private address");
  assert.equal(calls.length, 0, "none of those was fetched");
  const hop = (async (u: URL | string) => { calls.push(String(u)); return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest" } }); }) as unknown as typeof fetch;
  const r = await checkLink("https://good.example/", "a.com", { fetchImpl: hop, resolve: async () => ["93.184.216.34"] });
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ["https://good.example/"], "a redirect into a private address is stopped before it is followed");
});

test("link check: pass, fail (no link), fail (404), and a redirect that lands on the page", async () => {
  const resolve = async () => ["93.184.216.34"];
  const page = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
  const pass = await checkLink("https://agilityportal.io/p", "common.agency", { fetchImpl: page(`<a href="https://www.common.agency/craft-cms">craft cms agency</a>`), resolve, now: () => new Date("2026-11-25T10:00:00Z") });
  assert.equal(pass.ok, true);
  assert.equal(pass.found, true);
  assert.equal(pass.anchor, "craft cms agency");
  assert.equal(pass.checked_at, "2026-11-25T10:00:00.000Z");
  const none = await checkLink("https://agilityportal.io/p", "common.agency", { fetchImpl: page("<p>nothing</p>"), resolve });
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /no link to common\.agency/);
  assert.match((await checkLink("https://agilityportal.io/p", "common.agency", { fetchImpl: page("gone", 404), resolve })).error ?? "", /answered 404/);
  let n = 0;
  const redirect = (async () => (n++ === 0 ? new Response("", { status: 301, headers: { location: "/blog/new" } }) : new Response(`<a href="https://common.agency/">c</a>`, { status: 200 }))) as typeof fetch;
  const r = await checkLink("https://agilityportal.io/old", "common.agency", { fetchImpl: redirect, resolve });
  assert.equal(r.ok, true);
  assert.equal(r.final_url, "https://agilityportal.io/blog/new");
});

test("migration: additive, one row per item, service role only, history stays in agency_edits", () => {
  assert.match(SQL, /create table if not exists public\.link_overrides/);
  assert.match(SQL, /unique \(client_domain_id, source, item_key\)/);
  assert.match(SQL, /source\s+text not null check \(source in \('sheet_link', 'progress'\)\)/);
  assert.match(SQL, /alter table public\.link_overrides enable row level security/);
  assert.doesNotMatch(SQL, /create policy|\bdrop\b|\btruncate\b|\bdelete from\b|alter table (?!public\.link_overrides)/i);
});
