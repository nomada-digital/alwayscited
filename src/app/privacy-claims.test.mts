import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { SETTINGS_FALLBACK } from "../lib/scan/settings-merge.ts";

/**
 * The other four facts /legal says it "checked in the code".
 *
 * That page's own header lists five, and names the file each was checked
 * against. `analytics-claim.test.mts` took one of them on 20 September 2026 and
 * found the sentence was true by a single `Array.isArray` that nothing held.
 * These are the four it left:
 *
 *   - raw IPs are never stored, they are salted SHA-256;
 *   - the app sets no cookies of its own;
 *   - an unclaimed scan loses only its transcript, after seven days, and keeps
 *     its measured facts;
 *   - the one third-party script the page loads is Cloudflare Turnstile.
 *     (15 Oct 2026: two now, Turnstile and, after a yes on the cookie banner,
 *     Google Analytics - Danny approved GA4 with a consent banner in chat.)
 *
 * All three were true when typed and none was falsifiable afterwards, which is
 * the species this queue keeps paying for. A privacy policy is the one page
 * where AGENTS.md's "ship it rough" explicitly does not reach: a wrong number
 * on a pricing card costs a correction, a wrong sentence here is a statement
 * about what we do with somebody's data.
 *
 * ## What writing it found, which reading it twice had not
 *
 * "Who else sees it" named DataForSEO, Anthropic, Resend, Vercel and Supabase.
 * It did not name Cloudflare - and `verifyTurnstile` posts `remoteip: ip` to
 * Cloudflare's siteverify endpoint on all three scan doors. So the raw address
 * that "What we collect" promises is never written down was being handed to a
 * processor the page did not list.
 *
 * Nothing in the code was wrong. **Never stored and never disclosed are
 * different promises**, `hashIp` keeps the first, and the page was written as
 * though keeping the first kept both. That is why rule A4 below exists: the
 * allowed recipients of the raw address are a list with a reason each, and any
 * recipient that is off-origin has to be named on the page.
 *
 * ## What this file cannot see, stated rather than implied
 *
 *   - `response_retention_days` is a live `app_settings` row. C4 joins the page
 *     to the *default*; an override in production moves the promise and no
 *     agent here can read that table. blocked.md carries it.
 *   - a cookie set at runtime by a dependency rather than by this tree. The
 *     rules read source. The live `set-cookie` read is a one-off in the
 *     worklog, not a gate - it is a point in time and this file is a push gate.
 */

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(HERE, "..", "..", "..");
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(child);
  }
  return out;
}

const posix = (f: string) => relative(ROOT, f).split(sep).join("/");

/** Comments stripped, the way every sweep in this tree does it. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Comments *and* string contents stripped, for the rules that ask whether the
 * code does a thing rather than whether a word appears in it. `/legal` is a
 * page about cookies and IP addresses, so every rule below would report the
 * page it is defending if it did not strip both.
 */
const bare = (src: string) => code(src).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');

const FILES = [
  ...walk(SRC).map((f) => ({ file: posix(f), source: readFileSync(f, "utf8") })),
  // next.config.ts sets every response header this site serves and is outside
  // src. A cookie rule that walks src alone is a claim wider than its own walk.
  { file: "next.config.ts", source: readFileSync(join(ROOT, "next.config.ts"), "utf8") },
  // vercel.json carries no headers today and can. It is in the walk so that
  // the day it does, the rule below is already pointed at it.
  { file: "vercel.json", source: readFileSync(join(ROOT, "vercel.json"), "utf8") },
];

const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ file: f, source: readFileSync(join(MIGRATIONS, f), "utf8") }));

const LEGAL = code(readFileSync(join(SRC, "app/legal/page.tsx"), "utf8")).replace(/\s+/g, " ");

test("the walk read the tree and the schema, so a zero below cannot pass as a clean sweep", () => {
  assert.ok(FILES.length >= 100, `the walk found only ${FILES.length} source files`);
  for (const f of ["src/lib/scan/ip.ts", "src/lib/scan/turnstile.ts", "next.config.ts"]) {
    assert.ok(FILES.some((x) => x.file === f), `the walk cannot see ${f}, which the rules below are about`);
  }
  assert.ok(SQL.length >= 5, `the migration walk found only ${SQL.length} files`);
});

/* ------------------------------------------------------------------ *
 * A. "the address itself is never written down, and the hash cannot be
 *    turned back into it"
 * ------------------------------------------------------------------ */

/**
 * Where the raw address enters the application. Derived, not typed: a typed
 * list cannot report an ABSENT reader, which is the rule `input-bounds`
 * records about itself. A fourth door calling `clientIp` joins this set on its
 * own and then has to satisfy A2.
 */
