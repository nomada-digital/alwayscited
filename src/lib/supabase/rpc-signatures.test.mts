import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { code, sourceFiles } from "../source-read.mts";

/**
 * Every `.rpc()` names a function some migration declares, with the argument
 * names that function's signature takes.
 *
 * **The two-way street, and `writes.test.mts` is the file that paves one side
 * of it.** That sweep walks `supabase/migrations`, decides which database
 * functions mutate, and uses the set to CLASSIFY a call - `MUTATING.has(name)`
 * says whether a `.rpc(` is a write and therefore whether its error has to be
 * looked at. Nothing anywhere walks the other way and asks whether the name in
 * the call is a function at all. Its own header worries about exactly this
 * disappearance for a *computed* name - "`db.rpc(fnName, ...)` has no name to
 * look up, so it could not be classified as a write and would drop out of this
 * sweep silently" - and closes it with a rule. A name spelled as a literal and
 * spelled WRONG drops out by the identical mechanism, and no rule closes that.
 *
 * Same species as `upsert-conflict.test.mts` one Postgres-name-in-a-string
 * over: `onConflict` is a string in TypeScript and the constraint is DDL in a
 * `.sql` file, so no type, no import and no build step reads both ends. An RPC
 * name and its parameter names are the same join with the same absence of one.
 *
 * **What it costs when it is wrong.** PostgREST resolves a function by schema,
 * name **and the set of argument names supplied**, so all three of these are
 * one error - `PGRST202`, *Could not find the function public.x(...) in the
 * schema cache*:
 *
 *  - a misspelled name. This tree ships `note_preview_call` and
 *    `note_preview_calls`, two live functions one character apart, called
 *    thirty-one lines apart in the same file, doing different things - one
 *    reserves against a ceiling and returns a count, the other settles the
 *    actual spend and returns void;
 *  - a renamed parameter. `p_window_hours` is typed in one place and declared
 *    in another, and nothing joins them;
 *  - a parameter dropped from the call, or one added to the migration.
 *
 * None of the three moves `tsc`: supabase-js types `rpc(fn: string, args?:
 * object)` against generated database types this repo does not generate, so the
 * name and the arguments are unchecked strings. None of the three moves the
 * build. And the three routes it lands hardest on are the ceilings -
 * `note_scan_spend`, `note_preview_call`, `note_verify_send` - which is the one
 * family of write whose failure reads as "nothing has happened yet".
 *
 * All seven call sites are correct today, checked 20 Sep 2026. This exists so
 * that stays a fact rather than a coincidence.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** Strips `-- line comments`, which otherwise put stray tokens in the parse. */
const stripSql = (sql: string) => sql.replace(/--[^\n]*/g, "");

/** Reads the balanced parenthesised body that starts at `open`. */
function balanced(src: string, open: number, o = "(", c = ")"): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === o) depth += 1;
    else if (src[i] === c) {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced " + o + c + " in a source file");
}

/** Splits on commas sitting at depth zero, so `numeric(10,5)` stays one item. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean);
}

type Signature = { required: string[]; optional: string[] };

/**
 * Every database function the migrations declare, with its parameter names.
 *
 * Filename order is apply order and these migrations redefine as they go -
 * `scan_teaser` is written five times - so the last definition wins, exactly as
 * it does in the database. That is the same reasoning `writes.test.mts` gives
 * for its own derivation, and it is why this cannot be a typed list: a
 * parameter added in a later migration has to become required here with nobody
 * remembering to say so.
 *
 * A parameter with a `default` is optional to PostgREST - omitting it still
 * resolves. None of the six has one today; the distinction is parsed anyway,
 * because a rule that treats a defaulted parameter as required fails on a
 * migration that is correct, and a sweep that cries wolf gets an exemption
 * written for it instead of a fix.
 */
