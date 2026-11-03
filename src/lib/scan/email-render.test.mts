import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { T } from "../../config/tokens.ts";
import {
  type Palette,
  type ReportCounts,
  escapeHtml,
  reportAfter,
  reportHeadline,
  reportHtml,
  reportSubject,
  reportText,
  requestedReason,
  verifyHtml,
  verifyText,
} from "./email-render.ts";

/**
 * The first time either transactional email has been rendered.
 *
 * Both messages were shipped, typechecked, built and reviewed without anything
 * ever producing their output. blocked.md carried "could not render either
 * message even once" as an open item across three runs, for want of `node` on
 * the allowlist. It is allowed now, so this is the real thing rather than
 * another regex read back over the source.
 *
 * **The palette used to be hand-copied here, and the comment above it claimed
 * that if the copy and verify-email.ts drifted, `no colour outside the palette`
 * would fail. It could not.** That test rendered with the local copy and then
 * checked the output against the same local copy - true by construction, for
 * any values at all. Nothing in this file read verify-email.ts, so the one
 * thing the duplicate existed to catch was the one thing it could not see. It
 * is this repo's named defect species: a tripwire that passes because it is
 * blind, and the fourth instance found.
 *
 * So the palette is read out of verify-email.ts instead of retyped. It cannot
 * be imported - that module pulls in `server-only`, the Resend SDK and the
 * `@/` alias, none of which load under `node --test`, which is the whole
 * reason email-render.ts exists - so it is parsed from the source, the same
 * way paid-get.test.mts and route-closure.test.mts read theirs.
 */
const VERIFY_EMAIL = join(import.meta.dirname, "verify-email.ts");

/** Where each field's value came from: a token name, or a literal hex. */
type Origin = { token: string | null; value: string };

function readEmailChrome(): { palette: Palette; origins: Record<string, Origin>; font: string } {
  const src = readFileSync(VERIFY_EMAIL, "utf8");

  // A counter-guard, not decoration. If `E` is renamed or reshaped, the parse
  // must fail loudly rather than quietly matching nothing and leaving this
  // file blind again in exactly the way it just was.
  const block = src.match(/const E: Palette = \{([^}]*)\}/);
  assert.ok(block, "verify-email.ts: no `const E: Palette = {...}` to read");

  const origins: Record<string, Origin> = {};
  for (const line of block[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("//")) continue;
    const m = line.match(/^\s*(\w+):\s*(?:T\.(\w+)|"([^"]*)")\s*,?\s*$/);
    assert.ok(m, `verify-email.ts: cannot read palette line ${JSON.stringify(line)}`);
    const [, key, tokenName, literal] = m;
    if (tokenName) {
      const value = (T as Record<string, string>)[tokenName];
      assert.ok(value, `verify-email.ts: palette ${key} reads T.${tokenName}, which is not a token`);
      origins[key] = { token: tokenName, value };
    } else {
      origins[key] = { token: null, value: literal };
    }
  }

  const font = src.match(/const FONT = "([^"]*)"/)?.[1];
  assert.ok(font, "verify-email.ts: no `const FONT` to read");

  return { palette: Object.fromEntries(
    Object.entries(origins).map(([k, o]) => [k, o.value]),
  ) as unknown as Palette, origins, font };
}

const { palette: E, origins: ORIGINS, font: FONT } = readEmailChrome();

const LINK = "https://alwayscited.com/scan/abc123";

/**
 * A real shape: fourteen questions on four engines, two of which nobody
 * answered. It is deliberately a scan where all five numbers differ, because
 * the defect this fixture exists for was two of them being the same pair.
 */
const COUNTS: ReportCounts = {
  missedAnswers: 38,
  totalAnswers: 56,
  missedQuestions: 9,
  answeredQuestions: 12,
  askedQuestions: 14,
};

const NOTHING_MISSED: ReportCounts = {
  missedAnswers: 0,
  totalAnswers: 56,
  missedQuestions: 0,
  answeredQuestions: 14,
  askedQuestions: 14,
};

/** Counts `<tag` against `</tag`, ignoring the mso conditional comments. */
function balance(html: string, tag: string): [number, number] {
  const open = html.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? [];
  const close = html.match(new RegExp(`</${tag}>`, "g")) ?? [];
  return [open.length, close.length];
}

