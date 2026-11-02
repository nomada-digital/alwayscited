import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { TECHNICAL_TITLE, WORK_KINDS, internalRule, plainFileName, plainNote, plainTitle, workKindLabel } from "./work-text.ts";

/**
 * Work completed (sg-35, 2 Nov 2026): the census on every work_items title and note, and the source census that
 * holds it is the only way one reaches a customer page.
 */

test("plain-English work reads through unchanged", () => {
  for (const t of [
    "Added FAQ schema to the pricing page",
    "Rewrote the title and meta description on 12 service pages",
    "Fixed broken links across the blog",
    "Added internal links from the blog to the Leeds service page",
    "Improved internal linking on product pages",
    "Built branch pages for Leeds, York and Hull",
    "Monthly report for October 2026",
    "Published a guest post featuring you on a travel site",
    "Sped up the homepage on iPhone and Android",
    "Set up HubSpot and WordPress forms tracking",
    "Report covers 02/11/2026 to 30/11/2026",
    "Compared you with 3 competitors, and/or their partners",
  ]) {
    assert.equal(internalRule(t), null, t);
    assert.equal(plainTitle(t), t);
  }
});

test("anything that reads like code or our internals is caught, and says which rule caught it", () => {
  const cases: [string, string][] = [
    ["Fix `title` tag", "backtick"],
    ["Added {brand} to hero", "brace"],
    ["Added <Schema> component", "angle bracket"],
    ["Fixed the header; tidied footer", "semicolon"],
    ["map(x => y) on pages", "arrow"],
    ["Updated page.tsx for the hero", "code file"],
    ["Edited build_ac_view.py", "code file"],
    ["Ran 2026-11-02_work_items.sql", "code file"],
    ["Updated package.json", "code file"],
    ["Tweaked dash.css spacing", "code file"],
    ["Notes in README.md", "code file"],
    ["Changed vercel.yml", "code file"],
    ["Ran deploy.sh", "code file"],
    ["Changed src/lib/dash/load to be faster", "file path"],
    ["Fixed /api/dash/work route", "file path"],
    ["See https://example.com/x", "url"],
    ["See www.example.com for the post", "url"],
    ["Merged 3ccc8feb into the site", "hex string"],
    ["Reverted 5779f50a1b2c3d4e5f60718293a4b5c6d7e8f901", "hex string"],
    ["Tidied work_items rows", "snake_case"],
    ["Fixed getUser on the login page", "camelCase"],
    ["Added useState to the form", "camelCase"],
    ["TODO tidy the footer", "internal word"],
    ["FIXME header", "internal word"],
    ["WIP new landing page", "internal word"],
    ["Internal tidy-up", "internal word"],
    ["Rotated the secret", "internal word"],
    ["Refreshed the token", "internal word"],
    ["Reset the password", "internal word"],
    ["New api key for analytics", "internal word"],
    ["Set env for the site", "internal word"],
    ["Supabase table for work", "internal word"],
    ["Vercel deploy of the site", "internal word"],
    ["GitHub tidy", "internal word"],
    ["Commit to the site", "internal word"],
    ["Merged the branch", "internal word"],
    ["Ran a migration", "internal word"],
  ];
  for (const [text, rule] of cases) {
    assert.equal(internalRule(text), rule, text);
    assert.equal(plainTitle(text), TECHNICAL_TITLE, text);
    assert.equal(plainNote(text), null, text);
  }
});

test("a title is never empty and a note is optional", () => {
  assert.equal(plainTitle(""), TECHNICAL_TITLE);
  assert.equal(plainTitle(null), TECHNICAL_TITLE);
  assert.equal(plainTitle("  Added   FAQ schema  "), "Added FAQ schema");
  assert.equal(plainNote("   "), null);
  assert.equal(plainNote(undefined), null);
  assert.equal(plainNote("Covers the five pages you asked about.\nMore next month."), "Covers the five pages you asked about.\nMore next month.");
});

test("a file name shows only when it too reads as plain words", () => {
  assert.equal(plainFileName("October report.pdf"), "October report.pdf");
  assert.equal(plainFileName("schema.json"), null);
  assert.equal(plainFileName("work_items_export.csv"), null);
  assert.equal(plainFileName(null), null);
});