function declaredFunctions(): Map<string, Signature> {
  const byName = new Map<string, Signature>();

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = stripSql(readFileSync(path.join(MIGRATIONS, file), "utf8"));
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi)) {
      const open = m.index + m[0].length - 1;
      const params = topLevelItems(balanced(sql, open));
      const required: string[] = [];
      const optional: string[] = [];
      for (const p of params) {
        const name = /^(?:in|out|inout|variadic)?\s*([a-z_][a-z_0-9]*)\s+\S/i.exec(p);
        if (!name) continue;
        (/\bdefault\b|:=/i.test(p) ? optional : required).push(name[1].toLowerCase());
      }
      byName.set(m[1].toLowerCase(), { required, optional });
    }
  }
  return byName;
}

type Call = { file: string; line: number; name: string | null; args: string[] | null };

/**
 * Every `.rpc(` in the shipped tree, with the name it calls and the argument
 * names it supplies.
 *
 * Read through `code()`, which is load-bearing rather than precautionary here
 * and can be shown to be: `src/app/scan/[token]/page.tsx` carries
 * `(await db.rpc(...)).data` **inside a doc comment**, explaining a defect that
 * was fixed. Against the raw source that line is a `.rpc(` whose name is not a
 * string literal, so the "name it inline" rule below would report prose
 * describing the code as the one shape it exists to refuse. That is the
 * comment-strip failure this tree has paid for seven times, arriving on the
 * first sweep written after the roll was recorded.
 */
