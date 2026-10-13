import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { blankComments } from "../source-read.mts";

/**
 * Every Supabase read must look at its own error.
 *
 * postgrest-js does not throw. A read that failed comes back as
 * `{ data: null, error: {...} }`, so `const { data } = await db.from(...)` is
 * indistinguishable from a read that succeeded and found nothing - and the code
 * after it then states the wrong one of those two as a fact. Found in eleven
 * places on 19 September 2026, and it was never a cosmetic difference:
 *
 *  - the verify link redirected to "that link does not match a report we hold,
 *    run a scan below", to somebody who had just proved their address, because
 *    a read did not answer;
 *  - the scan page rendered its 404 to somebody following the link to their own
 *    report;
 *  - the pipeline read no confirmed questions, so it wrote a fresh set and
 *    asked those instead - and the report only ever shows what was asked, so
 *    nobody outside could tell;
 *  - the gated pass wrote its engines over `engines_answered` rather than into
 *    it, so an unlocked report said the free engines had not answered;
 *  - `billedOnto` added this pass's spend to zero and wrote the total back,
 *    erasing what the earlier pass had cost - under the two ceilings that read
 *    those columns to bound the day's spend. That read is gone rather than
 *    fixed: the addition happens in the database now, through
 *    `note_scan_spend`, which also closes the overlap two correct reads still
 *    lost.
 *
 * A list of call sites written into this test would drift exactly the way the
 * comments promising "this is handled" drifted. So it reads the source and
 * asserts over what it finds, and every exemption below has to say why.
 */

/**
 * Plain paths rather than URLs. `src/app/scan/[token]` is a real directory here
 * and the WHATWG URL parser percent-encodes the brackets, so a URL-based walk
 * looks for `%5Btoken%5D` and does not find it - which would have quietly
 * skipped the scan route, the one this check most needs to read.
 */
const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(child));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(child);
  }
  return out;
}

type Read = { file: string; line: number; destructure: string };

/**
 * Every `const { ... } = await <something>` whose bindings include `data` or
 * `count`, and every such object pattern sitting inside a `const [ ... ] =
 * await` array pattern.
 *
 * Deliberately not tied to `db.from(` or `supabaseAdmin()`: the call is spelled
 * several ways here - a bare `db`, a chained `supabaseAdmin()`, an `.rpc()` -
 * and a pattern that named them would miss the next spelling. What identifies a
 * Supabase result is the shape it is destructured into.
 *
 * `count` was added on 19 September 2026, and its absence is the more
 * instructive half of this file. The sweep matched `data` alone, so a read
 * written `.select("id", { count: "exact", head: true })` was invisible to it -
 * a head request returns no rows at all, so the only binding worth taking is
 * `count`. That shape is not an obscure corner: it is how every ceiling in this
 * codebase is counted, and three of the four call sites were ceilings. The
 * sweep reported no unchecked reads and was read as covering the reads, when
 * what it covered was one of the two shapes a read comes in.
 *
 * The array pattern was added the same day and is the third blind spot of the
 * same kind, after the `count` binding and the result held whole. The regex
 * anchored on `const {`, so every read destructured out of a `Promise.all` -
 * `const [{ data: answers }, { data: questions }] = await Promise.all([...])` -
 * was invisible rather than unchecked, and the sweep called the tree clean.
 * That is not a rare spelling here: it is how the paid report, the locked gate
 * and the report-ready email each read their rows, because those are the three
 * places that fetch four or five tables at once.
 */