test("every kind has a plain label, and an unknown kind never shows its raw value", () => {
  for (const k of WORK_KINDS) assert.match(workKindLabel(k), /^[A-Z][A-Za-z -]+$/, k);
  assert.equal(workKindLabel("on_page"), "On-page");
  assert.equal(workKindLabel("pr"), "Digital PR");
  assert.equal(workKindLabel("made_up"), "Other");
  assert.equal(workKindLabel(null), "Other");
  // the kinds are the table's CHECK constraint (2026-11-02_hub_keywords_and_work_items.sql)
  assert.deepEqual([...WORK_KINDS], ["schema", "on_page", "content", "technical", "placement", "pr", "report", "other"]);
});

// ------------------------------------------------------------- the source census

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [p] : [];
  });
}
const SOURCES = walk(join(ROOT, "src")).map((f) => [relative(ROOT, f).split("\\").join("/"), readFileSync(f, "utf8")] as const);
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("census floor: the walk finds the source tree and the work_items reads", () => {
  assert.ok(SOURCES.length > 200, `only ${SOURCES.length} source files`);
  assert.ok(SOURCES.filter(([, s]) => s.includes('.from("work_items")')).length >= 1, "no work_items read found: the probe, not the tree, has changed");
});

test("work_items is read in work.ts only, and every title and note there passes the census", () => {
  const readers = SOURCES.filter(([, s]) => /\.from\(\s*["'`]work_items["'`]/.test(s)).map(([f]) => f);
  assert.deepEqual(readers, ["src/lib/dash/work.ts"]);
  const work = read("src/lib/dash/work.ts");
  assert.match(work, /title: plainTitle\(r\.title\)/);
  assert.match(work, /note: plainNote\(r\.note\)/);
  assert.match(work, /fileName: r\.file_path \? plainFileName\(r\.file_name\) : null/);
  assert.match(work, /\.map\(toWorkItem\)/);
  // the page never sees the storage path
  assert.doesNotMatch(work.slice(work.indexOf("export type WorkItem"), work.indexOf("type WorkRow")), /file_path|filePath/);
});

test("the work-files bucket is only ever signed, briefly, server side - never a public URL", () => {
  const users = SOURCES.filter(([, s]) => /["'`]work-files["'`]|\bWORK_BUCKET\b/.test(s)).map(([f]) => f);
  assert.deepEqual(users.sort(), ["src/lib/dash/work.ts"]);
  const work = read("src/lib/dash/work.ts");
  assert.match(work, /^import "server-only";/);
  assert.match(work, /\.createSignedUrl\(row\.file_path, WORK_FILE_TTL/);
  const ttl = Number(/WORK_FILE_TTL = (\d+);/.exec(work)?.[1]);
  assert.ok(ttl > 0 && ttl <= 300, `signed links live ${ttl}s; the brief is five minutes at most`);
  assert.doesNotMatch(work, /getPublicUrl/);
});

test("the file route authorises the client before it signs anything", () => {
  const route = read("src/app/dashboards/[client]/work/[id]/route.ts");
  const check = route.indexOf("await workClient(slug)");
  const sign = route.indexOf("await workFileUrl(client.id, id)");
  assert.ok(check > 0 && sign > check, "workClient must run, and its client be used, before a URL is signed");
  assert.match(route, /if \(!client\) return none\(\);/);
  const work = read("src/lib/dash/work.ts");
  // the same doors as pageData: view-as checked against the database, else the session's own clients; never a demo
  assert.match(work, /if \(await demoToken\(\)\) return null;/);
  assert.match(work, /const v = await viewAs\(view, slug\);/);
  assert.match(work, /const clients = await clientsFor\(email\);/);
  assert.match(work, /\.eq\("id", id\)\.eq\("client_domain_id", clientId\)/);
});

test("the pages that draw Work completed get their items from readWork only", () => {
  const drawers = SOURCES.filter(([f, s]) => f.startsWith("src/app/") && s.includes("<WorkCompleted")).map(([f]) => f).sort();
  assert.deepEqual(drawers, ["src/app/dashboards/[client]/managed/page.tsx", "src/app/dashboards/[client]/plan/page.tsx"]);
  for (const f of drawers) assert.match(read(f), /await readWork\(raw\.client\.id\)/, f);
});