function rpcCalls(): Call[] {
  const out: Call[] = [];
  for (const rel of sourceFiles(ROOT)) {
    const src = code(readFileSync(path.join(ROOT, rel), "utf8"));
    if (!src.includes(".rpc(")) continue;
    for (const m of src.matchAll(/\.rpc\(/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      const call = balanced(src, m.index + ".rpc".length);
      const items = topLevelItems(call);
      const name = /^["'`](\w+)["'`]$/.exec(items[0] ?? "");
      if (!name) {
        out.push({ file: rel, line, name: null, args: null });
        continue;
      }
      // No second argument is a call with no arguments at all, which is a
      // different thing from one this parse could not read - `[]`, not null.
      const obj = items[1];
      const args = obj?.startsWith("{")
        ? topLevelItems(balanced(obj, 0, "{", "}"))
            .map((kv) => /^([a-z_][a-z_0-9]*)\s*:/i.exec(kv)?.[1]?.toLowerCase() ?? null)
            .filter((k): k is string => k !== null)
        : [];
      out.push({ file: rel, line, name: name[1].toLowerCase(), args });
    }
  }
  return out;
}

const DECLARED = declaredFunctions();
const CALLS = rpcCalls();

test("the sweep can see both ends", () => {
  /**
   * The denominator, asserted before anything is judged. A sweep that finds no
   * functions, or no call sites, passes every assertion below it while checking
   * nothing - five of this repo's own tripwires have failed exactly that way,
   * and the floor is the only thing that tells a clean tree from a walk that
   * stopped walking.
   */
  assert.ok(DECLARED.size >= 6, `expected 6+ declared functions, parsed ${DECLARED.size}`);
  // 7 until 24 September 2026, when the email gate's routes went and took the
  // only two callers of note_verify_send with them.
  assert.ok(CALLS.length >= 6, `expected 6+ .rpc( call sites, found ${CALLS.length}`);

  // Known-good spot checks, so a parser returning plausible rubbish fails here
  // rather than passing every call against a set of empty signatures.
  assert.deepEqual(DECLARED.get("note_scan_spend")?.required, [
    "p_scan",
    "p_dfs_calls",
    "p_dfs_cost",
    "p_anthropic_calls",
  ]);
  assert.deepEqual(DECLARED.get("scan_teaser")?.required, ["p_token"]);
  // The multi-line signature and the one-line signature are different parses
  // and both have to work: `note_scan_spend` spans six lines, `scan_teaser` is
  // one. The pair above is that case, deliberately.
});

test("every .rpc call names its function with a string literal", () => {
  /**
   * The shape neither this rule nor `writes.test.mts` can resolve. A computed
   * name has nothing to look up, so it is unmatchable against the migrations
   * and would leave both sweeps without saying so.
   *
   * `writes.test.mts` already refuses this, and the assertion is repeated here
   * on purpose rather than cross-referenced: that one is a clause inside a rule
   * about errors, and this file's two rules below are *built on* the literal.
   * A test whose precondition is enforced only in another file is one deletion
   * away from being vacuous.
   */
  assert.deepEqual(
    CALLS.filter((c) => c.name === null).map((c) => `${c.file}:${c.line}`),
    [],
    "name this RPC's function with a string literal - a computed name cannot be joined to the migrations",
  );
});

test("every .rpc names a function some migration declares", () => {
  const unknown = CALLS.filter((c) => c.name && !DECLARED.has(c.name)).map(
    (c) => `${c.file}:${c.line} calls ${c.name}, which no migration declares`,
  );
  assert.deepEqual(
    unknown,
    [],
    "PostgREST answers an unknown function with PGRST202 rather than raising at build time, and " +
      "`writes.test.mts` drops the call out of its error sweep at the same moment, because it " +
      "classifies a call by looking the name up in this same set.\nDeclared: " +
      [...DECLARED.keys()].sort().join(", ") +
      "\n" +
      unknown.map((s) => `  ${s}`).join("\n"),
  );
});

test("every .rpc supplies exactly the argument names its signature takes", () => {
  /**
   * PostgREST resolves an overload by the **set of argument names supplied**,
   * so a missing required parameter and a stray extra one are the same failure
   * as a misspelled function: the function is not found. Compared as a set,
   * because the call passes a JSON object and key order carries no meaning -
   * pinning the order would assert a difference the database does not make,
   * which is the no-op the `onConflict` harness records for the same reason.
   */
  const wrong: string[] = [];
  for (const c of CALLS) {
    if (!c.name || !c.args) continue;
    const sig = DECLARED.get(c.name);
    if (!sig) continue; // reported by the rule above; not counted twice here.

    const supplied = new Set(c.args);
    const missing = sig.required.filter((p) => !supplied.has(p));
    const extra = c.args.filter((a) => !sig.required.includes(a) && !sig.optional.includes(a));
    if (missing.length || extra.length) {
      wrong.push(
        `${c.file}:${c.line} calls ${c.name}(${[...sig.required, ...sig.optional].join(", ")})` +
          (missing.length ? ` without ${missing.join(", ")}` : "") +
          (extra.length ? ` and passes unknown ${extra.join(", ")}` : ""),
      );
    }
  }
  assert.deepEqual(wrong, [], "these calls cannot resolve to the function they name:\n" + wrong.join("\n"));
});

test("the six call sites are the ones we think they are", () => {
  /**
   * Pinned so a new RPC is a deliberate edit here rather than an addition
   * nobody sees. The rules above already cover a new one; this is about a
   * reviewer noticing that the set of things this app asks the database to do
   * has changed - which for three of these six is a spend ceiling.
   *
   * By name and count, never by count alone: a count matches just as well when
   * one call is deleted and another added, which is the mistake the server
   * action manifest rule records in `mail-doors.test.mts`.
   */
  const byName: Record<string, number> = {};
  for (const c of CALLS) if (c.name) byName[c.name] = (byName[c.name] ?? 0) + 1;
  assert.deepEqual(byName, {
    note_preview_call: 1,
    note_preview_calls: 1,
    // Two since 30 Sep 2026 (BRIEF-3 C1): the pipeline's billSpend, and
    // /api/scan/[token]/questions billing the cluster keyword check (two
    // DataForSEO reads onto dfs_cost, the candidates call onto anthropic_calls).
    note_scan_spend: 2,
    // `note_verify_send` was here until 24 September 2026. Its callers were
    // the unlock and resend routes, deleted with the email gate. **The
    // function itself is still declared in the migrations and is meant to
    // be** - dropping it is destructive DDL, which is absolute here - so this
    // is a function the database has and the app no longer calls.
    scan_source_coverage: 1,
    scan_teaser: 2,
    // 13 Oct 2026, DIY P1 (spec 10 section 5.6 item 4): every sum a DIY
    // reservation checks, in one read-only round trip (ledger.ts readDiySpend).
    diy_spend: 1,
  });
});
