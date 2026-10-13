import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { WALKTHROUGH_LIMITS } from "../../config/contact.ts";
import { SECTORS } from "../../config/sector-pricing.ts";
import {
  WALKTHROUGH_CATEGORIES,
  WALKTHROUGH_ERROR_FIELD,
  WALKTHROUGH_MARKETS,
  categoryLabel,
  marketLabel,
  readWalkthroughCategory,
  readWalkthroughMarket,
  readWalkthroughName,
} from "./walkthrough-fields.ts";
import { askColumnsMissing, writeAsk } from "./walkthrough-store.ts";

/**
 * Danny, 13 Oct 2026: "name, category and market are included in order for
 * them to submit the form for a loom with luke or demo with danny. These
 * should be required fields." Required on both ends: the form will not send
 * without them, and both routes refuse a post that lacks one or carries a
 * value the form never offered.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the category list is the site's sector list, Other included and last, nothing added", () => {
  assert.deepEqual(
    WALKTHROUGH_CATEGORIES.map((c) => c.id),
    SECTORS.map((s) => s.id),
  );
  assert.ok(WALKTHROUGH_CATEGORIES.length >= 20, `floor: 20 sectors, found ${WALKTHROUGH_CATEGORIES.length}`);
  assert.deepEqual(WALKTHROUGH_CATEGORIES.at(-1), { id: "other", label: "Other" });
  assert.equal(categoryLabel("technology"), "Technology and software");
});

test("the markets are the scan's two, US first", () => {
  assert.deepEqual([...WALKTHROUGH_MARKETS], ["US", "UK"]);
  assert.equal(marketLabel("UK"), "UK (United Kingdom)");
});

test("a name is required, tidied, and bounded", () => {
  assert.deepEqual(readWalkthroughName("  Jane   Smith \n"), { ok: true, value: "Jane Smith" });
  assert.deepEqual(readWalkthroughName("Ann\u0000Lee"), { ok: true, value: "Ann Lee" }, "a control character is a space");
  assert.deepEqual(readWalkthroughName("Ann\u200bLee\u202e"), { ok: true, value: "Ann Lee" }, "a format character is a space");
  assert.deepEqual(readWalkthroughName("\u0645\u0647\u200c\u0631\u0627\u0646"), { ok: true, value: "\u0645\u0647\u200c\u0631\u0627\u0646" }, "a Persian name keeps its non-joiner");
  assert.deepEqual(readWalkthroughName("\u674e"), { ok: true, value: "\u674e" }, "one letter in any script is a name");
  assert.deepEqual(readWalkthroughName("R2"), { ok: true, value: "R2" });
  // 13 Oct 2026 (review): invisible characters and punctuation alone are not
  // a name - \s does not match U+200B, so a lone zero-width space passed.
  for (const empty of [undefined, null, "", "   ", "\n\t", 42, ["Jane"], "\u200b", "\u200b \u200b", "\ufeff", "\u202e\u2066", "\u200d", "\u0085", "-", ". ."]) {
    const r = readWalkthroughName(empty);
    assert.equal(r.ok, false, String(empty));
    if (!r.ok) assert.equal(r.error, "bad_name");
  }
  assert.equal(readWalkthroughName("a".repeat(WALKTHROUGH_LIMITS.name)).ok, true, "at the bound");
  const long = readWalkthroughName("a".repeat(WALKTHROUGH_LIMITS.name + 1));
  assert.equal(long.ok, false, "over the bound");
  if (!long.ok) assert.match(long.message, new RegExp(String(WALKTHROUGH_LIMITS.name)));
});

test("a category is one of the sector ids, exactly", () => {
  for (const s of SECTORS) assert.deepEqual(readWalkthroughCategory(s.id), { ok: true, value: s.id });
  for (const bad of [undefined, "", "Technology", "technology ", "TECHNOLOGY", "Technology and software", "constructor", "x".repeat(WALKTHROUGH_LIMITS.category + 1), 3]) {
    const r = readWalkthroughCategory(bad);
    assert.equal(r.ok, false, String(bad));
    if (!r.ok) assert.equal(r.error, "bad_category");
  }
});

test("a market is US or UK, exactly", () => {
  assert.deepEqual(readWalkthroughMarket("US"), { ok: true, value: "US" });
  assert.deepEqual(readWalkthroughMarket("UK"), { ok: true, value: "UK" });
  for (const bad of [undefined, "", "us", "uk", "EU", "GB", "USA", " US", ["US"]]) {
    const r = readWalkthroughMarket(bad);
    assert.equal(r.ok, false, String(bad));
    if (!r.ok) assert.equal(r.error, "bad_market");
  }
});

test("every refusal the routes send names the field it is about", () => {
  assert.deepEqual(WALKTHROUGH_ERROR_FIELD, { bad_name: "name", bad_email: "email", personal_email: "email", bad_category: "category", bad_market: "market" });
});

test("both routes refuse a missing field before anything is stored or sent, in the form's order", () => {
  for (const p of ["../../app/api/scan/[token]/walkthrough/route.ts", "../../app/api/walkthrough/route.ts"]) {
    const src = code(read(p));
    const at = (needle: string) => {
      const i = src.indexOf(needle);
      assert.ok(i >= 0, `${p}: ${needle}`);
      return i;
    };
    const order = [
      at("readWalkthroughName(body.name)"),
      at("isPlausibleEmail(email)"),
      at("readWalkthroughCategory(body.category)"),
      at("readWalkthroughMarket(body.market)"),
      at('.from("walkthrough_requests")'),
      at("sendWalkthroughAlert("),
    ];
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${p}: name, email, category, market, then the write and the alert`);
    assert.match(src, /sendWalkthroughAlert\(\{[^}]*\bask\b/, `${p}: the alert carries the ask`);
  }
  // The form post without script reads the three by name.
  const scan = code(read("../../app/api/scan/[token]/walkthrough/route.ts"));
  for (const f of ["name", "category", "market"]) assert.ok(scan.includes(`String(form.get("${f}") ?? "")`), `the form post reads ${f}`);
});

test("the form asks for all four, required, labelled, each error tied to its field", () => {
  const form = read("../../components/scan/WalkthroughForm.tsx");
  for (const [id, labelText] of [
    ["wt-name", "Your name"],
    ["wt-email", "Work email"],
    ["wt-category", "Category"],
  ] as const) {
    assert.match(form, new RegExp(`<label htmlFor="${id}"[^>]*>\\s*${labelText}\\s*</label>`), `${id} is labelled "${labelText}"`);
    const at = form.indexOf(`id="${id}"`);
    assert.ok(at >= 0, `${id} is a field`);
    assert.match(form.slice(at, at + 400), /\brequired\b/, `${id} is required`);
    assert.ok(form.includes(`aria-describedby={errors.${id.slice(3)} ? "${id}-error" : undefined}`), `${id}'s error is tied to it`);
  }
  assert.match(form, /<legend id="wt-market-label"[^>]*>\s*Market\s*<\/legend>/, "the market radios are a labelled group");
  assert.ok(form.includes('aria-describedby={errors.market ? "wt-market-error" : undefined}'), "the market error is tied to its group");
  assert.match(form, /type="radio"[\s\S]{0,120}name="market"[\s\S]{0,80}required/, "a market radio is required");
  assert.match(form, /WALKTHROUGH_CATEGORIES\.map/, "the categories come from the shared list");
  assert.match(form, /WALKTHROUGH_MARKETS\.map/, "the markets come from the shared list");
  // The JSON posts carry all three, both calls.
  assert.equal((form.match(/JSON\.stringify\(\{ name, email, category, market, kind/g) ?? []).length, 2, "both posts send name, category and market");

  // 13 Oct 2026 (review): focus only announces a field when it moves, so
  // Enter pressed in the wrong field was silent. Every field error is an
  // alert, as wt-error was, remounted per refusal; focus moves after the
  // render; each market radio carries the error as well as its group; and
  // the browser's own `required` runs until script takes over.
  const src = code(form);
  assert.match(src, /<p key=\{`\$\{f\}-\$\{refusal\?\.n \?\? 0\}`\} id=\{`wt-\$\{f\}-error`\} role="alert"/, "a field error is an alert, remounted on each refusal");
  for (const f of ["name", "email", "category", "market"]) assert.ok(src.includes(`{errorLine("${f}")}`), `${f}'s error is drawn through errorLine`);
  assert.doesNotMatch(src, /<p id="wt-(name|email|category|market)-error"/, "no field error drawn outside errorLine, without its alert");
  assert.match(src, /useEffect\(\(\) => \{\s*if \(refusal\) document\.getElementById\(focusId\(refusal\.first\)\)\?\.focus\(\);\s*\}, \[refusal\]\)/, "focus moves in an effect, after the error is rendered");
  assert.doesNotMatch(src.slice(src.indexOf("function refuse("), src.indexOf("const errorLine")), /\.focus\(/, "refuse() itself does not move focus before the render");
  assert.equal((src.match(/aria-describedby=\{errors\.market \? "wt-market-error" : undefined\}/g) ?? []).length, 2, "the market error is on the group and on each radio");
  assert.match(src, /<form id="walkthrough"[^>]*\bnoValidate=\{hydrated\}/, "noValidate only once script runs");
  assert.doesNotMatch(src, /\bnoValidate>/, "never a bare noValidate in the server HTML");
});

test("a write refused for the new columns goes again without them; any other error is left alone", async () => {
  for (const message of [
    "Could not find the 'name' column of 'walkthrough_requests' in the schema cache",
    "Could not find the 'category' column of 'walkthrough_requests' in the schema cache",
    'column "market" of relation "walkthrough_requests" does not exist',
    "column walkthrough_requests.market does not exist",
  ]) assert.equal(askColumnsMissing({ message }), true, message);
  for (const message of ["duplicate key value violates unique constraint", "column scans.topic does not exist", "permission denied for table walkthrough_requests", ""]) {
    assert.equal(askColumnsMissing({ message }), false, message);
  }
  assert.equal(askColumnsMissing(null), false);

  const ask = { name: "Jane Smith", category: "technology", market: "UK" as const };
  const seen: object[] = [];
  const before = await writeAsk(ask, async (fields) => {
    seen.push(fields);
    return Object.keys(fields).length ? { data: null, error: { message: "Could not find the 'category' column of 'walkthrough_requests' in the schema cache" } } : { data: [{ id: "1" }], error: null };
  });
  assert.deepEqual([...seen], [ask, {}], "before the migration: once with the fields, once without");
  assert.equal(before.error, null);

  seen.length = 0;
  const after = await writeAsk(ask, async (fields) => (seen.push(fields), { data: [{ id: "2" }], error: null }));
  assert.deepEqual([...seen], [ask], "after it: once, with the fields");
  assert.equal(after.error, null);

  seen.length = 0;
  const other = await writeAsk(ask, async (fields) => (seen.push(fields), { data: null, error: { message: "permission denied" } }));
  assert.deepEqual([...seen], [ask], "another failure is not retried");
  assert.deepEqual(other.error, { message: "permission denied" });
});

test("the migration adds the three columns, nullable and additive", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261014000000_walkthrough_fields.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
  for (const c of ["name", "category", "market"]) {
    assert.match(sql, new RegExp(`alter table (public\\.)?walkthrough_requests add column if not exists ${c} text\\b`), c);
  }
  assert.doesNotMatch(sql, /\b(drop|truncate|delete|rename|not null|alter column)\b/i, "additive only");
});
