import assert from "node:assert/strict";
import { test } from "node:test";

import { USAGE_EVENTS, dashPath, readUsage, usagePath, usageProps, usageSlug, weekOf, weeklyUsage } from "./usage.ts";

// 13 Oct 2026, DIY P5: twenty - the brief's sixteen and wave 1's plan_move, plan_task_added, plan_hidden and ai_filter.
// 13 Oct 2026, DIY P9: thirty-one - wave 2's eleven, as P6, P7 and P8 handed them over (usage.ts says what each records).
// 13 Oct 2026, DIY P10: thirty-four - wave 3's three on Links: link_reveal, link_check and link_pursue.
test("the event list is the brief's sixteen, T10 (30 Sep 2026), DIY wave 1's four, wave 2's eleven and wave 3's three (13 Oct 2026)", () => {
  assert.equal(USAGE_EVENTS.length, 34);
  assert.deepEqual(USAGE_EVENTS.slice(16, 20), ["plan_move", "plan_task_added", "plan_hidden", "ai_filter"]);
  assert.deepEqual(USAGE_EVENTS.slice(20, 31), [
    "gaining_track", "gaining_dismiss", "opportunity_status", "opportunity_log", "prompt_offer", "brief_copy",
    "key_page_add", "page_check", "example_request", "fix_copy", "example_copy",
  ]);
  assert.deepEqual(USAGE_EVENTS.slice(31), ["link_reveal", "link_check", "link_pursue"]);
  for (const e of USAGE_EVENTS) assert.ok(e.length >= 2 && e.length <= 60, `${e}: dashboard_events.event holds 2-60 characters`);
  assert.ok(!(USAGE_EVENTS as readonly string[]).includes("keyword_checked"), "the spend cap's row is not a usage event");
});

test("a path is reduced to its route: no slug, no query, no id", () => {
  assert.equal(usagePath("/app/acme"), "/");
  assert.equal(usagePath("/app/acme/"), "/");
  assert.equal(usagePath("/app/acme/clusters?filter=never"), "/clusters");
  assert.equal(usagePath("/app/acme/clusters/0b6f9f4e-1111-4222-8333-444455556666?prompt=abc"), "/clusters/[cluster]");
  assert.equal(usagePath("/app/acme/placements#t"), "/placements");
  assert.equal(usagePath("/app/acme/plan?view=list&status=done"), "/plan");
  assert.equal(usagePath("/app/acme/ai?missing=1"), "/ai");
  assert.equal(usagePath("/app/login"), null);
  assert.equal(usagePath("/app/parity/x"), null);
  assert.equal(usagePath("/pricing"), null);
  assert.equal(usagePath("/app/acme/best invoicing software"), null, "free text never passes as a route");
  assert.equal(usagePath(42), null);
});

test("the slug is read only from a client's dashboard path", () => {
  assert.equal(usageSlug("/app/acme/clusters"), "acme");
  assert.equal(usageSlug("/app/acme?from=2026-09-01"), "acme");
  assert.equal(usageSlug("/app/login"), null);
  assert.equal(usageSlug("/pricing"), null);
});

test("props keep known keys with id-shaped values only - no content", () => {
  assert.deepEqual(usageProps({ preset: "30d", engine: "chatgpt", note: "hello", cta: "Best invoicing software" }), { preset: "30d", engine: "chatgpt" });
  assert.deepEqual(usageProps("x"), {});
  assert.deepEqual(usageProps(null), {});
});

test("an unknown event is refused", () => {
  assert.equal(readUsage({ event: "keyword_checked" }), null);
  assert.equal(readUsage({ event: "drop table" }), null);
  assert.equal(readUsage(null), null);
  assert.deepEqual(readUsage({ event: "view", path: "/app/acme/clusters?x=1", props: { preset: "7d" } }), { event: "view", path: "/clusters", props: { preset: "7d" } });
});

test("weeks start on Monday, UTC", () => {
  assert.equal(weekOf("2026-09-30T12:00:00Z"), "2026-09-28");
  assert.equal(weekOf("2026-09-28T00:00:00Z"), "2026-09-28");
  assert.equal(weekOf("2026-09-27T23:59:59Z"), "2026-09-21");
});

test("weekly counts per client and event, newest week first", () => {
  const rows = [
    { client_domain_id: "a", event: "view", created_at: "2026-09-29T10:00:00Z" },
    { client_domain_id: "a", event: "view", created_at: "2026-09-30T10:00:00Z" },
    { client_domain_id: "a", event: "csv", created_at: "2026-09-30T11:00:00Z" },
    { client_domain_id: "b", event: "view", created_at: "2026-09-22T10:00:00Z" },
    { client_domain_id: "b", event: "keyword_checked", created_at: "2026-09-30T10:00:00Z" },
    { client_domain_id: null, event: "view", created_at: "2026-09-30T10:00:00Z" },
  ];
  assert.deepEqual(weeklyUsage(rows, ["b", "a"]), [
    { week: "2026-09-28", client: "a", counts: { view: 2, csv: 1 }, total: 3 },
    { week: "2026-09-21", client: "b", counts: { view: 1 }, total: 1 },
  ]);
});

