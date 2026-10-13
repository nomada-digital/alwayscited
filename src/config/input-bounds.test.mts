import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { COVERAGE_LIMITS, SCAN_LIMITS, WAITLIST_LIMITS } from "./contact.ts";

/**
 * Every field in the tree a stranger can type into, and whether anything bounds
 * what they can put in it.
 *
 * `scan-form.test.mts` is the same question asked of a denominator one form
 * wide: `<form action="/scan" method="get">`. It is correct about all five of
 * those and could not see any of these, which is the defect this queue keeps
 * naming arriving for the sixth time. Widening the denominator from "the /scan
 * GET forms" to "every input" found six unbounded fields in three files:
 *
 *   - four on `CoverageForm`, the form that spends money, whose route had its
 *     own table of limits typed inline - the fourth table `contact.ts` predicted
 *     in as many words;
 *   - the category field on `ConfirmScreen`, which is where a question is
 *     edited before it is billed, while its own question rows one screen down
 *     were bounded;
 *   - the email field on `ScanFlow`, while the same field on `RequestScanForm`
 *     was bounded.
 *
 * None of the six was a hole: every route already refused an over-length value.
 * What each one was is a refusal the visitor cannot act on, because `text()`
 * and its callers return the same message for too-short and too-long, and the
 * message describes the short case. The bound on the input is what makes that
 * branch unreachable from the form.
 *
 * The count is asserted, not the files. A census that silently narrows reads
 * exactly like a clean sweep - see the four blind tests in the queue.
 *
 * ## The walk was narrower than the heading, which is this file's own species
 *
 * Everything above was written under the heading "every `<input>` in the tree"
 * and the scanner matched `<input\b`. A `<textarea>` is a field a stranger
 * types into, it takes `maxLength`, and it was outside the denominator
 * entirely - so the check that exists to ask "is this bounded" could not ask it
 * of the **longest** free-text field on the site: `c-msg`, the 5000-character
 * contact message, which becomes the body of an email and is reflected back
 * into HTML on an error.
 *
 * Measured, not argued: deleting `maxLength={CONTACT_LIMITS.message}` from that
 * textarea left all 488 tests passing. There was no hole - the field is
 * bounded, and `contact/actions.ts` refuses an over-length message besides -
 * but nothing in this tree could have told you if it stopped being.
 *
 * `TAGS` is the fix and it is the thing to extend: a field type that accepts
 * typed text and honours `maxLength` belongs in it. `<select>` does not (it has
 * no free text) and there is no `contentEditable` anywhere in `src`; both were
 * checked rather than assumed, so the next run does not re-derive them.
 */

const SRC = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SOURCES = walk(SRC).filter((f) => /\.tsx$/.test(f));

type Field = { file: string; line: number; tag: string; id: string };

/**
 * The element names that accept typed text and honour `maxLength`. Extend this
 * rather than the regex - see the heading above for why it is a list.
 */
const TAGS = ["input", "textarea"];
const OPENER = new RegExp(`<(?:${TAGS.join("|")})\\b`, "g");

/**
 * Every such tag in the tree.
 *
 * Scanned brace-aware rather than with `/<input[^>]*>/`, because a JSX prop can
 * hold a `>` inside an expression - `onChange={(e) => ...}` is on most of these
 * inputs - and a regex that stops at the first `>` truncates the tag before its
 * maxLength, reading a bounded field as an unbounded one.
 *
 * Only the opening tag is read, which is what a non-self-closing
 * `<textarea>...</textarea>` needs: the walk stops at the first `>` outside a
 * brace, so the children are never part of the tag and cannot carry a
 * `maxLength=` into it from prose.
 */
function inputs(): Field[] {
  const out: Field[] = [];
  for (const file of SOURCES) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(OPENER)) {
      const start = m.index;
      let depth = 0;
      let end = -1;
      for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        else if (text[i] === ">" && depth === 0) {
          end = i + 1;
          break;
        }
      }
      assert.notEqual(end, -1, `${file}: a <${m[0].slice(1)}> with no closing bracket`);
      const tag = text.slice(start, end);
      out.push({
        file: file.slice(SRC.length),
        line: text.slice(0, start).split("\n").length,
        tag,
        id: tag.match(/id="([^"]+)"/)?.[1] ?? tag.match(/id=\{`([^`]+)`\}/)?.[1] ?? "",
      });
    }
  }
  return out;
}

/**
 * The two fields that are deliberately unbounded, each with the thing that
 * bounds it instead. Earned in the test rather than assumed: the check below
 * fails if one of these stops being unbounded, so the list cannot quietly grow
 * into a blanket pass.
 *
 * ## `why` was prose and `holds` is the fix
 *
 * Every reason here names something that bounds the field instead of a
 * `maxLength`, and until 20 September 2026 all of that was a string nothing
 * read. Measured: deleting the route's
 * `Buffer.byteLength(csv, "utf8") > MAX_COVERAGE_BYTES` left all 490 tests
 * green, so the half of `cc-coverage`'s reason that says "and again by the
 * route before it parses" - the last thing standing between the one form on
 * this site that spends money and an unbounded upload - was a claim held by
 * nobody. That is the `headerSafe` doc comment again, exactly: a census kept in
 * prose, true when typed and unfalsifiable afterwards, and this is the third
 * file to record it about itself.
 *
 * So an exemption now costs a `holds`: the file, and the substring in it that
 * has to still be there. It is a weak assertion by design - a substring, not a
 * behaviour - because the strong version is the route's own test and this is
 * only here to stop the *reason* rotting away silently. A `holds` that names
 * something no longer in the file fails, which is the whole point.
 */
type Exemption = { why: string; holds: { file: string; needs: string }[] };

