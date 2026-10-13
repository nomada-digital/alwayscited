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
  for (const d of ["app/app", "app/api/app", "components/app"]) walk(join(root, d));
  assert.ok(files.length >= 30, `walked ${files.length} files, floor 30`);
  const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
  // No range control exists yet: the date on /app is display only (30 Sep 2026).
  const EXEMPT: Record<string, string> = { range_change: "no range picker is built; the date range is display only" };
  // 13 Oct 2026, DIY P9: a copy button's event is a prop - CopyButton's and CopyBlock's `usage="<event>"` - which
  // each draws as `data-usage={usage}` on its button, so the beacon sends it on the click. The pass-through is
  // asserted here, so a component that stops drawing it stops counting as a sender.
  const COPIERS = ["components/app/opportunities/CopyButton.tsx", "components/app/pages/CopyBlock.tsx"];
  for (const c of COPIERS) assert.ok(readFileSync(join(root, c), "utf8").includes("data-usage={usage}"), `${c} no longer draws its usage prop as data-usage`);
  const sent = (e: string) =>
    src.includes(`data-usage="${e}"`) ||
    src.includes(`usage="${e}"`) ||
    src.includes(`"${e}"`) && (src.includes(`event: "${e}"`) || new RegExp(`event: [^,}]*"${e}"`).test(src)) ||
    (e === "view" && src.includes('send(slug, "view")')) ||
    (e === "cta_shown" && src.includes("data-usage-shown={cta}"));
  const missing = USAGE_EVENTS.filter((e) => !sent(e) && !EXEMPT[e]);
  assert.deepEqual(missing, []);
  for (const e of Object.keys(EXEMPT)) assert.ok(!sent(e), `${e} now has a sender: drop its exemption`);
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