function readsIn(file: string): Read[] {
  /**
   * Blanked, not raw, and the noisy direction is still a defect.
   *
   * This rule matches the destructure itself, so a comment quoting
   * `const { data } = await db.from(...)` - an ordinary thing to write when
   * explaining what a line used to be - is reported as an unchecked read.
   * Measured 20 Sep 2026 by injection: `pipeline.ts:786 { data }`, off a
   * comment, with the code beside it correct.
   *
   * That is the opposite direction from the miss in `writes.test.mts` next
   * door and it is not the harmless one. The obvious fix for a sweep naming a
   * line that is fine is an EXEMPT entry, and an EXEMPT key here is
   * `file:binding` - so the entry written to excuse the comment silently
   * excuses the real read that lands on that key afterwards. An exemption a
   * better primitive removes was never one.
   *
   * `blankComments` rather than `code` because every message below is a
   * `file:line`.
   */
  const source = blankComments(readFileSync(file, "utf8"));
  // Posix-style so the keys in EXEMPT read the same on any machine.
  const name = relative(ROOT, file).split(sep).join("/");
  const out: Read[] = [];
  const at = (index: number) => source.slice(0, index).split("\n").length;

  for (const m of source.matchAll(/const\s*(\{[^}]*\})\s*=\s*await\b/g)) {
    const destructure = m[1];
    if (!/\bdata\b/.test(destructure) && !/\bcount\b/.test(destructure)) continue;
    out.push({ file: name, line: at(m.index), destructure: tidy(destructure) });
  }

  // Each element of an array pattern is its own result, so each object pattern
  // inside one is its own read and gets its own line and its own EXEMPT key.
  for (const m of source.matchAll(/const\s*\[([^\]]*)\]\s*=\s*await\b/g)) {
    for (const el of m[1].matchAll(/\{[^}]*\}/g)) {
      const destructure = el[0];
      if (!/\bdata\b/.test(destructure) && !/\bcount\b/.test(destructure)) continue;
      out.push({ file: name, line: at(m.index), destructure: tidy(destructure) });
    }
  }
  return out;
}

function tidy(destructure: string): string {
  return destructure.replace(/\s+/g, " ").trim();
}

/**
 * Reads that may discard their error, each with the reason it is safe.
 *
 * Keyed by file and the name `data` is bound to, not by line number, which
 * would go stale on the next edit above it. Adding an entry here is a decision
 * to be argued for in the comment beside it, which is the point.
 */
const EXEMPT: Record<string, string> = {
  // Falls through to the insert below it, and the insert's own error is read.
  // An address that is neither insertable nor findable ends at the logged warn
  // at the bottom of resolveAccount.
};

/**
 * Two entries came off this list on 20 September 2026, and how they read is
 * worth keeping.
 *
 * `pipeline.ts:questionRows` was excused as "throws on the next line either
 * way", which is true of the control flow and was the wrong question. The line
 * it threw was `the free pass left no questions to re-ask` - and the gated
 * catch writes that into `gated_error`, where the report screen renders it, on
 * a state nothing can leave: the gated claim is `.eq("gated_status", "queued")`,
 * so once it says `failed` no pass can pick the row up again. A blip on one
 * read therefore ended the pass somebody gave an email address for and blamed a
 * question set that was sitting on the table. Both branches stopping is not the
 * same as both branches being right, and an exemption that reasons about
 * whether the code continues will keep missing what it continues to say.
 *
 * `start/route.ts:cached` was sound on correctness - a failed cache read is a
 * cache miss, which serves a real scan rather than an error - and it is off the
 * list because the read now binds its error to log it. The behaviour is
 * deliberately unchanged; what was missing was that a cache that has stopped
 * answering looked exactly like a domain nobody had scanned before, while
 * quietly paying for a scan each time.
 */

/**
 * The local name the rows - or the count - came back as, which is how EXEMPT
 * keys a read.
 *
 * `data` first, because a read that binds both is a read for its rows. A head
 * request binds only `count`, and keying those as "data" too would have made
 * every one of them collide on a single key per file - so one exemption would
 * have silently excused all of them.
 */
function boundName(destructure: string): string {
  const data = /\bdata\s*:\s*(\w+)/.exec(destructure);
  if (data) return data[1];
  if (/\bdata\b/.test(destructure)) return "data";
  const count = /\bcount\s*:\s*(\w+)/.exec(destructure);
  if (count) return count[1];
  return "count";
}

/**
 * Reads bound to a plain identifier instead of being destructured.
 *
 * The sweep below recognises a read by the shape it is destructured into, so a
 * read that is never destructured is not merely unchecked - it is *invisible*,
 * and no amount of widening the binding names reaches it. That is not
 * hypothetical: `/api/scan/[token]/confirm` held one until 19 September 2026,
 * written `const existing = await db...` with only `existing.count` read
 * afterwards. Its error was discarded and the sweep reported a clean tree.
 *
 * So the rule is the narrow one rather than a judgement about the read: bind
 * the result apart, and the sweep can see you. Anchored on `.from(` within the
 * statement and on a `.select(` with no mutating verb, so the writes sweep next
 * door keeps the writes and this keeps the reads.
 *
 * `.rpc(` used to sit beside `.from(` in that condition and was removed on
 * 19 September 2026, because it could never fire: the same condition requires
 * `.select(`, and an `.rpc()` call does not have one. It read as coverage this
 * rule did not have, which is how `(await db.rpc("scan_teaser", ...)).data` sat
 * on `/scan/[token]` discarding its error with the sweep green. RPC results
 * have their own rule below, which needs no `.select(` and catches both
 * spellings.
 *
 * A read handed to `selectAll` is not caught and must not be: those are arrow
 * functions returning a page, and `selectAll` throws on the error itself. The
 * same holds for `selectAllCounted` (page.ts), which throws on any page's
 * error and on the first page's: since 13 Oct 2026 (dashboard speed work) the
 * per-render readers call it, so it is excluded by the same call rule.
 */