const EXEMPT: Record<string, Exemption> = {
  "c-website": {
    why: [
      "the contact honeypot. A bot does not honour maxLength, so a bound here buys",
      "nothing, and a real visitor never reaches the field - it is tabIndex={-1}.",
      "What protects the log is the server: contact/actions.ts slices it to",
      "CONTACT_LIMITS.website before writing it.",
    ].join(" "),
    holds: [{ file: "app/contact/actions.ts", needs: "website.slice(0, LIMITS.website)" }],
  },
  // The picks a tier's CTA carries to /contact (R69 follow-up, 28 Sep 2026).
  // type=hidden: nobody can type in them, and maxLength does not apply to a
  // hidden input. A hand-made post is what reaches the server, which clamps
  // each to CONTACT_LIMITS and then validates it against the tier names and
  // SECTORS before any of it goes into a message.
  ...Object.fromEntries(
    (["tier", "sector", "clusters", "market"] as const).map((f) => [
      `c-${f}`,
      {
        why: [
          `the contact form's hidden ${f} pick, set from a validated URL by ContactTier.`,
          "type=hidden, which maxLength does not apply to and nobody types in. The",
          `server clamps it to CONTACT_LIMITS.${f} and validates it before use.`,
        ].join(" "),
        holds: [{ file: "app/contact/actions.ts", needs: `formData.get("${f}")?.toString(), LIMITS.${f})` }],
      },
    ]),
  ),
  // T6 part 1 (30 Sep 2026): the Clusters search form carries the range and
  // filter as hidden fields so a search keeps them. Nobody types in them; the
  // page re-reads each - rangeFrom clamps from/to/compare, and filter is
  // anything but named/never read as all.
  // 8 Oct 2026 (audit perf-8): the three pages' rangeFrom now also takes the
  // client's started_on, for the floor a stated from is held to
  // (read-shape.ts rangeFloor); the recorded call below moved with it.
  ...Object.fromEntries(
    (["from", "to", "compare", "filter"] as const).map((f) => [
      `cl-${f}`,
      {
        why: [
          `the Clusters search form's hidden ${f}, copied from the current URL so a search keeps it.`,
          "type=hidden, which maxLength does not apply to and nobody types in. The page",
          "re-validates it: rangeFrom for the range, and a two-value whitelist for the filter.",
        ].join(" "),
        holds: [
          { file: "app/app/[client]/clusters/page.tsx", needs: f === "filter" ? 'f === "named" || f === "never"' : "rangeFrom(sp, today, client.started_on)" },
        ],
      },
    ]),
  ),
  // DS20 (2 Oct 2026, R173 pass 2): the Cited pages search form carries the
  // range and the three filters as hidden fields, as Clusters' does. Nobody
  // types in them; the page re-reads each against its own whitelist.
  ...Object.fromEntries(
    (
      [
        ["from", "rangeFrom(sp, today, client.started_on)"],
        ["to", "rangeFrom(sp, today, client.started_on)"],
        ["compare", "rangeFrom(sp, today, client.started_on)"],
        ["cluster", '(data.clusters ?? []).some((c) => c.id === one("cluster"))'],
        ["engine", 'engines.find((e) => e === one("engine"))'],
        ["kind", 'k === "yours" || k === "others" ? k : "all"'],
      ] as const
    ).map(([f, needs]) => [
      `ct-${f}`,
      {
        why: [
          `the Cited pages search form's hidden ${f}, copied from the current URL so a search keeps it.`,
          "type=hidden, which maxLength does not apply to and nobody types in. The page",
          "re-validates it: rangeFrom for the range, this client's clusters, its tier's engines, a two-value kind.",
        ].join(" "),
        holds: [{ file: "app/app/[client]/cited/page.tsx", needs }],
      },
    ]),
  ),
  // DS21 (2 Oct 2026, R173 pass 2): Who is named's search form, the same
  // hidden range and filters bar kind, re-read by the named page.
  ...Object.fromEntries(
    (
      [
        ["from", "rangeFrom(sp, today, client.started_on)"],
        ["to", "rangeFrom(sp, today, client.started_on)"],
        ["compare", "rangeFrom(sp, today, client.started_on)"],
        ["cluster", '(data.clusters ?? []).some((c) => c.id === one("cluster"))'],
        ["engine", 'engines.find((e) => e === one("engine"))'],
      ] as const
    ).map(([f, needs]) => [
      `nm-${f}`,
      {
        why: [
          `the Who is named search form's hidden ${f}, copied from the current URL so a search keeps it.`,
          "type=hidden, which maxLength does not apply to and nobody types in. The page",
          "re-validates it: rangeFrom for the range, this client's clusters, its tier's engines.",
        ].join(" "),
        holds: [{ file: "app/app/[client]/named/page.tsx", needs }],
      },
    ]),
  ),
  // T6 part 3c (30 Sep 2026): step 2 of Add a cluster carries the checked
  // verdict as hidden fields. Nobody types in them; the cluster route clamps
  // each to ADMIN_LIMITS.question and refuses the lot unless the HMAC over
  // client, keyword, volume, intent and day verifies.
  ...Object.fromEntries(
    (["keyword", "vol", "intent", "sig"] as const).map((f) => [
      `nc-${f}`,
      {
        why: [
          `Add a cluster step 2's hidden ${f}, from Check keyword's signed pass.`,
          "type=hidden, which maxLength does not apply to and nobody types in. The route",
          "clamps it and refuses unless verifyCheck passes for this client and today.",
        ].join(" "),
        holds: [{ file: "app/api/app/[client]/cluster/route.ts", needs: "verifyCheck(" }],
      },
    ]),
  ),
  // R166 part 5 (2 Oct 2026): a setup card's Check keyword carries the card's
  // cluster id and its current keyword; a pass rides into Confirm as hidden
  // fields. The check route clamps both and only routes on the card; the setup
  // route names a pass in the mail only when verifyCheck passes and the card
  // is one of this client's clusters.
  "setup-card-${i}": {
    why: "A setup card's hidden cluster id. type=hidden, nobody types in it; the check route clamps it to 64 and the setup page matches it against its own cards.",
    holds: [{ file: "app/api/app/[client]/check/route.ts", needs: '(form.get("card") as string).slice(0, 64)' }],
  },
  "setup-own-${i}": {
    why: "A setup card's hidden current keyword. type=hidden, nobody types in it; the check route clamps it to ADMIN_LIMITS.question and uses it only to leave that keyword out of the tracked list.",
    holds: [{ file: "app/api/app/[client]/check/route.ts", needs: '(form.get("own") as string).slice(0, ADMIN_LIMITS.question)' }],
  },
  ...Object.fromEntries(
    (["card", "keyword", "vol", "intent", "sig"] as const).map((f) => [
      `sc-${f}`,
      {
        why: [
          `Setup Confirm's hidden ${f}, from a setup card's signed Check keyword pass.`,
          "type=hidden, which maxLength does not apply to and nobody types in. The route",
          "clamps it and names the pass in the mail only if verifyCheck passes for this client and today.",
        ].join(" "),
        holds: [{ file: "app/api/app/[client]/setup/route.ts", needs: "verifyCheck(pass," }],
      },
    ]),
  ),
  // R179 (2 Oct 2026): Change keyword on a pending Clusters card posts the
  // same hidden card and own as a setup card, plus on=clusters, to the check
  // route; a signed pass then rides to the keyword route as hidden fields, on
  // Clusters and on a setup card alike. The keyword route refuses unless
  // verifyCheck passes for this client and today.
  "rk-card-${c.id}": {
    why: "A pending Clusters card's hidden cluster id for Check keyword. type=hidden, nobody types in it; the check route clamps it to 64 and the page draws a verdict only on the card whose id matches.",
    holds: [{ file: "app/api/app/[client]/check/route.ts", needs: '(form.get("card") as string).slice(0, 64)' }],
  },
  "rk-own-${c.id}": {
    why: "A pending Clusters card's hidden current keyword. type=hidden, nobody types in it; the check route clamps it to ADMIN_LIMITS.question and uses it only to leave that keyword out of the tracked list.",
    holds: [{ file: "app/api/app/[client]/check/route.ts", needs: '(form.get("own") as string).slice(0, ADMIN_LIMITS.question)' }],
  },
  "rk-on-${c.id}": {
    why: "A fixed hidden word, on=clusters. type=hidden; the check route only compares it to \"clusters\" to pick where its 303 goes.",
    holds: [{ file: "app/api/app/[client]/check/route.ts", needs: 'form?.get("on") === "clusters"' }],
  },
  ...Object.fromEntries(
    (["kw", "vol", "intent", "sig"] as const).flatMap((f) => [
      [
        `rk-use-${f}-\${c.id}`,
        {
          why: `Use this keyword's hidden ${f} on a pending Clusters card, from its signed Check keyword pass. type=hidden, nobody types in it; the keyword route clamps it to ADMIN_LIMITS.question and refuses unless verifyCheck passes for this client and today.`,
          holds: [{ file: "app/api/app/[client]/keyword/route.ts", needs: "verifyCheck(" }],
        },
      ],
      [
        `setup-use-${f}-\${i}`,
        {
          why: `Use this keyword's hidden ${f} on a setup card, from its signed Check keyword pass. type=hidden, nobody types in it; the keyword route clamps it to ADMIN_LIMITS.question and refuses unless verifyCheck passes for this client and today.`,
          holds: [{ file: "app/api/app/[client]/keyword/route.ts", needs: "verifyCheck(" }],
        },
      ],
    ]),
  ),
  // T11 /ask (30 Sep 2026): "Ask us to pick one" carries the refused keyword
  // back as a hidden field. The ask route trims it and clamps it to
  // ADMIN_LIMITS.question in readAskKeyword before it goes in the mail.
  // 13 Oct 2026, DIY P5 (P4's /ai page, spec 10 section 4.2): AI visibility's search form carries the page's
  // state bar the search as hidden fields (`ai-${k}`: the range, cluster, angle, origin, eng, lfl, missing, sort
  // and dir), so a search keeps the view. Nobody types in them; the page re-reads every one against its own bound,
  // each registered in client-pages.test.mts.
  "ai-${k}": {
    why: [
      "AI visibility's search form's hidden view keys, copied from the page's own state so a search keeps it.",
      "type=hidden, which maxLength does not apply to and nobody types in. The page re-validates each: rangeFrom",
      "for the range, this client's clusters, its tier's engines, and fixed lists for angle, origin, sort and dir.",
    ].join(" "),
    holds: [
      { file: "app/app/[client]/ai/page.tsx", needs: "rangeFrom(sp, today, client.started_on)" },
      { file: "app/app/[client]/ai/page.tsx", needs: '(data.clusters ?? []).some((c) => c.id === one("cluster"))' },
      { file: "app/app/[client]/ai/page.tsx", needs: 'engines.find((e) => e === one("eng"))' },
      { file: "app/app/[client]/ai/page.tsx", needs: 'pickAngle(one("angle"))' },
      { file: "app/app/[client]/ai/page.tsx", needs: 'pickOrigin(one("origin"))' },
      { file: "app/app/[client]/ai/page.tsx", needs: 'pickSort(one("sort"))' },
      { file: "app/app/[client]/ai/page.tsx", needs: 'pickDir(one("dir"))' },
    ],
  },
  "ask-keyword": {
    why: [
      "Ask us to pick one's hidden keyword, the one Check keyword just refused.",
      "type=hidden, which maxLength does not apply to and nobody types in. ask.ts",
      "readAskKeyword clamps it to ADMIN_LIMITS.question on the server.",
    ].join(" "),
    holds: [{ file: "lib/tracking/ask.ts", needs: ".slice(0, ADMIN_LIMITS.question)" }],
  },
  // T11 part 5 (30 Sep 2026): an upgrade prompt's two plain HTML forms. The
  // cta fields are read against a fixed list; the items field is split and
  // kept only as uuids, at most ASK_ITEMS_MAX, then resolved against the
  // client's own rows, so no sent text reaches the mail.
  "up-ask-cta": {
    why: "Ask about these N's hidden cta. type=hidden, nobody types in it; ask.ts readUpgradeCta accepts only mentioned or cited.",
    holds: [{ file: "lib/tracking/ask.ts", needs: 'raw === "mentioned" || raw === "cited" ? raw : null' }],
  },
  "up-ask-items": {
    why: "Ask about these N's hidden prompt ids. type=hidden; ask.ts readAskItems keeps uuids only, capped at ASK_ITEMS_MAX, and the route lists only this client's rows.",
    holds: [{ file: "lib/tracking/ask.ts", needs: "out.size < ASK_ITEMS_MAX" }],
  },
  "up-hide-cta": {
    why: "Hide for 30 days's hidden cta. type=hidden, nobody types in it; ask.ts readHideCta accepts only the five cta_events ctas.",
    holds: [{ file: "lib/tracking/ask.ts", needs: "export const readHideCta" }],
  },
  // R142 part 2 (1 Oct 2026): Settings' team forms carry the op, the member's
  // email and the new role as hidden fields. Nobody types in them; team.ts
  // readTeamForm accepts only the three ops, an email that passes readEmail
  // (trimmed, format-checked, at most EMAIL_MAX) and Editor or Viewer.
  ...Object.fromEntries(
    ["tm-role-op-${i}", "tm-role-email-${i}", "tm-role-role-${i}", "tm-rm-op-${i}", "tm-rm-email-${i}", "tm-inv-op"].map((id) => [
      id,
      {
        why: [
          "a Settings team form's hidden field: the op, a listed member's email or the new role.",
          "type=hidden, which maxLength does not apply to and nobody types in. team.ts readTeamForm",
          "accepts only invite/role/remove, an email readEmail passes, and editor or viewer.",
        ].join(" "),
        holds: [{ file: "lib/tracking/team.ts", needs: "e.length <= EMAIL_MAX && isPlausibleEmail(e)" }],
      },
    ]),
  ),
  // AG-1 (9 Oct 2026): Settings' invite carries its scope - two radios on an
  // account with two or more clients, or a hidden "account" while the scope
  // table is not there yet. Nothing typed; team.ts reads only the two words,
  // and anything else is this client only.
  ...Object.fromEntries(
    ["tm-inv-scope-client", "tm-inv-scope-account", "tm-inv-scope"].map((id) => [
      id,
      {
        why: [
          "the invite form's scope, a radio or a hidden field: client or account.",
          "Nothing is typed in it. team.ts readScopeWord accepts only those two words, and",
          "inviteScope reads anything but an explicit account as this client only.",
        ].join(" "),
        holds: [
          { file: "lib/tracking/team.ts", needs: '(raw === "client" || raw === "account" ? raw : null)' },
          { file: "lib/tracking/team.ts", needs: 'return raw === "account" ? "account" : "client";' },
        ],
      },
    ]),
  ),
  // R142 part 3 (1 Oct 2026): Settings' two asks carry `about`, and "Sign out
  // of every device" carries everywhere=1, as hidden fields.
  "set-ask-aliases": {
    why: "Settings' alias ask's hidden `about`. type=hidden, nobody types in it; ask.ts readAskAbout accepts only aliases or billing.",
    holds: [{ file: "lib/tracking/ask.ts", needs: 'raw === "aliases" || raw === "billing" ? raw : null' }],
  },
  "set-ask-billing": {
    why: "Settings' billing ask's hidden `about`. type=hidden, nobody types in it; ask.ts readAskAbout accepts only aliases or billing.",
    holds: [{ file: "lib/tracking/ask.ts", needs: 'raw === "aliases" || raw === "billing" ? raw : null' }],
  },
  // 8 Oct 2026: Settings > Billing's "Cancel trial" confirm carries confirm=1.
  "set-trial-confirm": {
    why: "Cancel trial's hidden `confirm`. type=hidden, nobody types in it; the trial route acts only when it is exactly \"1\".",
    holds: [{ file: "app/api/app/[client]/trial/route.ts", needs: 'form?.get("confirm") !== "1"' }],
  },
  // R151 (2 Oct 2026): /app/login posts without script, so the page a
  // signed-out visitor was going to rides the form as a hidden field.
  "app-login-next": {
    why: "The login form's hidden next path, set by the page from safeNext. type=hidden, nobody types in it; the login route passes it through safeNext again before it reaches a link or a redirect.",
    holds: [{ file: "app/api/app/login/route.ts", needs: "const next = safeNext(body.next)" }],
  },
  // R151 (3 Oct 2026): SendNewLink posts without script, so the address the
  // spent link or the order went to rides the form as a hidden field.
  "send-new-link-email": {
    why: "SendNewLink's hidden address, set by the page from the spent token's row or the checkout Session. type=hidden, nobody types in it; the login route normalises it and refuses it over SCAN_LIMITS.email or when isPlausibleEmail fails.",
    holds: [{ file: "app/api/app/login/route.ts", needs: "email.length > SCAN_LIMITS.email || !isPlausibleEmail(email)" }],
  },
  // R151 (3 Oct 2026): the walkthrough ask posts without script, so its choice
  // and the page to come back to ride the form as hidden fields.
  "wt-kind": {
    why: "The walkthrough ask's hidden kind, set by its toggle. type=hidden, nobody types in it; the walkthrough route accepts only the exact words video or demo.",
    holds: [{ file: "app/api/scan/[token]/walkthrough/route.ts", needs: 'body.kind === "demo" ? "demo" : body.kind === "video" ? "video" : null' }],
  },
  "wt-back": {
    why: "The walkthrough ask's hidden way back, set by the coverage reading page. type=hidden, nobody types in it; walkthroughBack accepts only a /scan/ or /coverage-check/ path of at most 80 token characters, else the scan's own page.",
    holds: [{ file: "lib/scan/walkthrough-outcome.ts", needs: "/^\\/(scan|coverage-check)\\/[A-Za-z0-9_-]{1,80}$/.test(raw)" }],
  },
  "set-out-all": {
    why: "Sign out of every device's hidden flag. type=hidden, nobody types in it; the logout route acts only on the exact value 1 and reads the email off the session row, never the form.",
    holds: [{ file: "app/api/app/logout/route.ts", needs: 'form?.get("everywhere") === "1"' }],
  },
  // R140 (1 Oct 2026): step 2's coverage ticks. type=checkbox, nobody types in
  // it and it carries no value; what is posted is the ticked rows' urls, which
  // came from parseCoverageCsv and are cut to MAX_COVERAGE_URLS by tickedRows
  // and again by the run route.
  "cc-row-${i}": {
    why: "Step 2's coverage tick. type=checkbox, nothing typed; tickedRows caps the posted urls at MAX_COVERAGE_URLS and the run route caps them again.",
    holds: [{ file: "app/api/coverage-check/route.ts", needs: "parsed.rows.slice(0, MAX_COVERAGE_URLS)" }],
  },
  // DS13 (R173 pass 2, 2 Oct 2026): the Ungrouped bulk ticks. type=checkbox,
  // nothing typed; each carries a listed prompt's id, and the stop and group
  // routes keep only well-formed ids, once each, at most BULK_MAX.
  "ug-tick-${q.id}": {
    why: "An ungrouped prompt's bulk tick. type=checkbox, nothing typed; readBulkIds keeps well-formed ids once each, capped at BULK_MAX, and each id still goes through the one-row stop or move rules.",
    holds: [{ file: "lib/tracking/stop.ts", needs: "[...new Set(ids)].slice(0, BULK_MAX)" }],
  },
  "cc-coverage": {
    why: [
      "type=file, which maxLength does not apply to at all. It is bounded by bytes",
      "in onFile against MAX_COVERAGE_BYTES, and again by the route before it",
      "parses.",
    ].join(" "),
    holds: [
      // Both halves of the reason, because they are two different bounds and
      // the route's is the one that survives a post that never rendered the
      // page - which is the only kind this file is about.
      { file: "components/coverage/CoverageForm.tsx", needs: "file.size > MAX_COVERAGE_BYTES" },
      {
        file: "app/api/coverage-check/route.ts",
        // `csv` until 24 Sep 2026, when the pasted block became its own field
        // and the file half kept the byte bound under its own name.
        needs: 'Buffer.byteLength(file, "utf8") > MAX_COVERAGE_BYTES',
      },
    ],
  },
};

