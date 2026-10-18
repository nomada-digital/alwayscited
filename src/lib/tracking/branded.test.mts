import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BRANDED_CHIP, namesBrandIn, type Subject } from "./limits.ts";

/**
 * Branded prompts.
 *
 * 30 Sep 2026 (9fde8d4): two of the Nomada pilot's live prompts named Nomada
 * Digital, and a prompt that names the brand nearly always names it. Every
 * prompt writer refused one.
 *
 * R133 (Danny, 30 Sep 2026, danny.md line 118) replaces that: branded prompts
 * are the client's choice. No writer refuses one. The dashboard's Clusters
 * page and /admin/tracking put a warning chip on it instead. The scan copies
 * still leave them behind, because the free scan measures unprompted naming
 * and generateQuestions drops them (src/lib/scan/branded-questions.test.mts,
 * unchanged).
 */

// Tallyroo is the fixture's made-up client (privacy.test.mts); no real client is named here.
const TALLYROO: Subject = { brand: "Tallyroo", domain: "tallyroo.com", aliases: ["Tally Roo"] };

test("a prompt naming the brand, its domain or an alias is branded; a buyer's prompt is not", () => {
  assert.equal(namesBrandIn("what does Tallyroo do", TALLYROO), true);
  assert.equal(namesBrandIn("does tallyroo offer invoicing for freelancers", TALLYROO), true);
  assert.equal(namesBrandIn("is tallyroo.com any good", TALLYROO), true);
  assert.equal(namesBrandIn("tally roo vs the rest for freelancers", TALLYROO), true, "an alias counts");
  assert.equal(namesBrandIn("best invoicing software for freelancers", TALLYROO), false);
  assert.equal(namesBrandIn("what does it cost", { brand: null, domain: "tallyroo.com" }), false, "no brand: the domain stands in");
});

test("the chip is the one label", () => {
  assert.equal(BRANDED_CHIP, "Names the brand");
});

// ---- The census: prompt writers keep a branded prompt, and the pages flag it. ----

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

function walk(dir: string): string[] {
  return statSync(dir).isDirectory() ? readdirSync(dir).flatMap((f) => walk(join(dir, f))) : [dir];
}

/** Statements that write a prompt's text: an insert into tracked_questions, or an update that sets `text`. */
export function textWrites(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\.from\(\s*"tracked_questions"\s*\)([^;]*)/g)) {
    if (/\.(insert|upsert)\(/.test(m[1]) || /\.update\(\s*\{[^}]*\btext\b/.test(m[1])) out.push(m[1].trim().slice(0, 40));
  }
  return out;
}

/** Does a function body judge its texts as branded before its first write? */
export function brandCheckedBeforeWrite(body: string): boolean {
  const guard = body.search(/namesBrandIn\(|refuseBranded\(|BRANDED_PROMPT/);
  const write = body.search(/\.(insert|update)\(/);
  return guard !== -1 && write !== -1 && guard < write;
}

function bodyOf(source: string, name: string): string {
  const at = source.indexOf(`export async function ${name}(`);
  assert.ok(at !== -1, `${name} not found`);
  const next = source.indexOf("\nexport ", at + 1);
  return source.slice(at, next === -1 ? undefined : next);
}

test("census: prompt text is written in exactly two places, and neither refuses a branded prompt (R133)", () => {
  const files = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.m?ts$/.test(f));
  // 30 Sep 2026: 248 source files walked. The floor sits below it so new files never trip it, and a walk that stops matching does.
  assert.ok(files.length >= 220, `walked ${files.length} source files - the walk has stopped matching`);
  const writers = files.flatMap((f) => textWrites(readFileSync(f, "utf8")).map(() => relative(ROOT, f)));
  assert.deepEqual([...new Set(writers)].sort(), ["src/lib/tracking/edit.ts", "src/lib/tracking/limits.ts"]);
  assert.equal(brandCheckedBeforeWrite(bodyOf(read("src/lib/tracking/limits.ts"), "insertPrompts")), false, "insertPrompts: admin add, /app add-a-cluster, free slot and the webhook signup all come through here");
  assert.equal(brandCheckedBeforeWrite(bodyOf(read("src/lib/tracking/edit.ts"), "editPrompts")), false, "editPrompts: an edit before the first reading");
  assert.equal(brandCheckedBeforeWrite(bodyOf(read("src/lib/tracking/admin-edit.ts"), "adminEdit")), false, "adminEdit: /admin/tracking's fix-a-typo");
  const refusal = files.filter((f) => /refuseBranded|BRANDED_PROMPT/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(refusal, [], "the refusal is gone from every source file");
});

test("census: the two scan copies leave branded prompts behind (the scan measures unprompted naming)", () => {
  assert.match(read("src/app/admin/tracking/actions.ts"), /!namesBrandIn\(q\.text, subject\)/, "admin: create a client from a scan");
  assert.match(read("src/lib/checkout/signup.ts"), /!namesBrandIn\(q\.text, \{ brand: scan\.brand_name/, "webhook signup");
});

test("census: /admin/tracking flags a live branded prompt in both lists", () => {
  const page = read("src/app/admin/tracking/page.tsx");
  assert.equal([...page.matchAll(/<BrandFlag text=\{q\.text as string\} subject=\{subject\} \/>/g)].length, 2);
  assert.match(page, /names the brand/);
});

// 18 Oct 2026, brief 2d: "census: the Clusters page chips a branded prompt in its list and in the pending editor (R133)"
// retired with /app - it held components/app/Clusters.tsx and the /app Clusters page, both gone; every /app address
// 308s to the dashboards host, whose prompt editor draws no branded chip. The write-side rules above still hold.

test("census probe: a text write, a brand check before a write and one after each read as they should", () => {
  assert.deepEqual(textWrites(`await db.from("tracked_questions").insert(rows);`).length, 1);
  assert.deepEqual(textWrites(`await db.from("tracked_questions").update({ text: e.text }).eq("id", id);`).length, 1);
  assert.deepEqual(textWrites(`await db.from("tracked_questions").update({ stopped_on: day }).eq("id", id);`).length, 0, "a stop is not a text write");
  assert.equal(brandCheckedBeforeWrite(`await db.from("t").insert(rows); namesBrandIn(t, s);`), false);
  assert.equal(brandCheckedBeforeWrite(`if (namesBrandIn(t, s)) return; await db.from("t").insert(rows);`), true);
  assert.equal(brandCheckedBeforeWrite(`await db.from("t").insert(rows);`), false);
});