/**
 * Census (R98, 30 Sep 2026): every usage event has a sender in the tree - a
 * `data-usage` control, a `data-usage-open/close` panel, UpgradePrompt's
 * `data-usage-shown`, the beacon's own `view`, or a route's recordUsage.
 * An event with none is a column /admin/tracking/usage would show as zero
 * forever, which reads as "nobody uses it".
 */
test("every usage event has a sender, bar the recorded exemption", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(import.meta.dirname, "..", "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
    }
  };
  // 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards host. src/app/app and
  // src/components/app went with it - the beacon (UsageBeacon), every data-usage control and panel, UpgradePrompt's
  // data-usage-shown and the copy buttons (CopyButton, CopyBlock) - so the walk is the routes and the dashboards
  // host's tree. 93 files that day; the floor moves from 30 to 80.
  // 19 Oct 2026: commit 78b1023 deleted every app/api/app route but login and [client]/member with the old /app
  // dashboard's remaining code; 71 files that day, so the floor moves from 80 to 70.
  for (const d of ["app/api/app", "app/dashboards", "components/dash", "lib/dash"]) walk(join(root, d));
  assert.ok(files.length >= 70, `walked ${files.length} files, floor 70`);
  const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
  // No range control exists yet: the date on /app is display only (30 Sep 2026).
  const EXEMPT: Record<string, string> = { range_change: "no range picker is built; the date range is display only" };
  // 18 Oct 2026, brief 2d: the events only /app's pages sent. The dashboards host sends no usage event, so each of
  // these is a column /admin/tracking/usage shows as zero from today - recorded, not hidden: each is re-earned
  // below (still no sender), so the list can only shrink as the dashboards host takes events up.
  // 19 Oct 2026: the second row - the events only the /api/app routes recorded (recordUsage), each route deleted with
  // the old /app dashboard's remaining code (commit 78b1023): cluster, stop, report, ask, hide, plan, keywords,
  // opportunity, prompt-offer, pages and links. Recorded on the same terms as the first row: still no sender, re-earned
  // below, and the list can only shrink as the dashboards host takes events up.
  const RETIRED_WITH_APP: string[] = [
    "view", "compare_change", "engine_toggle", "add_open", "add_abandon", "detail_open", "placement_select", "cta_shown", "cta_click", "ai_filter", "gaining_track", "brief_copy", "fix_copy", "example_copy",
    "add_save", "stop", "undo", "csv", "cta_ask", "cta_hide", "plan_move", "plan_task_added", "plan_hidden", "gaining_dismiss", "opportunity_status", "opportunity_log", "prompt_offer", "key_page_add", "page_check", "example_request", "link_reveal", "link_check", "link_pursue",
  ];
  const sent = (e: string) =>
    src.includes(`data-usage="${e}"`) ||
    src.includes(`usage="${e}"`) ||
    src.includes(`"${e}"`) && (src.includes(`event: "${e}"`) || new RegExp(`event: [^,}]*"${e}"`).test(src)) ||
    (e === "view" && src.includes('send(slug, "view")')) ||
    (e === "cta_shown" && src.includes("data-usage-shown={cta}"));
  const missing = USAGE_EVENTS.filter((e) => !sent(e) && !EXEMPT[e] && !RETIRED_WITH_APP.includes(e));
  assert.deepEqual(missing, []);
  for (const e of Object.keys(EXEMPT)) assert.ok(!sent(e), `${e} now has a sender: drop its exemption`);
  for (const e of RETIRED_WITH_APP) assert.ok(!sent(e), `${e} has a sender again: take it off RETIRED_WITH_APP`);
  for (const e of RETIRED_WITH_APP) assert.ok((USAGE_EVENTS as readonly string[]).includes(e), `${e} is no longer a usage event: take it off RETIRED_WITH_APP`);
});

test("the app host's unprefixed paths are read in their /app form (M1, 9 Oct 2026)", () => {
  assert.equal(dashPath("/tallyroo/clusters"), "/app/tallyroo/clusters");
  assert.equal(dashPath("/tallyroo"), "/app/tallyroo");
  assert.equal(dashPath("/app/tallyroo/reports"), "/app/tallyroo/reports", "the main host's form is left as it is");
  assert.equal(dashPath("/app"), "/app");
  assert.equal(dashPath("/"), "/app");
  assert.equal(usageSlug(dashPath("/tallyroo/reports")), "tallyroo");
  assert.equal(usagePath(dashPath("/tallyroo/reports")), "/reports");
  assert.equal(usageSlug(dashPath("/login")), null, "the app host's login is not a client");
});