test("the census still sees every field - a shrinking count is a blind probe", () => {
  const found = inputs();
  const files = new Set(found.map((f) => f.file));
  // 23 when the walk was widened to textarea: 22 <input> and 1 <textarea>.
  assert.ok(
    found.length >= 23,
    `only ${found.length} fields were found across the tree, and there were 23 when this was written - a falling count means the scanner broke, not that fields were deleted`,
  );
  assert.ok(files.size >= 11, `only ${files.size} files carry a field, and 11 did`);
});

/**
 * The floor above counts fields and cannot notice that one whole *kind* of
 * field stopped being seen - 23 is also what you get from 23 inputs and a
 * scanner that has quietly lost `textarea`, which is the state this file was in
 * until 20 September 2026. Every tag in `TAGS` has to be found somewhere.
 */
test("every kind of field in TAGS is actually found by the scanner", () => {
  const found = inputs();
  for (const tag of TAGS) {
    assert.ok(
      found.some((f) => f.tag.startsWith(`<${tag}`)),
      `TAGS lists "${tag}" and the scanner found none in the tree - either the walk is broken, or drop it from TAGS so the list stays honest`,
    );
  }
});

test("every input is bounded, or is on the exemption list with its reason", () => {
  const unbounded = inputs()
    .filter((f) => !/maxLength=/.test(f.tag))
    .filter((f) => !(f.id in EXEMPT))
    .map((f) => `${f.file}:${f.line} ${f.id || "(no id)"}`);
  assert.deepEqual(
    unbounded,
    [],
    "these accept unbounded typed input. Bound them from a constant in config/contact.ts, or add an id to EXEMPT with what bounds it instead",
  );
});