const IP_CALLERS = FILES.filter(({ source }) =>
  // The declaration is not a caller. `client-ip.ts` defines it and `ip.ts`
  // re-exports it; neither takes an address, and leaving them in would make
  // the list look like five doors when there are three.
  /\bclientIp\s*\(/.test(bare(source).replace(/function\s+clientIp\s*\(/g, "function DECLARATION(")),
).map((f) => f.file);

test("every door that takes a caller's address is in this file's denominator", () => {
  assert.deepEqual(
    IP_CALLERS.sort(),
    [
      // The seventh, 29 September 2026: the dashboard login link (T3), which
      // caps requests per hashed IP. The address goes to `hashIp` only.
      "src/app/api/app/login/route.ts",
      "src/app/api/coverage-check/[token]/rerun/route.ts",
      // The eighth, 1 October 2026: step 2's draft (R140). Turnstile and the
      // per-IP draft cap; the address goes to verifyTurnstile and hashIp only,
      // the same pair as the run route beside it.
      "src/app/api/coverage-check/draft/route.ts",
      "src/app/api/coverage-check/route.ts",
      // The fourth, 20 September 2026. It takes no scan and starts nothing - it
      // rate limits the one send on this site that mails an address nobody
      // confirmed, which is Danny's first condition on item 5. A2 passes for it:
      // the address it reads goes to `hashIp` and to nothing else.
      "src/app/api/scan/[token]/email-report/route.ts",
      // The ninth, 29 October 2026: "Run a new check" on a finished report, which
      // counts against the caller's scan allowance. The address goes to `hashIp` only.
      "src/app/api/scan/[token]/rerun/route.ts",
      // The fifth, 24 September 2026: the walkthrough request, which rate
      // limits the alert it sends Danny. The address goes to `hashIp` only.
      "src/app/api/scan/[token]/walkthrough/route.ts",
      "src/app/api/scan/start/route.ts",
      // The sixth, 28 September 2026: the tier pages' walkthrough ask, with
      // no scan. Same limit as the fifth; the address goes to `hashIp` only.
      "src/app/api/walkthrough/route.ts",
    ],
    "a door reads the caller's raw IP address that this file did not know about. Add it here once A2 passes for it - do not exempt it.",
  );
});

/**
 * The headers a caller's address actually arrives in, read out of `clientIp`
 * itself rather than typed here. Derived because a typed list of three would
 * go stale the moment the platform adds a fourth, and because the rule below
 * is only worth anything if it names the same set the code reads.
 */
const ADDRESS_HEADERS = [
  ...code(readFileSync(join(SRC, "lib/scan/client-ip.ts"), "utf8")).matchAll(
    /headers\.get\(\s*["']([a-z-]*(?:forwarded-for|real-ip))["']\s*\)/gi,
  ),
].map((m) => m[1].toLowerCase());

test("the address arrives through one door, so A1's denominator is the whole set", () => {
  // The hole this closes: A1 walks for `clientIp`, which is only the complete
  // list of doors while `clientIp` is the only thing that reads the headers an
  // address comes in. A route calling `req.headers.get("x-forwarded-for")`
  // directly has the raw address in hand and is invisible to every rule above.
  assert.ok(ADDRESS_HEADERS.length >= 3, `only ${ADDRESS_HEADERS.length} address headers found in client-ip.ts`);
  const hits: string[] = [];
  for (const { file, source } of FILES) {
    if (file === "src/lib/scan/client-ip.ts") continue;
    for (const m of code(source).matchAll(/headers\.get\(\s*["']([a-z-]+)["']\s*\)/gi)) {
      if (ADDRESS_HEADERS.includes(m[1].toLowerCase())) hits.push(`${file}  ${m[1]}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "something other than clientIp() reads the header a caller's address arrives in. It then holds the raw address without passing through hashIp, and none of the rules above can see it.",
  );
});

/**
 * What the raw address is allowed to be handed to, with the argument for each.
 * `spend-gates.test.mts` is the shape being copied: an exemption is a sweep
 * switched off, and the sentence beside it is the only argument for switching
 * it off, so it is a field rather than a comment.
 */
const RAW_IP_SINKS: { fn: string; why: string; vendor: string | null }[] = [
  {
    fn: "hashIp",
    why: "salted SHA-256, and the only form of the address that reaches a column. lib/scan/ip.ts throws without IP_HASH_SALT rather than hashing unsalted.",
    vendor: null,
  },
  {
    fn: "verifyTurnstile",
    why: "posts remoteip to Cloudflare's siteverify endpoint. Cloudflare needs the address to score the challenge; it is not stored by us.",
    vendor: "Cloudflare",
  },
];

/** The callee wrapping a position, found by walking back over balanced parens. */
function enclosingCall(src: string, at: number): string | null {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = src[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) return src.slice(0, i).match(/([A-Za-z_$][\w$]*)\s*$/)?.[1] ?? "";
      depth--;
    }
  }
  return null;
}

/**
 * Every use of the raw address in one file, excluding its own declaration.
 *
 * **Two shapes, and the second was added on 20 September 2026 because the
 * fourth door was written in it by accident.** The walk was `const x =
 * clientIp(` and then every later use of `x`, which is the form all three
 * original doors happen to use. `hashIp(clientIp(req))` binds nothing, so it
 * produced no sinks at all - and a rule that reports no sinks passes. A door
 * written that way was invisible to A2 while A1 counted it, so the file's
 * denominator would have grown by one with nothing behind it.
 *
 * `console.warn(clientIp(req))` is the same shape and is the version that
 * matters: it hands the unhashed address straight to a log line, which is
 * precisely what A2's own failure message says it exists to catch.
 *
 * The inline branch skips an assignment - `= clientIp(` - because the bound
 * form is what the first branch already walks, and counting it twice would
 * report `hashIp` as a stray on a file that does the right thing.
 */
function rawIpSinks(source: string): string[] {
  const src = bare(source).replace(/function\s+clientIp\s*\(/g, "function DECLARATION(");
  const sinks: string[] = [];
  for (const decl of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*clientIp\s*\(/g)) {
    const name = decl[1];
    for (const use of src.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
      if (use.index! <= decl.index! + decl[0].length) continue;
      sinks.push(enclosingCall(src, use.index!) ?? `<not an argument to anything>`);
    }
  }
  for (const call of src.matchAll(/\bclientIp\s*\(/g)) {
    if (/=\s*$/.test(src.slice(0, call.index!))) continue;
    sinks.push(enclosingCall(src, call.index!) ?? `<not an argument to anything>`);
  }
  return sinks;
}

test("the raw address is only ever passed to a function on the argued list", () => {
  const allowed = new Set(RAW_IP_SINKS.map((s) => s.fn));
  const stray: string[] = [];
  for (const { file, source } of FILES) {
    for (const sink of rawIpSinks(source)) if (!allowed.has(sink)) stray.push(`${file}  ->  ${sink}`);
  }
  assert.deepEqual(
    stray,
    [],
    '/legal tells a visitor "the address itself is never written down". These hand the unhashed address to something that is not on the argued list - `ip_hash: ip` in an insert payload, or a log line, reads exactly like this.',
  );
});

test("the raw address does reach both of the two things it is allowed to reach", () => {
  // The green-expected half. A rule that forbids everything passes on a tree
  // where nothing happens, and `mail-doors` earned its comment strip this way.
  const reached = new Set(FILES.flatMap((f) => rawIpSinks(f.source)));
  for (const { fn } of RAW_IP_SINKS) {
    assert.ok(reached.has(fn), `nothing passes the raw address to ${fn} any more. If that is deliberate, take it off RAW_IP_SINKS - a stale allowance is a hole waiting for a name.`);
  }
});

/**
 * Every column the schema declares, as (name, type).
 *
 * Two shapes, and the second one is the point. The first draft read
 * `create table` bodies alone - a line of the column list, anchored to the
 * start of a line. That is a denominator that cannot contain the defect:
 * AGENTS.md's carve-out makes `alter table ... add column` the *sanctioned*
 * way to add a column here, so the one route by which a column actually
 * arrives was the one route the rule could not see. Found by asking the
 * refill question of this file while writing it, not by a failing test.
 */
function columns(sql: string): { name: string; type: string }[] {
  const body = sql.replace(/--.*$/gm, " ");
  const out: { name: string; type: string }[] = [];
  for (const m of body.matchAll(/^\s*"?([a-z_]+)"?\s+([a-z]+)/gim)) out.push({ name: m[1], type: m[2] });
  for (const m of body.matchAll(/\badd\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_]+)"?\s+([a-z]+)/gim)) {
    out.push({ name: m[1], type: m[2] });
  }
  return out;
}

/**
 * The columns allowed to carry anything derived from a caller's address, with
 * the argument for each - the `RAW_IP_SINKS` shape one rule up, and for the
 * same reason: an exemption is a sweep switched off, and the sentence beside it
 * is the only argument for switching it off.
 *
 * **It was a single name until 20 September 2026** and the widening is the
 * finding rather than an inconvenience. `ip_hash` as a bare string said "the
 * one column" where the property the policy actually claims is "every column
 * carrying anything derived from an address is a salted hash". Those are the
 * same sentence only while there is one column, and this schema names its
 * columns by prefixing - so the second one was always going to be
 * `something_ip_hash` and was always going to fail this.
 *
 * The suffix rule below is what stops the list becoming a place to put things.
 * A column may be on it, and its name must still end in `ip_hash`: a reader of
 * the schema can then tell what a column holds without finding this file.
 */
const HASHED_COLUMNS: { name: string; why: string }[] = [
  {
    name: "ip_hash",
    why: "who started the scan or the campaign reading. Written by the three doors that count against ip_scans_per_day.",
  },
  {
    name: "report_email_ip_hash",
    why: "who asked for a report to be emailed, which is a different caller from the one above - the domain cache hands one visitor another visitor's completed scan, so the send cooldown cannot read ip_hash. Same hashIp, same salt.",
  },
];

test("every column holding something address-derived is argued for, and says so in its name", () => {
  for (const { name, why } of HASHED_COLUMNS) {
    assert.ok(why.length > 40, `${name} is on the allowed list with no argument for it`);
    assert.ok(
      name === "ip_hash" || name.endsWith("_ip_hash"),
      `${name} is allowed to hold something derived from an address and does not say so in its name`,
    );
  }
});

test("no column in the schema stores an address", () => {
  const allowed = new Set(HASHED_COLUMNS.map((c) => c.name));
  const offenders: string[] = [];
  for (const { file, source } of SQL) {
    for (const { name, type } of columns(source)) {
      const named = /(^|_)ip($|_)/.test(name) && !allowed.has(name);
      const typed = type === "inet" || type === "cidr";
      if (named || typed) offenders.push(`${file}  ${name} ${type}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a column that holds an address. The policy's claim is about storage, and the schema is what storage is - `ip_hash` is the only column allowed to carry anything derived from a caller's address.",
  );
});

test("the schema walk found every hashed column it is the exception for", () => {
  // Otherwise "no offenders" is equally true of a walk that reads nothing, and
  // the `alter table` half above was exactly that for one draft.
  //
  // Every member rather than the first, which is the `mail-from` lesson: a
  // count or a single probe cannot notice one entry going stale, and a stale
  // allowance is a hole waiting for a name. The second entry arrived through
  // `add column if not exists`, so this is also what re-earns the claim that
  // the walk reads that shape.
  const all = SQL.flatMap(({ source }) => columns(source));
  assert.ok(all.length >= 50, `the column walk found only ${all.length} columns across ${SQL.length} migrations`);
  for (const { name } of HASHED_COLUMNS) {
    assert.ok(
      all.some((c) => c.name === name),
      `the walk cannot see ${name}, so it cannot see a column beside it either`,
    );
  }
});

test("every off-origin recipient of the raw address is named on the page", () => {
  // The rule that would have caught Cloudflare being absent from "Who else
  // sees it" for as long as Turnstile has been wired up.
  const who = LEGAL.match(/id: "who",[\s\S]*?id: "cookies",/)?.[0];
  assert.ok(who, 'the "Who else sees it" section is not where this rule expected to find it');
  for (const { fn, vendor } of RAW_IP_SINKS) {
    if (!vendor) continue;
    assert.ok(
      who!.includes(vendor),
      `${fn} hands a visitor's IP address to ${vendor}, and /legal's "Who else sees it" does not say so. Never stored and never disclosed are different promises.`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * B. "This site sets no cookies of its own"
 * ------------------------------------------------------------------ */

/**
 * The one file allowed to touch document.cookie, with the argument for it.
 *
 * Empty until 15 Oct 2026, when Danny approved GA4 with a consent banner in
 * chat. GA sets its own cookies (_ga, _ga_<id>) on this domain after a yes,
 * and /legal now promises two things that need the jar: that declining after
 * accepting deletes them, and that the purchase is joined to the visit only
 * for a visitor who accepted - which is the _ga cookie read at checkout. Both
 * live in the consent module, which never writes a cookie of its own; it only
 * expires GA's. Reading is still held with writing: a read is one character
 * from a write, so anywhere else stays forbidden.
 */
const COOKIE_SCRIPT_TOUCHERS: Record<string, string> = {
  "src/lib/analytics.ts":
    "expireGaCookies() sets Max-Age=0 on GA's own cookies when a yes is withdrawn, and gaClientId() reads _ga after a yes so the webhook's purchase joins the visit. It sets no cookie of its own.",
};

test("only the consent module touches document.cookie", () => {
  const hits = FILES.filter(({ source }) => /\bdocument\s*\.\s*cookie\b/.test(bare(source))).map((f) => f.file);
  assert.deepEqual(
    hits.sort(),
    Object.keys(COOKIE_SCRIPT_TOUCHERS).sort(),
    '/legal says that apart from Google Analytics\'s, set only after a yes, "this site sets no cookies of its own" but the dashboard login. document.cookie is touched somewhere new, or the consent module no longer touches it and its allowance is stale.',
  );
  for (const [file, why] of Object.entries(COOKIE_SCRIPT_TOUCHERS)) assert.ok(why.length > 40, `${file} is allowed the cookie jar with no argument for it`);
  // What the consent module does with it: expire, or read _ga. Every write
  // assigns an expired value - nothing it writes can create a cookie.
  const consent = bare(readFileSync(join(SRC, "lib/analytics.ts"), "utf8"));
  const writes = [...code(readFileSync(join(SRC, "lib/analytics.ts"), "utf8")).matchAll(/document\.cookie\s*=\s*(.*)$/gm)].map((m) => m[1]!);
  assert.ok(writes.length >= 1 && /document\.cookie\s*=/.test(consent), "the consent module no longer expires GA's cookies, and /legal says declining deletes them");
  for (const w of writes) assert.match(w, /Max-Age=0/, `the consent module writes a cookie that is not an expiry: ${w}`);
});

/**
 * One reader since 29 September 2026: the alwaystracked dashboard's login
 * session (T3, BRIEF decision 2 - a 30-day httpOnly cookie, Danny's call).
 * /legal's sentence changed with it to name the one exception, and that
 * sentence is asserted here, so the reader and the promise cannot drift apart.
 */
const COOKIE_JAR_READERS = ["src/lib/tracking/member.ts"];

test("only the dashboard session reads the request cookie jar, and /legal says so", () => {
  const hits = FILES.filter(({ source }) =>
    /import\s*{[^}]*\bcookies\b[^}]*}\s*from\s*["']next\/headers["']/.test(code(source)),
  ).map((f) => f.file);
  assert.deepEqual(
    hits.sort(),
    COOKIE_JAR_READERS,
    "next/headers cookies() is imported somewhere new. Setting one through it is the server-side half of the sentence on /legal.",
  );
  assert.match(
    LEGAL.replace(/\s+/g, " "),
    /sets no cookies of its own, with one exception: when a client signs in to their <TierName tier="tracked" \/>\{" "\} dashboard, we set one login cookie/,
    "the dashboard reads a login cookie and /legal no longer names it as the one exception",
  );
});

test("no response this site serves carries a Set-Cookie header", () => {
  const hits: string[] = [];
  for (const { file, source } of FILES) {
    // Header *names*, so the word in prose is not a hit - matched against the
    // strings, because a header name is a string literal by construction.
    for (const m of code(source).matchAll(/(["'])([Ss]et-[Cc]ookie)\1/g)) hits.push(`${file}  ${m[2]}`);
  }
  assert.deepEqual(hits, [], "a Set-Cookie header is set somewhere in this tree, including next.config.ts, which serves every header on the site.");
});

/* ------------------------------------------------------------------ *
 * C. "Scan results are kept so you can come back to the link, and so is what
 *    each engine said... we do not [delete it] any more"
 * ------------------------------------------------------------------ */

/**
 * The retention promise, turned round on 24 September 2026.
 *
 * This section used to hold the opposite claim - that the transcript was
 * deleted after seven days on a scan nobody claimed, that only `response_text`
 * was blanked, and that the number on `/legal` was the number in
 * `SETTINGS_FALLBACK`. Danny decided transcripts are kept indefinitely, so
 * every one of those rules was holding a sentence the page no longer makes.
 *
 * They are replaced rather than deleted, because the promise is still a
 * promise and it is now the easier one to break by accident: a purge is a
 * thing somebody adds back, and the page says we do not have one. So what is
 * asserted is that the nightly route writes nothing and deletes nothing, and
 * that the page does not promise a deletion window.
 *
 * `response_retention_days` is deliberately not asserted against anything. The
 * row is still in `app_settings` - it is data, and deleting live rows is not
 * ours - and nothing reads it, so a number in that cell is no longer a claim
 * about anything a visitor can see. The migration that seeds it is untouched
 * for the same reason.
 */

const PURGE = code(readFileSync(join(SRC, "app/api/cron/purge-responses/route.ts"), "utf8"));

test("the nightly job writes nothing", () => {
  const updates = [...PURGE.matchAll(/\.update\(\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.deepEqual(
    updates,
    [],
    "the nightly job writes to the database again. /legal says what each engine said is kept for as long as the " +
      "scan is; any update in this route is that promise being taken back in the one place nobody reads.",
  );
});

test("the nightly job deletes no rows at all", () => {
  assert.ok(
    !/\.delete\s*\(/.test(PURGE),
    "the purge route deletes rows. It clears nothing now - /legal promises the text is kept - so a delete here " +
      "is not a narrowing of the old behaviour, it is a new one.",
  );
});

test("the page no longer promises a deletion window", () => {
  assert.ok(
    !/deleted after \w+ days/i.test(LEGAL),
    '/legal promises the transcript is "deleted after N days" again, and nothing deletes it. A privacy policy ' +
      "that describes a deletion that does not happen is the worse direction of this drift.",
  );
});

/* ------------------------------------------------------------------ *
 * D. "The one third-party script the page loads is Cloudflare Turnstile"
 * ------------------------------------------------------------------ */

/**
 * What `route-closure.test.mts` already holds, so this does not restate it: the
 * CSP and the off-origin URLs in client code agree, in both directions. Every
 * origin the browser is told to fetch is permitted, and every permitted origin
 * is fetched by something.
 *
 * What agreement cannot tell you is **how many there are and whose they are**,
 * and that is the whole of the sentence on the page. Two third parties, both
 * loaded and both in the CSP, satisfy route-closure completely and make "the
 * one third-party script" false. It is the same shape this queue keeps finding:
 * a check right about everything it names, asked what it is not looking at.
 *
 * The CSP is read from `next.config.ts` rather than from the build, so this
 * runs without one. route-closure reads the shipped manifest and is the half
 * that proves the header is actually served.
 */
const THIRD_PARTIES: { origin: string; vendor: string; why: string }[] = [
  {
    origin: "https://challenges.cloudflare.com",
    vendor: "Cloudflare",
    why: "Turnstile: the api.js script, the widget's iframe, and the connection it makes to score the challenge.",
  },
  // 15 Oct 2026, Danny approved GA4 with a consent banner in chat. Three
  // origins, one vendor, one script: gtag.js and where it sends hits. None is
  // requested before a yes (analytics-claim.test.mts holds the gate), and the
  // dashboard's own policy has them taken out (APP_CSP in next.config.ts).
  {
    origin: "https://www.googletagmanager.com",
    vendor: "Google",
    why: "gtag.js, Google Analytics' script, loaded by the consent banner after a yes; it also takes hits and serves a pixel.",
  },
  {
    origin: "https://www.google-analytics.com",
    vendor: "Google",
    why: "where gtag.js sends GA4 hits, by fetch, beacon and image, after a yes.",
  },
  {
    origin: "https://region1.google-analytics.com",
    vendor: "Google",
    why: "GA4's regional collection endpoint, which gtag.js sends hits to after a yes.",
  },
];

/**
 * Where a form submission's redirect may land, which is form-action and
 * nothing else. Not a third party the page loads: the browser navigates there
 * and the visitor leaves the site, so the sentence on /legal about scripts is
 * untouched by it and the rules below read form-action apart. Pinned as its
 * own list so a new target is still a deliberate edit (R155, Danny, 1 Oct
 * 2026: with 'self' alone Chrome blocked /checkout's 303 to Stripe).
 */
const FORM_TARGETS: { origin: string; why: string }[] = [
  { origin: "https://checkout.stripe.com", why: "/api/checkout answers /checkout's form with a 303 to Stripe's hosted checkout." },
  { origin: "https://billing.stripe.com", why: "Stripe's billing portal, named in Danny's R155 fix alongside checkout." },
];

test("form-action permits 'self' and exactly the recorded Stripe pages", () => {
  const fa = directives().find((d) => d.name === "form-action");
  assert.ok(fa, "the CSP parse cannot see form-action");
  assert.deepEqual(
    [...fa!.sources].sort(),
    ["'self'", ...FORM_TARGETS.map((t) => t.origin)].sort(),
    "form-action names a target that is not in FORM_TARGETS, or a recorded one is gone. Each is a place a form on this site may send the visitor.",
  );
});

/** Source expressions that are not a third party: us, or no fetch at all. */
const FIRST_PARTY = /^(?:'self'|'none'|'unsafe-inline'|'unsafe-eval'|blob:|data:|ws:)$/;

/**
 * The CSP as directives, read out of the config's own array.
 *
 * Line-wise rather than by one regex over the block, and that is not tidiness.
 * A source expression is itself quoted - `"default-src 'self'"` - so a naive
 * "text between two quote characters" match stops at the inner `'` and reads
 * `default-src` as having no sources at all. A policy parsed that way looks
 * maximally strict no matter what it permits, which is the flattering
 * direction of harness failure this repo has now paid for twice.
 *
 * `${...}` holes are replaced by the string literals inside them, so the
 * dev-only sources are read too: a third party smuggled in behind `isDev`
 * would otherwise be invisible here and still shipped to anyone running the
 * dev server.
 */
function directives(): { name: string; sources: string[] }[] {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  const block = config.match(/const CSP = \[([\s\S]*?)\]\.join\(/)?.[1];
  assert.ok(block, "the CSP array is not where this rule expected to find it in next.config.ts");

  const out: { name: string; sources: string[] }[] = [];
  for (const raw of block!.split("\n")) {
    // `[^:]` and not a bare `//`, which is the guard `code()` above carries for
    // the same reason: the one line this parse exists to read ends in
    // `https://challenges.cloudflare.com`, and a bare comment strip eats the
    // origin, closes no quote, and drops script-src from the policy silently.
    const line = raw.replace(/(^|[^:])\/\/.*$/, "$1");
    const open = line.search(/["`]/);
    if (open === -1) continue;
    const quote = line[open];
    const close = line.lastIndexOf(quote);
    if (close <= open) continue;
    const entry = line
      .slice(open + 1, close)
      .replace(/\$\{([^}]*)\}/g, (_, hole: string) =>
        ` ${[...hole.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).join(" ")} `,
      )
      .trim();
    if (!entry) continue;
    const [name, ...sources] = entry.split(/\s+/).filter(Boolean);
    out.push({ name, sources });
  }
  return out;
}

test("the CSP parse read the real policy, so an empty set cannot pass as a strict one", () => {
  const ds = directives();
  assert.ok(ds.length >= 10, `the CSP parse found only ${ds.length} directives`);
  for (const name of ["default-src", "script-src", "img-src", "font-src", "frame-src", "connect-src"]) {
    assert.ok(ds.some((d) => d.name === name), `the CSP parse cannot see ${name}`);
  }
});

test("the browser may reach exactly the argued third parties, and they are the ones on the page", () => {
  const found = new Set<string>();
  for (const { name, sources } of directives()) {
    if (name === "form-action") continue; // navigation targets, pinned by FORM_TARGETS above
    for (const src of sources) {
      if (FIRST_PARTY.test(src)) continue;
      if (!/^https?:\/\//.test(src)) continue; // 'unsafe-eval' and friends behind a template hole
      const origin = new URL(src).origin;
      assert.ok(
        THIRD_PARTIES.some((t) => t.origin === origin),
        `${name} permits ${origin}, which is not on the argued list. /legal tells a visitor the site loads two third-party scripts, Cloudflare Turnstile and Google Analytics - a third origin makes that sentence false, and route-closure passes on it the moment something in src/ loads it.`,
      );
      found.add(origin);
    }
  }
  assert.deepEqual(
    [...found].sort(),
    THIRD_PARTIES.map((t) => t.origin).sort(),
    "an argued third party is allowed by no directive. A stale entry here is an allowance nobody is watching.",
  );
});

test("no directive smuggles a third party in through a source that is not a URL", () => {
  // The sources that are neither first-party nor an absolute URL: a bare
  // hostname, a scheme like https:, or a wildcard. Every one of those admits
  // an origin the rule above cannot name.
  const loose: string[] = [];
  for (const { name, sources } of directives()) {
    if (name === "upgrade-insecure-requests") continue;
    for (const src of sources) {
      if (FIRST_PARTY.test(src) || /^https?:\/\/[a-z0-9.-]+$/i.test(src)) continue;
      loose.push(`${name} ${src}`);
    }
  }
  assert.deepEqual(loose, [], "a CSP source that is a wildcard, a bare scheme or a hostname without an origin. The rule above reads origins, so anything in this list is a third party it cannot see.");
});

/**
 * The sentence was "The one third-party script the page loads is Cloudflare
 * Turnstile" until 15 Oct 2026, when Danny approved GA4 with a consent banner
 * in chat. It is now "two third-party scripts, and one of them only if you say
 * yes", and the count is still held: two vendors, each named on the page and
 * in "Who else sees it".
 */
test("the page still claims the number this file just checked", () => {
  const vendors = [...new Set(THIRD_PARTIES.map((t) => t.vendor))].sort();
  assert.deepEqual(vendors, ["Cloudflare", "Google"], "the set of third-party vendors changed, so the sentence below has to change before this test can be made to pass");
  assert.ok(
    /The site loads two third-party scripts, and one of them only if you say yes\. Cloudflare Turnstile/.test(LEGAL),
    '/legal no longer says "The site loads two third-party scripts, and one of them only if you say yes. Cloudflare Turnstile ...". The rules above hold that sentence; if it was reworded, reword them with it rather than deleting them.',
  );
  assert.ok(!/The one third-party script the page loads/.test(LEGAL), "/legal still claims a single third-party script");
  const who = LEGAL.match(/id: "who",[\s\S]*?id: "cookies",/)?.[0] ?? "";
  for (const { vendor, why } of THIRD_PARTIES) {
    assert.ok(why.length > 30, `${vendor} is an argued third party with no argument`);
    assert.ok(LEGAL.includes(vendor), `${vendor} is a third party this site reaches and /legal does not name it`);
    assert.ok(who.includes(vendor), `${vendor} is a third party this site reaches and "Who else sees it" does not name it`);
  }
});

/* ------------------------------------------------------------------ *
 * The rules, proven both ways against written instances.
 * ------------------------------------------------------------------ */

test("the raw-address rule tells an argued sink from an unargued one", () => {
  const sinks = (src: string) => rawIpSinks(src);
  assert.deepEqual(sinks("const ip = clientIp(req); const h = hashIp(ip);"), ["hashIp"]);
  assert.deepEqual(sinks("const ip = clientIp(req); await verifyTurnstile(t, ip);"), ["verifyTurnstile"]);
  assert.deepEqual(sinks("const ip = clientIp(req); db.from('scans').insert({ ip_hash: ip });"), ["insert"], "an insert payload is a sink");
  assert.deepEqual(sinks("const ip = clientIp(req); db.from('scans').insert({ ip });"), ["insert"], "shorthand is a sink");
  assert.deepEqual(sinks("const ip = clientIp(req); console.log(ip);"), ["log"]);
  assert.deepEqual(sinks("const ip = clientIp(req); const copy = ip;"), ["<not an argument to anything>"]);
  // Names that merely start with the identifier are not uses of it - the live
  // code puts `ipHash` and `ip_hash` within two lines of `ip` on all three doors.
  assert.deepEqual(sinks("const ip = clientIp(req); const ipHash = h(); x.insert({ ip_hash: ipHash });"), []);
  // And a comment describing the defect is not the defect. `0a3aa9e` was a
  // component's own doc comment satisfying the check that its code was there.
  assert.deepEqual(sinks("const ip = clientIp(req); // never do insert({ ip })\nconst h = hashIp(ip);"), ["hashIp"]);
});

/**
 * The inline form, added 20 September 2026 with the fourth door.
 *
 * Every case here returned `[]` before the widening, and `[]` is what this rule
 * reports as clean - so the sweep did not weaken, it had never been able to see
 * this shape at all. The last two are the ones that matter: a log line and an
 * insert payload holding the unhashed address, written without binding it,
 * which is exactly what A2's failure message says it is for.
 *
 * The first three are the green-expected half. A widening that starts reporting
 * the bound form twice would fail the harness above and would also fail every
 * door in the tree, so it is worth holding both directions in one place.
 */
test("the raw-address rule sees an address that was never bound to a name", () => {
  const sinks = (src: string) => rawIpSinks(src);
  assert.deepEqual(sinks("const h = hashIp(clientIp(req));"), ["hashIp"], "nested, and correct");
  assert.deepEqual(sinks("await verifyTurnstile(t, clientIp(req));"), ["verifyTurnstile"]);
  assert.deepEqual(
    sinks("const ip = clientIp(req); const h = hashIp(ip);"),
    ["hashIp"],
    "the bound form is counted once, not once per branch",
  );
  assert.deepEqual(sinks("console.warn(clientIp(req));"), ["warn"], "a log line is the case this is for");
  assert.deepEqual(sinks("db.from('scans').insert({ ip_hash: clientIp(req) });"), ["insert"]);
  // The declaration is not a caller, the same way A1 says it is not. Without
  // this, client-ip.ts reports itself and the rule fails on a clean tree.
  assert.deepEqual(sinks("export function clientIp(req: Request): string { return UNKNOWN_IP; }"), []);
});

test("the schema rule sees a column added the way this repo adds columns", () => {
  const allowed = new Set(HASHED_COLUMNS.map((c) => c.name));
  const flagged = (sql: string) =>
    columns(sql)
      .filter((c) => (/(^|_)ip($|_)/.test(c.name) && !allowed.has(c.name)) || c.type === "inet" || c.type === "cidr")
      .map((c) => c.name);
  assert.deepEqual(flagged("create table x (\n  ip_hash text\n);"), [], "the hashed column is the allowed one");
  assert.deepEqual(
    flagged("alter table public.scans add column if not exists report_email_ip_hash text;"),
    [],
    "and so is the second one, which is why the allowance is a list",
  );
  // The suffix is not itself the allowance. A column named for the convention
  // but never argued for still fails, which is what stops the naming rule two
  // hundred lines up becoming a way in.
  assert.deepEqual(
    flagged("alter table public.scans add column if not exists lead_ip_hash text;"),
    ["lead_ip_hash"],
    "looking like a member is not being one",
  );
  assert.deepEqual(flagged("create table x (\n  visitor_ip text\n);"), ["visitor_ip"]);
  assert.deepEqual(flagged("alter table public.scans add column visitor_ip text;"), ["visitor_ip"], "the additive shape AGENTS.md sanctions");
  assert.deepEqual(flagged("alter table public.scans add column if not exists caller inet;"), ["caller"], "typed rather than named");
  assert.deepEqual(flagged("create table x (\n  zip text,\n  description text\n);"), [], "a word containing the letters is not an address column");
  assert.deepEqual(flagged("-- add column raw_ip inet, which we do not do\ncreate table x (id uuid);"), [], "a comment describing it is not it");
});

test("the cookie rules tell a cookie from a page about cookies", () => {
  const sets = (src: string) => /\bdocument\s*\.\s*cookie\b/.test(bare(src));
  assert.equal(sets('document.cookie = "seen=1";'), true);
  assert.equal(sets("<p>This site sets no cookies of its own</p>"), false, "copy about cookies is not a cookie");
  assert.equal(sets('const note = "no document.cookie anywhere";'), false, "a string naming it is not a write");
  assert.equal(sets("/** no document.cookie, no cookies() */"), false, "the /legal header says exactly this");

  const jar = (src: string) => /import\s*{[^}]*\bcookies\b[^}]*}\s*from\s*["']next\/headers["']/.test(code(src));
  assert.equal(jar('import { cookies } from "next/headers";'), true);
  assert.equal(jar('import { headers, cookies } from "next/headers";'), true, "second in the clause still counts");
  assert.equal(jar('import { headers } from "next/headers";'), false);

  const hdr = (src: string) => /(["'])([Ss]et-[Cc]ookie)\1/.test(code(src));
  assert.equal(hdr('{ key: "Set-Cookie", value: "a=b" }'), true);
  assert.equal(hdr("<p>we set no cookie here</p>"), false);
});

test("the purge rules tell the promised write from a wider one", () => {
  const cleared = (src: string) => [...src.matchAll(/\.update\(\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.deepEqual(cleared('.update({ response_text: null }, { count: "exact" })'), ["response_text: null"]);
  assert.deepEqual(
    cleared(".update({ response_text: null, cited_domains: null })"),
    ["response_text: null, cited_domains: null"],
    "a second key is a measurement going with the transcript, and must not read as the promised write",
  );
  const unclaimed = (src: string) => /\.is\(\s*["']unlocked_at["']\s*,\s*null\s*\)/.test(src);
  assert.equal(unclaimed('.is("unlocked_at", null)'), true);
  assert.equal(unclaimed('.not("unlocked_at", "is", null)'), false, "the inverted filter purges exactly the claimed scans");
});

/* ------------------------------------------------------------------ *
 * W. "If you ask for a walkthrough or a demo, we store the name, work
 *    email, business category and market you gave, and nothing else about
 *    you."
 * ------------------------------------------------------------------ */

/**
 * 13 Oct 2026: Danny made name, category and market required on the
 * walkthrough ask, and /legal's sentence - which said the ask stored "the email
 * address you gave, and nothing else about you" - was rewritten to the four.
 * Held to the two writes here, so a fifth thing stored about the person makes
 * the sentence fail rather than quietly go untrue. `scan_id` is the report the
 * ask is about, `kind` is which of the two was asked for, and `ip_hash` is the
 * salted hash "What we collect" names on its own (rule A); `...fields` is
 * writeAsk's, which is ASK_COLUMNS and nothing else.
 */
test("W: the walkthrough ask stores what /legal says it stores, and nothing else about the person", () => {
  assert.ok(
    LEGAL.includes("If you ask for a walkthrough or a demo, we store the name, work email, business category and market you gave, and nothing else about you."),
    "/legal no longer says what the walkthrough ask stores in the words this rule holds - reword the rule with it, do not delete it",
  );
  const store = code(readFileSync(join(SRC, "lib/scan/walkthrough-store.ts"), "utf8"));
  assert.match(store, /export const ASK_COLUMNS = \["name", "category", "market"\] as const;/, "the ask's columns are no longer name, category and market");
  assert.match(store, /write\(ask\)/, "writeAsk writes the ask's three fields");
  for (const route of ["app/api/scan/[token]/walkthrough/route.ts", "app/api/walkthrough/route.ts"]) {
    const src = code(readFileSync(join(SRC, route), "utf8"));
    const payloads = [...src.matchAll(/\.(?:insert|upsert)\(\s*\{([^}]*)\}/g)].map((m) =>
      m[1]
        .split(",")
        .map((k) => k.trim().split(":")[0]!.trim())
        .filter(Boolean)
        .sort(),
    );
    assert.equal(payloads.length, 1, `${route}: one write of the ask, found ${payloads.length}`);
    assert.deepEqual(payloads[0], ["...fields", "email", "ip_hash", "kind", "scan_id"], `${route} stores something /legal does not list`);
    assert.match(src, /await writeAsk\(ask, \(fields\) =>/, `${route} writes the ask through writeAsk`);
  }
});