function assertWellFormed(html: string, label: string) {
  for (const tag of ["html", "head", "title", "body", "table", "tr", "td", "div", "a", "span"]) {
    const [open, close] = balance(html, tag);
    assert.equal(open, close, `${label}: <${tag}> opened ${open} times, closed ${close}`);
  }
  assert.ok(html.startsWith("<!doctype html>"), `${label}: no doctype`);
  // The brand is read off a crawled site and can hold any character there is,
  // so the document declares its own encoding rather than depending on the
  // part header Resend sets.
  assert.match(html, /<meta charset="utf-8">/, `${label}: no charset`);
  // Outlook lays out with Word and ignores max-width; the conditional comment
  // is what gives it a fixed card, and half of one would leak into the markup.
  assert.equal((html.match(/<!--\[if mso\]>/g) ?? []).length, 2, `${label}: mso open`);
  assert.equal((html.match(/<!\[endif\]-->/g) ?? []).length, 2, `${label}: mso close`);
}

test("both messages render well-formed markup", () => {
  assertWellFormed(verifyHtml(E, FONT, "Vibe Retail", LINK), "verify");
  assertWellFormed(reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS), "report");
  assertWellFormed(reportHtml(E, FONT, "Vibe Retail", LINK, NOTHING_MISSED), "report, nothing missed");
});

test("no colour outside the palette reaches the inbox", () => {
  // The drift this catches really happened: the two messages were hand-copied
  // table markup carrying #f6f6f8 where the ground is #f6f6f7 and #eceef2
  // where the rule is #ececee, and they survived the sweep that moved all of
  // the site onto the tokens - because a hex in a template literal in a server
  // module is invisible to a sweep of the rendered site.
  const allowed = new Set(Object.values(E).map((c) => c.toLowerCase()));
  for (const html of [
    verifyHtml(E, FONT, "Vibe Retail", LINK),
    reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS),
  ]) {
    // Not preceded by &, or the run of &#8203; padding the preview line reads
    // as a colour called #8203. The first version of this test failed on
    // exactly that and the markup was fine.
    for (const hex of html.match(/(?<!&)#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      assert.ok(allowed.has(hex.toLowerCase()), `${hex} is not in the email palette`);
    }
  }
});

test("the email palette is the tokens, plus only its documented departures", () => {
  // What the old duplicate was meant to be doing and could not. verify-email.ts
  // documents exactly two departures from tokens.ts, and this is the assertion
  // that keeps a third from appearing silently - which is how the messages came
  // to carry #f6f6f8 and #eceef2 in the first place.
  assert.deepEqual(
    Object.keys(ORIGINS).sort(),
    ["accent", "body", "card", "ground", "ink", "line", "onAccent", "quiet"],
    "the email palette gained or lost a field",
  );

  // Departure one: `body` is deliberately darker than any token, for contrast
  // in clients we do not control. It is the only literal allowed.
  const literals = Object.entries(ORIGINS).filter(([, o]) => o.token === null);
  assert.deepEqual(
    literals.map(([k, o]) => `${k}:${o.value}`),
    ["body:#3d4451"],
    "a colour outside tokens.ts entered the email palette",
  );

  // Departure two: nothing here uses `faint`. tokens.ts says in its own doc
  // comment that light-ground text does not, and every email ground is light.
  assert.equal(
    Object.entries(ORIGINS).find(([, o]) => o.token === "faint"),
    undefined,
    "the email palette uses T.faint on a light ground",
  );
});