test("no exemption is stale - each one is still a field, and still unbounded", () => {
  const found = inputs();
  for (const [id, { why }] of Object.entries(EXEMPT)) {
    const field = found.find((f) => f.id === id);
    assert.ok(field, `EXEMPT lists "${id}", which is no longer a field in the tree - drop it`);
    assert.ok(
      !/maxLength=/.test(field.tag),
      `EXEMPT lists "${id}" as deliberately unbounded, but it now carries a maxLength - drop it from the list`,
    );
    assert.ok(why.length > 40, `EXEMPT["${id}"] needs a reason, not a placeholder`);
  }
});

/**
 * And that what the reason points at is still there.
 *
 * Comments stripped before matching, for the reason the census at the foot of
 * this file strips them: a reason quoted back in a doc comment beside the code
 * it describes would satisfy this against a file where the code had gone.
 */
test("every exemption's reason points at something that is still in the tree", () => {
  for (const [id, { holds }] of Object.entries(EXEMPT)) {
    assert.ok(
      holds.length > 0,
      `EXEMPT["${id}"] has no holds - an exemption whose reason nothing checks is the prose census this list replaced`,
    );
    for (const { file, needs } of holds) {
      const path = join(SRC, file);
      let source: string;
      try {
        source = readFileSync(path, "utf8");
      } catch {
        assert.fail(`EXEMPT["${id}"] says ${file} bounds it, and that file is gone`);
      }
      assert.ok(
        code(source).includes(needs),
        `EXEMPT["${id}"] says ${file} bounds it with \`${needs}\`, and that is no longer in the file. Either the bound moved - update holds - or it went, and this field is now unbounded end to end.`,
      );
    }
  }
});