function undestructuredIn(file: string): { file: string; line: number; text: string }[] {
  const source = readFileSync(file, "utf8");
  const name = relative(ROOT, file).split(sep).join("/");
  const lines = source.split("\n");
  const out: { file: string; line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    // Prose, not code. The first draft of this rule flagged the sentence in
    // /confirm that explains the defect it was written for, which is a good
    // reminder that a sweep matching source text matches comments too.
    if (text.startsWith("*") || text.startsWith("//") || text.startsWith("/*")) continue;
    if (!/\bconst\s+[A-Za-z_]\w*\s*=\s*await\b/.test(lines[i])) continue;
    const chain = lines.slice(i, i + 20).join("\n");
    const body = chain.slice(0, chain.indexOf(";") + 1 || undefined);
    // `selectAll` takes an arrow returning one page and throws on the error
    // itself, so the `.from(...).select(...)` inside it is not an unchecked
    // read - it is the one shape in this tree that is checked somewhere else
    // on purpose. Excluded by the call, not by the binding, because the
    // binding is rows and looks exactly like an unchecked read.
    if (/\bselectAll(?:Counted)?[<(]/.test(body)) continue;
    if (!/\.from\(/.test(body)) continue;
    if (!/\.select\(/.test(body)) continue;
    if (/\.(update|insert|upsert|delete)\(/.test(body)) continue;
    out.push({ file: name, line: i + 1, text });
  }
  return out;
}

/**
 * Every `.rpc(` call, and whether its result is destructured at all.
 *
 * The fourth blind spot of the same family, and the first one that was not a
 * binding name but a *call shape*. The three rules above each identify a
 * postgrest result by something an `.rpc()` never has - `const {` for the first,
 * `.select(` for the other two - so all seven RPC call sites in this tree were
 * absent from the sweep rather than exempted by it, and it reported 80 of 80.
 *
 * Six of the seven checked their error anyway. The seventh did not:
 *
 *     const teaser = complete ? (await db.rpc("scan_teaser", ...)).data : null;
 *
 * which is the free result screen, on the page the email link lands on. The
 * result was consumed inline, so there is no binding anywhere for a rule about
 * bindings to judge - the same reason a result held whole was invisible, one
 * step further along. `const teaser = ... ?` does not even match
 * `const <ident> = await`.
 *
 * So the rule is about the call and not about what is done with the result:
 * every `.rpc(` must sit in a statement that destructures. Deliberately
 * indifferent to whether the function reads or writes, because the call site
 * cannot tell and both have an error worth looking at - the error check itself
 * is then the sweep above for a read, and the writes sweep next door for the
 * four that mutate.
 *
 * The statement is taken back to the previous `;`, which is what stops an
 * unrelated destructure a few lines up from excusing the call: anything with
 * its own terminator is a different statement and cannot be the binding.
 */
function rpcUndestructuredIn(file: string): { file: string; line: number; text: string }[] {
  const source = readFileSync(file, "utf8");
  const name = relative(ROOT, file).split(sep).join("/");
  const lines = source.split("\n");
  const out: { file: string; line: number; text: string }[] = [];

  for (const m of source.matchAll(/\.rpc\(/g)) {
    const line = source.slice(0, m.index).split("\n").length;
    // Prose, not code. This file's own explanation of the defect quotes the
    // call that caused it, and so does the page it was fixed on.
    const text = lines[line - 1].trim();
    if (text.startsWith("*") || text.startsWith("//") || text.startsWith("/*")) continue;

    const head = source.slice(source.lastIndexOf(";", m.index) + 1, m.index);
    if (/const\s*\{[^}]*\}\s*=\s*await\b/.test(head)) continue;

    out.push({ file: name, line, text });
  }
  return out;
}

/**
 * Split a comma-separated list at its top level, ignoring commas inside
 * brackets, braces, parentheses and strings.
 *
 * Needed by both halves below, because the two things being paired - the
 * elements of an array pattern and the arguments to `Promise.all` - are each a
 * list whose items contain commas of their own: `{ data: x, error: y }` and
 * `.select("a, b")`.
 */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** The index just past the bracket opened at `open`, or -1. */
function matchBracket(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const close = pairs[text[open]];
  if (!close) return -1;
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === text[open]) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Does this expression read rows through postgrest rather than through selectAll (or selectAllCounted, 13 Oct 2026)? */
function isBareRead(expr: string): boolean {
  if (/\bselectAll(?:Counted)?[<(]/.test(expr)) return false;
  // `.rpc(` was here too and was removed for the reason given above
  // `undestructuredIn`: it cannot fire against the `.select(` line below it.
  // An RPC inside a `Promise.all` is caught by `rpcUndestructuredIn`, which
  // sees `const [` as readily as anything else that is not `const {`.
  if (!/\.from\(/.test(expr)) return false;
  if (!/\.select\(/.test(expr)) return false;
  return !/\.(update|insert|upsert|delete)\(/.test(expr);
}

/**
 * Reads sitting in a `Promise.all` whose result is taken as a plain identifier.
 *
 * The rule one function up - bind the result apart - has a second face here that
 * it cannot reach, because the binding and the call are in different places.
 * `const [rows, kinds] = await Promise.all([db.from(...).select(...), ...])`
 * binds `rows` to a full postgrest result and there is no destructure anywhere
 * for the sweep to judge.
 *
 * The tree is clean of this today only by accident: every plain identifier in
 * an array pattern here is a `selectAll` result, and `selectAll` throws on its
 * own error. But those sit in the same list as the destructured reads - in
 * `opportunityShape` and `buildUnlockPayload` a `selectAll` and a bare
 * `db.from(...)` are literally adjacent arguments - so the next read added
 * beside one would inherit the identifier binding from its neighbour and
 * disappear.
 *
 * Paired positionally rather than guessed at: element i of the pattern belongs
 * to argument i of `Promise.all`, which is what the language guarantees and
 * what makes this checkable at all.
 */
/**
 * How many `Promise.all` array destructures the pairing above actually managed
 * to line up.
 *
 * A clean tree makes `UNPAIRED` empty, which is also what a pairing that never
 * matched anything produces - so the empty list on its own says nothing. This
 * is the number the guard asserts on instead.
 */
let PAIRED = 0;

function unpairedIn(file: string): { file: string; line: number; text: string }[] {
  const source = readFileSync(file, "utf8");
  const name = relative(ROOT, file).split(sep).join("/");
  const out: { file: string; line: number; text: string }[] = [];

  for (const m of source.matchAll(/const\s*\[/g)) {
    const openPattern = source.indexOf("[", m.index);
    const closePattern = matchBracket(source, openPattern);
    if (closePattern < 0) continue;

    const after = source.slice(closePattern + 1);
    const call = /^\s*=\s*await\s+Promise\.all\(\s*\[/.exec(after);
    if (!call) continue;

    const openArgs = closePattern + 1 + call[0].lastIndexOf("[");
    const closeArgs = matchBracket(source, openArgs);
    if (closeArgs < 0) continue;

    const elements = splitTopLevel(source.slice(openPattern + 1, closePattern));
    const args = splitTopLevel(source.slice(openArgs + 1, closeArgs));
    if (elements.length !== args.length) continue;
    PAIRED += 1;

    const line = source.slice(0, m.index).split("\n").length;
    for (let i = 0; i < elements.length; i++) {
      if (elements[i].startsWith("{")) continue;
      if (!isBareRead(args[i])) continue;
      out.push({ file: name, line, text: elements[i] });
    }
  }
  return out;
}

const FILES = sourceFiles(SRC);
const READS = FILES.flatMap(readsIn);
const UNDESTRUCTURED = FILES.flatMap(undestructuredIn);
const UNPAIRED = FILES.flatMap(unpairedIn);
const RPC_HELD = FILES.flatMap(rpcUndestructuredIn);
/**
 * How many `.rpc(` calls the rule above actually looked at.
 *
 * A clean tree makes `RPC_HELD` empty, which is also what a rule matching
 * nothing at all produces - and "matching nothing at all" is precisely the
 * state the three rules above were in with respect to RPCs. So the guard
 * asserts on the number examined rather than on the empty result, which is the
 * lesson `PAIRED` already carries ten lines down.
 */
const RPC_SEEN = FILES.reduce((total, file) => {
  const code = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("*") && !l.startsWith("//") && !l.startsWith("/*"));
  return total + code.filter((l) => l.includes(".rpc(")).length;
}, 0);

test("the sweep can still see the reads it is sweeping", () => {
  // Guards the regex and the walk together. If either stops working, every
  // assertion below passes over an empty list and this file tests nothing -
  // which is the failure mode that makes a green check worse than no check.
  assert.ok(FILES.length >= 40, `expected 40+ source files, walked ${FILES.length}`);
  assert.ok(READS.length >= 20, `expected 20+ destructured awaits binding data, found ${READS.length}`);
  /**
   * The array half, guarded separately.
   *
   * `READS` was already over twenty on object patterns alone, so it would have
   * stayed green with the array walk matching nothing at all - which is the
   * state this file was in until 19 September 2026 and the reason ten unchecked
   * reads sat behind a passing sweep.
   */
  assert.ok(
    READS.some((r) => r.file === "src/lib/scan/unlock.ts" && /answers/.test(r.destructure)),
    "the array-pattern walk found no read in unlock.ts, so it is matching nothing",
  );
  assert.ok(PAIRED >= 4, `expected 4+ paired Promise.all destructures, lined up ${PAIRED}`);
  assert.ok(RPC_SEEN >= 6, `expected 6+ .rpc( calls in the tree, the RPC rule looked at ${RPC_SEEN}`);
});

test("every Supabase read looks at its own error", () => {
  const unchecked: Read[] = READS.filter((r) => !/\berror\b/.test(r.destructure)).filter(
    // hasOwn, not `in`: EXEMPT is a plain object keyed by a string built out of
    // a file path and an identifier, so `in` would answer true for a read bound
    // to `constructor` or `toString` and excuse it without an entry.
    (r) => !Object.hasOwn(EXEMPT, `${r.file}:${boundName(r.destructure)}`),
  );

  assert.deepEqual(
    unchecked.map((r) => `${r.file}:${r.line} ${r.destructure}`),
    [],
    "these reads discard their error, so a failed read is indistinguishable from an empty one",
  );
});

test("every Supabase read is destructured, so this sweep can see it", () => {
  assert.deepEqual(
    UNDESTRUCTURED.map((r) => `${r.file}:${r.line} ${r.text}`),
    [],
    "bind this read apart - a result held whole is invisible to the sweep above, not merely unchecked",
  );
});

test("a read inside a Promise.all is destructured too", () => {
  assert.deepEqual(
    UNPAIRED.map((r) => `${r.file}:${r.line} ${r.text}`),
    [],
    "destructure this element - a postgrest result taken whole out of a Promise.all is invisible to the sweep above",
  );
});

test("an RPC result is destructured, so both sweeps can see it", () => {
  assert.deepEqual(
    RPC_HELD.map((r) => `${r.file}:${r.line} ${r.text}`),
    [],
    "destructure this RPC result - a call whose result is taken inline is invisible to every rule above, which each identify a read by something an .rpc() does not have",
  );
});

test("every exemption still points at a read that exists", () => {
  // An exemption left behind after its call site moves is a hole nobody can
  // see. The list has to stay honest in both directions.
  for (const key of Object.keys(EXEMPT)) {
    const [file, bound] = key.split(":");
    const found = READS.some((r) => r.file === file && boundName(r.destructure) === bound);
    assert.ok(found, `EXEMPT lists ${key}, but there is no such read any more - delete the entry`);
  }
});

test("every exemption still excuses a read that needs excusing", () => {
  /**
   * The second way this list goes stale, and the one the check above cannot
   * see: the read is still there, but somebody has since made it check its
   * error, so the entry excuses nothing.
   *
   * That is not tidiness. An exemption is keyed by file and bound name, not by
   * line, precisely so it survives edits above it - which means a dead entry
   * goes on standing over that binding for ever. The next person to add a read
   * bound to the same name in the same file inherits an excuse written for
   * different code, and the sweep stays green over it. Both entries removed on
   * 20 September 2026 would have become exactly that, one of them over
   * `questionRows` in the pipeline.
   */
  for (const key of Object.keys(EXEMPT)) {
    const [file, bound] = key.split(":");
    const stillUnchecked = READS.some(
      (r) => r.file === file && boundName(r.destructure) === bound && !/\berror\b/.test(r.destructure),
    );
    assert.ok(
      stillUnchecked,
      `EXEMPT lists ${key}, but that read binds its error now - delete the entry rather than leaving it over the binding`,
    );
  }
});