test("every text colour in the email clears WCAG AA on its own ground", () => {
  /**
   * Measured, not asserted from the doc comment. verify-email.ts claims
   * "#3d4451 measures 9.79 on white where T.soft is 4.68" and both check out
   * below - but they were reasoned about until now, and blocked.md item 9 is
   * forty-three elements on the live site failing this exact check because
   * nobody had run the numbers against the real ground.
   *
   * The email is the one surface that passes everywhere, and the reason is the
   * two departures above: `body` was darkened on purpose, and `quiet` sits on
   * the white card rather than on a tint. `T.soft` is 4.68 on white and 4.33 on
   * the page ground - so if the card ever becomes the ground, the footnote and
   * the aside fail. That is the regression this holds shut.
   */
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = (hex: string) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg: string, bg: string) => {
    const [a, b] = [luminance(fg), luminance(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  // Every place the shell puts text, with the colour it sits on. Read off
  // shell() and linkFallback() rather than listed from memory.
  const pairs: [string, string, string][] = [
    ["heading", E.ink, E.card],
    ["body", E.body, E.card],
    ["footnote", E.quiet, E.card],
    ["aside", E.quiet, E.card],
    ["link fallback", E.accent, E.card],
    ["button label", E.onAccent, E.accent],
  ];
  for (const [what, fg, bg] of pairs) {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${what}: ${fg} on ${bg} measures ${r.toFixed(2)}, AA needs 4.5`);
  }
});

test("a brand is escaped exactly once", () => {
  // Escaping the title and the preview line on top of a brand the caller had
  // already escaped sent "&amp;amp;" to the inbox. The shell escapes nothing
  // and the caller escapes once, so this is the assertion that keeps it so.
  const html = verifyHtml(E, FONT, "Ben & Jerry's", LINK);
  assert.match(html, /Ben &amp; Jerry&#39;s/);
  assert.doesNotMatch(html, /&amp;amp;/);
  assert.doesNotMatch(html, /Ben & Jerry/);
});

test("a brand cannot close a tag or open a script", () => {
  const html = reportHtml(E, FONT, `</title><script>alert(1)</script>`, LINK, COUNTS);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  // The heading, the title and the preview line all interpolate the brand, so
  // a single unescaped site would show up as an extra real </title>.
  const [open, close] = balance(html, "title");
  assert.equal(open, close);
  assert.equal(open, 1);
});

test("the preview line is not the heading again", () => {
  // With no preheader a client takes the first text it finds, which is the
  // heading - so the reader saw the same sentence twice and learned nothing
  // from the second.
  const verify = verifyHtml(E, FONT, "Vibe Retail", LINK);
  assert.match(verify, /Confirming your address opens the placements/);
  assert.match(verify, /One click and your Vibe Retail report opens/);

  const report = reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS);
  assert.match(report, /Your Vibe Retail report is ready/);
  // And it is not the subject again either. sendReportReadyEmail sends
  // "38 of 56 AI answers did not name Vibe Retail" as the subject, so a preview
  // line carrying the same count restates it rather than adding to it - which
  // is what it did until the message was first rendered.
  assert.match(report, /The pages you could be placed into, ranked/);
  const preheader = report.match(/font-size:1px;line-height:1px;[^>]*>([^<]*)</)?.[1] ?? "";
  assert.doesNotMatch(preheader, /\d+ of (the )?\d+/);
  // The number still leads the body, which is where it does work.
  assert.match(report, /9 of the 12 questions an engine answered came back without Vibe Retail/);
});

test("the subject counts answers and the body counts questions", () => {
  // The defect: one pair of numbers, counted over questions, printed in the
  // subject under the word "answers". On a four-engine scan the subject said
  // "9 of 14 AI answers" where the answers were 38 of 56 - and the h1 of the
  // page the link opens says the answer figure, so the two disagreed.
  assert.equal(
    reportSubject("Vibe Retail", COUNTS),
    "38 of 56 AI answers did not name Vibe Retail",
  );
  assert.match(reportHeadline("Vibe Retail", COUNTS), /^9 of the 12 questions/);

  // Nothing missed at the answer level is the only thing that drops the number
  // from the subject. A scan can miss no whole question and still have answers
  // that left the brand out, and that subject is still worth sending.
  assert.equal(reportSubject("Vibe Retail", NOTHING_MISSED), "Your Vibe Retail report");
  assert.equal(
    reportSubject("Vibe Retail", { ...NOTHING_MISSED, missedAnswers: 18 }),
    "18 of 56 AI answers did not name Vibe Retail",
  );
});

test("the link is in the button and in the fallback", () => {
  // A client that strips the button leaves the reader with nothing to click,
  // so the address is also printed. Both messages, both places.
  for (const html of [
    verifyHtml(E, FONT, "Vibe Retail", LINK),
    reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS),
  ]) {
    assert.match(html, new RegExp(`href="${LINK}"`));
    assert.match(html, /paste this into your browser/);
    assert.equal((html.match(new RegExp(LINK, "g")) ?? []).length, 2);
  }
});

test("a link is escaped into the href", () => {
  // The token is ours and is hex, so this is not a live hole. It is here
  // because the same link was already escaped for display in the fallback and
  // was not escaped into the attribute, and an inconsistency like that is only
  // safe for as long as nobody changes what builds the URL.
  const html = verifyHtml(E, FONT, "Vibe Retail", `https://alwayscited.com/x?a=1"onmouseover="x`);
  assert.doesNotMatch(html, /"onmouseover="/);
  assert.match(html, /&quot;onmouseover=&quot;/);
});

test("the headline the html shows is the headline the text part shows", () => {
  // The text part used to drop the number entirely, so a client showing text
  // only got the blandest version of the one thing worth saying.
  assert.equal(
    reportHeadline("Vibe Retail", COUNTS),
    "9 of the 12 questions an engine answered came back without Vibe Retail in the answer.",
  );
  assert.equal(
    reportHeadline("Vibe Retail", NOTHING_MISSED),
    "We put 14 buying-intent questions to the engines your buyers use.",
  );
  // Nothing missed must not read as "0 of the 14".
  assert.doesNotMatch(reportHeadline("Vibe Retail", NOTHING_MISSED), /^0 of/);
  // Both halves of the sentence are the same measure. The denominator is the
  // questions an engine answered, never every question asked - 9 of 12 here,
  // where the old shape printed "9 of the 14" for a figure whose real
  // denominator was twelve.
  assert.doesNotMatch(reportHeadline("Vibe Retail", COUNTS), /of the 14/);
});

test("a scan of one question does not say 1 questions", () => {
  /**
   * Reachable by an ordinary visitor, not a contrived input: the confirm
   * screen lets a buyer drop every cluster but one and keep a single question,
   * and it runs. This is the first sentence of the email that report arrives
   * in, so it is the first thing the buyer reads.
   */
  assert.equal(
    reportHeadline("Vibe Retail", { ...COUNTS, missedQuestions: 1, answeredQuestions: 1, askedQuestions: 1 }),
    "1 of the 1 question an engine answered came back without Vibe Retail in the answer.",
  );
  assert.equal(
    reportHeadline("Vibe Retail", { ...COUNTS, missedAnswers: 0, missedQuestions: 0, askedQuestions: 1 }),
    "We put 1 buying-intent question to the engines your buyers use.",
  );
});

test("the text part is plain text, and is not escaped", () => {
  /**
   * Both text parts were template literals inside verify-email.ts until now,
   * so nothing could render either one - the same blind spot as the palette,
   * one object literal away.
   *
   * The assertion that matters is the negative. A brand is read off a crawled
   * third-party site and goes into the HTML part escaped and the text part raw,
   * one line apart in the same `emails.send` call. Making the two "consistent"
   * is an obvious tidy and it sends `Ben &amp; Jerry&#39;s` to every reader
   * whose client shows text.
   */
  const verify = verifyText("Ben & Jerry's", LINK);
  assert.match(verify, /We ran the check on Ben & Jerry's\./);
  assert.doesNotMatch(verify, /&amp;|&#39;|&quot;|&lt;/);

  const report = reportText("Ben & Jerry's", LINK, COUNTS);
  assert.match(report, /came back without Ben & Jerry's in the answer/);
  assert.doesNotMatch(report, /&amp;|&#39;|&quot;|&lt;/);

  // No markup in a text/plain part either - an <a> here is read as literal
  // angle brackets by the client that asked for text.
  for (const text of [verify, report]) {
    assert.doesNotMatch(text, /<[a-z!/]/i);
    // A text-only client has nothing to click, so the address has to be typed
    // out. It dropping is silent and leaves that reader with no way in.
    assert.ok(text.includes(LINK), "the text part does not carry the link");
  }
});

test("the text part leads with the same headline the html does", () => {
  // The text part used to drop the number entirely. Both parts of one message
  // must say the same thing, so this reads the headline out of each.
  const headline = reportHeadline("Vibe Retail", COUNTS);
  assert.ok(reportText("Vibe Retail", LINK, COUNTS).startsWith(headline));
  assert.ok(reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS).includes(headline));

  // And the no-miss shape is still a sentence rather than "0 of the 14".
  assert.ok(
    reportText("Vibe Retail", LINK, NOTHING_MISSED).startsWith("We put 14 buying-intent questions"),
  );
});

/**
 * Danny's third condition on item 5, 20 September 2026 19:45.
 *
 * The requested send goes to an address nobody confirmed, so "the mail says why
 * it arrived, in its first line: somebody asked for this report on this domain
 * from alwayscited. The stranger case is the one this sentence is for, and it
 * is the difference between an unexpected mail and an unexplained one."
 *
 * Four properties, one test each, and the second is the one worth having: a
 * sentence that is present but third is not what was asked for, and nothing
 * about `includes` can tell the two apart.
 */
test("the requested send says why it arrived", () => {
  const reason = requestedReason("vibe-retail.com");
  assert.ok(reason.includes("vibe-retail.com"), "the reader recognises the domain, not our brand name");
  assert.ok(reason.includes("alwayscited"), "and it names who is writing to them");
  assert.ok(!/AlwaysCited|Alwayscited|always cited/.test(reason), "the brand never takes a capital");
});

test("the reason is the first line of both parts, not merely in them", () => {
  const reason = requestedReason("vibe-retail.com");
  assert.ok(
    reportText("Vibe Retail", LINK, COUNTS, "vibe-retail.com").startsWith(reason),
    "the text part must lead with it",
  );

  // In the HTML the body is one block, so "first" means before the headline
  // rather than at index 0 of the document - the heading and the preview line
  // are both above it by construction.
  const html = reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS, "vibe-retail.com");
  const headline = reportHeadline("Vibe Retail", COUNTS);
  assert.ok(html.includes(reason), "the html part must carry it at all");
  assert.ok(
    html.indexOf(reason) < html.indexOf(headline),
    "the reason must come before the number, or it is not the first line of anything",
  );
});

/**
 * The domain is read off what a visitor typed into a public form, so it is
 * arbitrary text in the HTML part and must not be in the text part - the same
 * split `verifyText` records about the brand, and the same way somebody tidies
 * the two into agreement.
 */
test("the domain is escaped in the html part and raw in the text part", () => {
  const nasty = `x.com"><script>alert(1)</script>`;
  assert.ok(!reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS, nasty).includes("<script>alert(1)"));
  assert.ok(reportText("Vibe Retail", LINK, COUNTS, nasty).includes(nasty));
});

/**
 * And the unlock's report mail must NOT carry it. That address was confirmed by
 * clicking a link in an earlier message, so it has a different answer to the
 * same question, and telling that reader "somebody asked" would be worse copy
 * than none - it reads as though we do not know it was them.
 */
test("the send to a confirmed address does not carry the sentence", () => {
  assert.ok(!reportText("Vibe Retail", LINK, COUNTS).includes("Somebody asked"));
  assert.ok(!reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS).includes("Somebody asked"));
});

/**
 * A scan from C1 on is the visitor's first cluster on the page it links to
 * (R114 S1, ScanCluster.dc.html), so the message says prompts and names the
 * keyword the page names - and names none when none was picked, the page's
 * "Not picked yet". A scan from before C1 keeps its questions word for word.
 */
test("a cluster scan's report says prompts and names its keyword, or none", () => {
  const chosen = { keyword: "invoicing software for freelancers" };
  assert.match(reportHeadline("Tallyroo", COUNTS, chosen), /^9 of the 12 prompts/);
  assert.match(reportHeadline("Tallyroo", NOTHING_MISSED, { keyword: null }), /^We put 14 buying-intent prompts/);
  assert.equal(reportHeadline("Tallyroo", COUNTS, null), reportHeadline("Tallyroo", COUNTS));
  assert.equal(reportAfter(null), reportAfter());

  const text = reportText("Tallyroo", LINK, COUNTS, undefined, chosen);
  assert.ok(text.includes("your first cluster, joined to “invoicing software for freelancers”"));
  assert.ok(!text.includes("question"));
  const html = reportHtml(E, FONT, "Tallyroo", LINK, COUNTS, undefined, chosen);
  assertWellFormed(html, "report, cluster");
  assert.ok(html.includes("your first cluster, joined to “invoicing software for freelancers”"));

  const none = reportText("Tallyroo", LINK, COUNTS, undefined, { keyword: null });
  assert.ok(none.includes("your first cluster, then the pages"));
  assert.ok(!none.includes("“"));

  // The keyword came off a keyword tool and is escaped in the HTML part only.
  const nasty = { keyword: "<script>alert(1)</script>" };
  assert.ok(!reportHtml(E, FONT, "Tallyroo", LINK, COUNTS, undefined, nasty).includes("<script>alert(1)"));
  assert.ok(reportText("Tallyroo", LINK, COUNTS, undefined, nasty).includes("<script>alert(1)</script>"));
});

test("escapeHtml covers the five", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  // Ampersand first, or the entities it writes get re-escaped.
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("3 Nov 2026: a report email with an unsubscribe link carries it in both parts, and stays well formed", () => {
  const unsub = "https://alwayscited.com/scan/" + "a".repeat(32) + "/unsubscribe";
  const html = reportHtml(E, FONT, "Vibe Retail", LINK, COUNTS, undefined, null, unsub);
  assertWellFormed(html, "report with unsubscribe");
  assert.ok(html.includes(`href="${unsub}"`) && />Unsubscribe</.test(html));
  assert.ok(reportText("Vibe Retail", LINK, COUNTS, undefined, null, unsub).endsWith(unsub));
  // The send always passes one: verify-email.ts builds it from the token, with the one-click headers beside it.
  const send = readFileSync(join(new URL(".", import.meta.url).pathname, "verify-email.ts"), "utf8");
  assert.match(send, /reportHtml\([^)]*unsub\.page\)/);
  assert.match(send, /reportText\([^)]*unsub\.page\)/);
  assert.match(send, /"List-Unsubscribe": `<\$\{unsub\.oneClick\}>`/);
});