/**
 * A typed `maxLength={120}` passes the check above while being exactly the
 * defect it exists to catch: `ConfirmScreen`'s question rows carried
 * `maxLength={200}`, which matched the confirm route's own 200 by coincidence
 * and would not have followed it anywhere.
 */
test("every bound is read from a constant, never typed as a number", () => {
  const typed = inputs()
    .filter((f) => /maxLength=\{\s*\d/.test(f.tag))
    .map((f) => `${f.file}:${f.line} ${f.id || "(no id)"}`);
  assert.deepEqual(typed, [], "these type a bound as a literal instead of reading one from config");
});

/**
 * The other half of the same rule, on the side the input cannot see. A bound on
 * the field and a different number in the route is the disagreement the field
 * bound was added to prevent, so the routes are read for a typed comparison the
 * same way the inputs are.
 *
 * **This list is typed, and that is the half that went wrong.** It names three
 * routes and asks whether each reads the right constant. What it cannot ask is
 * whether a constant is read by *anything* - so a bound that exists, is asserted
 * below as a number, and is enforced by no server at all sits outside it. That
 * is what happened to `SCAN_LIMITS.email`; the derived census further down is
 * the denominator this check does not have, and the two are kept apart because
 * they answer different questions: this one is "the right constant", that one is
 * "any server at all".
 */
const ROUTES = walk(new URL("../app/api", import.meta.url).pathname).filter((f) => /route\.ts$/.test(f));

test("the routes behind these fields compare against the same constants", () => {
  const checks: { route: string; typed: RegExp; constant: string }[] = [
    { route: "coverage-check/route.ts", typed: /text\(body\.\w+,\s*\d/, constant: "COVERAGE_LIMITS" },
    { route: "confirm/route.ts", typed: /topic\.length > \d|question\.length > \d/, constant: "SCAN_LIMITS" },
    { route: "questions/route.ts", typed: /topic\.length > \d/, constant: "SCAN_LIMITS" },
  ];
  for (const { route, typed, constant } of checks) {
    const file = ROUTES.find((f) => f.endsWith(route));
    assert.ok(file, `${route} was not found - this check has gone blind`);
    const text = readFileSync(file, "utf8");
    assert.ok(
      text.includes(constant),
      `${route} bounds a field the form also bounds, but does not read ${constant}`,
    );
    assert.ok(!typed.test(text), `${route} still compares a length against a typed number`);
  }
});

/**
 * The one field two routes both take off the wire, held to one set of numbers.
 *
 * `body.topic_variants` is read by `confirm` and by `questions`, and each
 * filtered it with `v.length >= 2 && v.length <= 80` typed as literals, then
 * capped it - `questions` at `TOPIC_VARIANT_COUNT`, `confirm` at a typed `5`.
 * Three numbers duplicated across two routes on one field, agreeing today by
 * coincidence. `TOPIC_VARIANT_COUNT` is the live one: `anthropic.ts` interpolates
 * it into the prompt, so raising it changes what the model returns and what the
 * screen shows, and the typed `5` would have gone on trimming the confirmed set
 * back down in silence.
 *
 * The routes are named here rather than derived, and that is the weakness this
 * check has - the same one the three-route check above carries. What holds the
 * derived half is the census at the foot of this file: `topicVariant` is a key
 * in a table now, so a route that stops reading it makes that census fail.
 *
 * **Both halves were keyed on the SHAPE of the fix until 20 Sep 2026**, and the
 * cap half read `.slice(0, TOPIC_VARIANT_COUNT)` literally. When the cleaning
 * moved into `normaliseTopicVariants` the cap became an argument, the property
 * was still true, and this rule failed on it - `296739d`'s species arriving
 * from the other side, where the walk can only see the files that still have
 * the old fix in them. It asks for the constant now, not for the call that
 * happens to consume it.
 *
 * The derived version of this rule lives in `src/lib/scan/topic-variants.test.mts`,
 * which walks every door onto the column rather than naming two. What is kept
 * here is the half that file does not do: that no typed number is compared
 * against a variant length in these routes.
 */
const VARIANT_ROUTES = ["confirm/route.ts", "questions/route.ts"];

test("both routes that take topic_variants read one cap, not two that match", () => {
  for (const route of VARIANT_ROUTES) {
    const file = ROUTES.find((f) => f.endsWith(route));
    assert.ok(file, `${route} was not found - this check has gone blind`);
    const text = code(readFileSync(file, "utf8"));
    assert.ok(
      /\bTOPIC_VARIANT_COUNT\b/.test(text),
      `${route} caps topic_variants at something other than TOPIC_VARIANT_COUNT`,
    );
    assert.ok(
      !/\bcap\s*:\s*\d/.test(text) && !/\.slice\(\s*0\s*,\s*\d/.test(text),
      `${route} caps topic_variants at a typed number`,
    );
    assert.ok(
      text.includes("SCAN_LIMITS.topicVariant.min") && text.includes("SCAN_LIMITS.topicVariant.max"),
      `${route} bounds a topic variant without reading SCAN_LIMITS.topicVariant`,
    );
    assert.ok(
      !/\bv\.length\s*[<>]=?\s*\d/.test(text),
      `${route} still compares a variant length against a typed number`,
    );
  }
});

/**
 * Asserted as values so the checks above cannot pass over a table that has
 * drifted. 253 is the longest a DNS name may be; 254 the longest an address may
 * be over SMTP; 120 and 200 are what the scan routes have always enforced.
 *
 * The heading on this test was a claim about servers and the body is a claim
 * about numbers, and the gap between the two is where `SCAN_LIMITS.email` sat:
 * asserted here as 254, carried by `ScanFlow` as a `maxLength`, and read by no
 * server anywhere. The claim is executable now - see the census below, which is
 * what actually earns this heading. **A test that duplicates a value to compare
 * against has to say what reads the original**, and until 20 September 2026 the
 * honest answer for one of these five was "nothing".
 */
test("the bounds are the numbers the servers actually enforce", () => {
  assert.equal(WAITLIST_LIMITS.domain, 253);
  assert.equal(SCAN_LIMITS.topic, 120);
  assert.equal(SCAN_LIMITS.question, 200);
  assert.equal(SCAN_LIMITS.email, 254);
  assert.deepEqual(SCAN_LIMITS.topicVariant, { min: 2, max: 80 });
  assert.deepEqual(COVERAGE_LIMITS.brand, { min: 2, max: 80 });
  assert.deepEqual(COVERAGE_LIMITS.topic, { min: 2, max: 120 });
  assert.deepEqual(COVERAGE_LIMITS.segment, { min: 2, max: 80 });
});

/**
 * `TopicScreen` posts to the waitlist action, not to a scan route, so its topic
 * bound is the waitlist's 200 and not SCAN_LIMITS.topic. The two are different
 * numbers for different servers and look like a drift that wants tidying; this
 * holds the negative so the next run does not "fix" them into agreement.
 */
test("the waitlist topic bound is not the scan one, deliberately", () => {
  assert.notEqual(WAITLIST_LIMITS.topic, SCAN_LIMITS.topic);
  const screens = readFileSync(join(SRC, "components/scan/screens.tsx"), "utf8");
  assert.ok(
    screens.includes("maxLength={WAITLIST_LIMITS.topic}"),
    "TopicScreen's topic field should read WAITLIST_LIMITS.topic - it posts to the waitlist action",
  );
});

// ------------------------------------------- does any server read this bound?

/**
 * Every bound this file declares, and the server that enforces it.
 *
 * ## The defect this was written for
 *
 * `SCAN_LIMITS.email` is 254. `ScanFlow` carries it as `maxLength`. The test
 * above asserts the number under the heading "the bounds are the numbers the
 * servers actually enforce". All three of those were true and **no server
 * enforced it**: `/api/scan/[token]/unlock` read `body.email` off the request
 * JSON, tested it against `/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i` - two unbounded runs
 * either side of an `@` - and passed it to the `to:` header of a Resend send, to
 * a `leads` insert whose column is `text`, to `resolveAccount`, which creates an
 * `accounts` row from it, and back out in its own response body.
 *
 * Nothing in this tree could see that. The route check above walks a **typed**
 * list of three routes and asks whether each reads the right constant; a bound
 * read by nobody is not a wrong constant, it is an absent one, and absence is
 * what a typed list is structurally unable to report. `contact.test.mts` reads
 * one file. `email-header.test.mts` sweeps every `emails.send` in the tree for a
 * safe subject and then bounds the fields of exactly one action, `waitlist.ts`,
 * named by hand - its own header says "a third form is one entry from being
 * covered by both", which is the admission that the second half is a typed list
 * too. So the bound half of "what a sender owes" had a denominator of one file
 * while the subject half had a denominator of the tree.
 *
 * ## What this walks, and why it is the whole set
 *
 * The tables in this file are the only place a bound is allowed to come from -
 * the check above fails a `maxLength={120}` typed as a literal - so every bound
 * on the site is a key in one of them. That makes the key set the denominator,
 * and it is derived here by parsing this file rather than typed, so a fifth
 * table joins the sweep by existing.
 *
 * A "server" is any `.ts` in the tree that is not a component, not a test and
 * not this file: that covers `route.ts`, both `"use server"` actions and
 * anything under `lib`. `.tsx` is excluded deliberately - a `maxLength` is the
 * bound this census exists to distrust.
 */
const LIMITS_FILE = join(SRC, "config/contact.ts");
const LIMITS_SOURCE = readFileSync(LIMITS_FILE, "utf8");

/**
 * The tables and their top-level keys, sliced by brace depth.
 *
 * Depth-aware rather than `\{([^}]*)\}`, for the reason the input scanner is:
 * `COVERAGE_LIMITS` holds `{ min, max }` objects, and a reader that stops at the
 * first `}` sees one key where there are three and reports two bounds as covered
 * that it never looked at.
 */
function limitTables(source: string): { table: string; keys: string[] }[] {
  const out: { table: string; keys: string[] }[] = [];
  for (const m of source.matchAll(/export const (\w+_LIMITS)\s*=\s*\{/g)) {
    const open = source.indexOf("{", m.index);
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    assert.notEqual(close, -1, `${m[1]} is not closed`);
    const body = source.slice(open + 1, close);
    // Top-level keys only: a nested `{ min: 2, max: 80 }` is one bound named by
    // its outer key, and a reader is allowed to reach into it.
    const keys: string[] = [];
    let depthIn = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "{") depthIn++;
      else if (body[i] === "}") depthIn--;
      else if (depthIn === 0) {
        const rest = body.slice(i);
        const k = /^(\w+)\s*:/.exec(rest);
        if (k && (i === 0 || /[\s,{]/.test(body[i - 1]))) keys.push(k[1]);
      }
    }
    out.push({ table: m[1], keys });
  }
  return out;
}

const TABLES = limitTables(LIMITS_SOURCE);

/**
 * Comments stripped before anything is matched, lifted from `mail-doors.test.mts`.
 *
 * Load-bearing here, and measured rather than assumed: the injection that
 * removes the unlock route's `SCAN_LIMITS.email` came back MISSED against the
 * first draft of this file, because the doc comment the route carries *beside*
 * that check names the constant in prose. So the census read an explanation of
 * a bound as the enforcement of one - the exact failure `config/contact.ts` has
 * now recorded three times about its own comments, arriving a fourth time in
 * the test written to stop it.
 *
 * The `[^:]` guard keeps a `https://` inside a string from eating its line.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVER_FILES = walk(SRC)
  .filter((f) => /\.ts$/.test(f) && !/\.test\.mts$/.test(f) && !/\.tsx$/.test(f))
  .filter((f) => f !== LIMITS_FILE)
  .map((f) => ({ file: f.slice(SRC.length), source: code(readFileSync(f, "utf8")) }))
  // A `.ts` that declares itself a client module is not a server, and a bound
  // it read would be the same `maxLength` promise under another name.
  .filter(({ source }) => !/^\s*["']use client["']/m.test(source));

/**
 * What a file calls a table it imported.
 *
 * Both public actions write `import { CONTACT_LIMITS as LIMITS }` and then
 * `LIMITS.email`, so a census grepping for `CONTACT_LIMITS.email` finds nothing
 * in the one file that enforces it and reports every contact bound as orphaned.
 * That is not hypothetical - it is what the first draft of this did, and the
 * alias test below is what said so.
 */
function localNames(source: string, table: string): string[] {
  const names: string[] = [];
  // `(\.ts)?` from 30 Sep 2026 (T6 part 1): a lib file imports the tables as
  // `../../config/contact.ts` so `node --test` can load it, and the bare
  // pattern read that server as not importing them at all - a blind spot, so
  // widened rather than worked round.
  for (const imp of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*config\/contact(?:\.ts)?["']/g)) {
    for (const spec of imp[1].split(",")) {
      const as = new RegExp(`^\\s*${table}\\s+as\\s+(\\w+)\\s*$`).exec(spec);
      if (as) names.push(as[1]);
      else if (spec.trim() === table) names.push(table);
    }
  }
  return names;
}

function serverReaders(table: string, key: string): string[] {
  const out: string[] = [];
  for (const { file, source } of SERVER_FILES) {
    for (const local of localNames(source, table)) {
      if (new RegExp(`\\b${local}\\.${key}\\b`).test(source)) {
        out.push(file);
        break;
      }
    }
  }
  return out;
}

test("the table reader finds the tables and keys this test thinks it does", () => {
  // The floor every sweep in this tree keeps. A parse that stops parsing turns
  // the census into a loop over nothing, which passes, and reads exactly like a
  // tree where every bound is enforced.
  assert.ok(TABLES.length >= 4, `expected 4+ limit tables, found ${TABLES.map((t) => t.table).join(", ")}`);
  const total = TABLES.reduce((n, t) => n + t.keys.length, 0);
  // 16: 5 contact, 4 waitlist, 3 coverage, 4 scan. Was 15 before SCAN_LIMITS
  // gained topicVariant, which is the fifth bound this file predicted.
  assert.ok(total >= 16, `expected 16+ bounds across the tables, found ${total}`);
  // And that a nested bound inside an otherwise flat table is read as one key
  // rather than swallowing the keys after it - SCAN_LIMITS is the mixed case.
  const scan = TABLES.find((t) => t.table === "SCAN_LIMITS");
  assert.ok(scan, "SCAN_LIMITS was not parsed");
  assert.deepEqual([...scan.keys].sort(), ["email", "question", "topic", "topicVariant"]);
  // And that the nested table is read as three bounds rather than as one, which
  // is the case a `[^}]*` slice gets wrong.
  const coverage = TABLES.find((t) => t.table === "COVERAGE_LIMITS");
  assert.ok(coverage, "COVERAGE_LIMITS was not parsed");
  // links and prompts from 24 Sep 2026 - the benchmark form's two pasted
  // blocks, which are typed into and so are bounded here rather than by bytes.
  assert.deepEqual([...coverage.keys].sort(), ["brand", "links", "prompts", "segment", "topic"]);
});

/**
 * The alias resolution is load-bearing, proved the way round that can be proved.
 *
 * "Delete the alias handling and this must fail" is the assertion worth having
 * and it is the one written below: `CONTACT_LIMITS` is imported under a
 * different name by the only server that enforces it, so the bare form appears
 * in no server file at all. A census that did not resolve the alias would report
 * all five contact bounds as unenforced - the loud direction, which is the
 * lucky one. The quiet direction is a table somebody later imports unaliased
 * while the resolver has rotted, and the floor above is what holds that.
 */
test("a table imported under another name is still found", () => {
  const bare = SERVER_FILES.filter(({ source }) => /\bCONTACT_LIMITS\.\w/.test(source));
  assert.deepEqual(
    bare.map((f) => f.file),
    [],
    "CONTACT_LIMITS is read through an alias on the server, and this test's premise is that nothing reads it bare",
  );
  const readers = serverReaders("CONTACT_LIMITS", "message");
  assert.ok(
    readers.some((f) => f.includes("contact/actions.ts")),
    `the alias resolver cannot see CONTACT_LIMITS.message in contact/actions.ts - it found ${readers.join(", ") || "nothing"}`,
  );
});

/**
 * The census.
 *
 * Nothing here is exempt and nothing here is expected to be. A bound that no
 * server reads is a promise made to the person who renders the form and to
 * nobody who posts to it, and the whole reason these tables exist - written at
 * the top of `config/contact.ts` in as many words - is that "the form is a
 * public endpoint and nothing stops a post that never rendered the page".
 *
 * If a future bound genuinely belongs to the input alone, this is the right
 * place for the argument, and it wants an exemption list with a reason the way
 * the input census has one - not a deletion.
 *
 * ## What this is blind to, asked of itself while the denominator is fresh
 *
 * It proves a server **reads** the constant. It cannot prove the server **acts**
 * on it: `if (email.length > SCAN_LIMITS.email) { }` reads the bound and
 * enforces nothing, and so does a `>=` where a `>` was meant. Nothing here can
 * see either. The typed route check above is the half that asks the narrower
 * question well, for the three routes on its list, and the two together are
 * still short of "the bound is the one the server applies".
 *
 * ## That candidate was taken, read, and judged - do not re-derive it
 *
 * Every reader was walked by hand on 20 September 2026 and every one of them
 * acts. There are two idioms and both are live:
 *
 *   - refuse - `contact/actions.ts` (four fields), `unlock` and `confirm` and
 *     `questions` on a length, `coverage-check` through `text()`, which
 *     compares both ends and returns null;
 *   - clamp - `waitlist.ts` on all four of its fields, and the two honeypots on
 *     the way to a log.
 *
 * The one shape that would have made this pay is a clamp that lands *before* a
 * refusal on the same string, which makes the refusal unreachable: the visitor
 * is silently truncated where the code says they are told. `contact/actions.ts`
 * looks like that and is not - it clamps into `values`, the echo handed back to
 * the form, and tests the unclamped locals. Read those eleven lines before
 * believing otherwise.
 *
 * So there is no live defect here and, by this queue's rule for a guard with no
 * observable effect, a check for it would be decoration today. What was found
 * instead by asking the question one level up - does this file's WALK match its
 * own HEADING - is the textarea above and the `topic_variants` pair below.
 */
test("every declared bound is enforced by a server, not only by an input", () => {
  const orphans: string[] = [];
  for (const { table, keys } of TABLES) {
    for (const key of keys) {
      if (serverReaders(table, key).length === 0) orphans.push(`${table}.${key}`);
    }
  }
  assert.deepEqual(
    orphans,
    [],
    "these bounds are carried by a maxLength and by nothing on the server, so a post that never rendered the form walks straight past them",
  );
});
