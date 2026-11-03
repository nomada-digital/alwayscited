/**
 * The transactional email markup, with nothing in it that touches the network.
 *
 * Split out of verify-email.ts on 19 Sep 2026 so the messages can actually be
 * rendered. Until now they never had been - not once, in any session. They
 * were typechecked, built, and read back out of the source with a regex, and
 * every claim about them was a claim about the code rather than about the
 * output. blocked.md carried that as an open item for want of a runner.
 *
 * The obstacle was never the markup, it was the imports. verify-email.ts
 * pulls in `server-only`, the Resend SDK and the `@/` path alias, and none of
 * those load under `node --test`. So the part worth checking is here, and the
 * palette and the font arrive as arguments rather than as a dependency. That
 * is what makes `email-render.test.mts` possible, and the test is the reason
 * to prefer it to a tidier import.
 *
 * This file used to import nothing at all, which was the rule as first
 * written. The rule it was really keeping is narrower and is what it now
 * states: **nothing here may import something `node --test` cannot load.**
 * `../plural.ts` qualifies - a relative specifier with its extension, to a
 * module that imports nothing itself - and it is here rather than inlined
 * because the email headline and the report's own h1 are deliberately the
 * same sentence with the same two numbers. Two copies of the agreement rule
 * is how they stop being the same sentence.
 *
 * Everything that decides *what* to send stays in verify-email.ts. This
 * decides only what the message looks like.
 */

import { count } from "../plural.ts";

/**
 * The colours the shell needs. verify-email.ts builds this from the design
 * tokens and documents the two deliberate departures from them; the shape is
 * here so the renderer does not have to know where the values came from.
 */
export type Palette = {
  ground: string;
  card: string;
  ink: string;
  body: string;
  quiet: string;
  line: string;
  accent: string;
  onAccent: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Every field is HTML, already escaped by the caller. The shell escapes
 * nothing: it was escaping the title and the preview line on top of a brand
 * the caller had escaped already, so an ampersand in a company name reached
 * the inbox as &amp;amp;.
 */
export type Shell = {
  /** Shown by a client rendering the message in a browser view. Not the subject. */
  title: string;
  /**
   * The inbox preview line, shown after the subject in every mail client
   * there is. With none set a client takes the first text it finds, which
   * here is the heading - so the reader saw the same sentence twice and
   * learned nothing from the second.
   */
  preheader: string;
  heading: string;
  /** Escaped HTML. */
  body: string;
  cta: { href: string; label: string };
  /** Escaped HTML, small print under the button. */
  footnote: string;
  /** Escaped HTML under a rule, or nothing. */
  aside?: string;
};

/**
 * The chrome both messages share: a 520px card on the page ground, a head
 * that declares its own encoding, an inbox preview line, and a button that
 * survives Outlook.
 *
 * Three things here are not decoration.
 *
 * There was no head element at all, and so no charset. The brand in the
 * heading is read off a crawled site and can hold any character there is;
 * Resend sets utf-8 on the part header, which is what has been carrying it,
 * but a document that declares its own encoding does not depend on that.
 *
 * max-width does nothing in Outlook desktop, which lays out with Word, so the
 * card ran the full width of the window there. The conditional comment gives
 * Outlook a fixed 520 and leaves every other client the fluid card.
 *
 * Outlook also drops padding on an anchor, which left the button as bare text
 * on a purple rectangle. mso-padding-alt on the cell puts it back.
 *
 * None of those three is verified in a mail client - there is no client in
 * here to verify them in. They are the documented behaviours and the standard
 * fixes for them. What is verified is the markup.
 */
export function shell(p: Palette, font: string, s: Shell): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${s.title}</title>
</head>
<body style="margin:0;padding:0;background:${p.ground};font-family:${font};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${p.ground};">${s.preheader}${"&#8203;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${p.ground};">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:${p.card};border-radius:12px;">
<tr><td style="padding:32px;">
<div style="font-size:18px;font-weight:600;line-height:1.35;color:${p.ink};padding-bottom:16px;">${s.heading}</div>
<div style="font-size:15px;line-height:1.55;color:${p.body};padding-bottom:24px;">${s.body}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${p.accent}" style="border-radius:8px;mso-padding-alt:12px 22px;">
<a href="${escapeHtml(s.cta.href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:${p.onAccent};text-decoration:none;">${s.cta.label}</a>
</td>
</tr></table>
<div style="font-size:13px;line-height:1.55;color:${p.quiet};padding-top:24px;">${s.footnote}</div>
${s.aside ? `<div style="font-size:13px;line-height:1.55;color:${p.quiet};margin-top:24px;padding-top:24px;border-top:1px solid ${p.line};">${s.aside}</div>` : ""}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body></html>`;
}

function linkFallback(p: Palette, link: string): string {
  return `If the button does nothing, paste this into your browser:<br><span style="color:${p.accent};word-break:break-all;">${escapeHtml(link)}</span>`;
}

export function verifyHtml(p: Palette, font: string, brand: string, link: string): string {
  const b = escapeHtml(brand);
  return shell(p, font, {
    title: `Open your ${b} report`,
    preheader: "Confirming your address opens the placements and the full transcripts.",
    heading: `One click and your ${b} report opens`,
    body:
      "We ran the check, and the result is already on your page. Confirming " +
      "this address opens the rest: which of those pages you could be placed " +
      "into, and what each engine said.",
    cta: { href: link, label: "Open the report" },
    footnote: linkFallback(p, link),
    aside: "If you did not ask for this, ignore it and nothing opens.",
  });
}

/**
 * The plain-text part of the verification message.
 *
 * Here rather than inline in verify-email.ts for the same reason the HTML is:
 * a template literal in a module `node --test` cannot load is a thing served
 * to somebody that nothing can render. Both text parts were exactly that until
 * now - shipped, typechecked, and never once produced.
 *
 * **The brand is not escaped, and must not be.** This is `text/plain`: a reader
 * whose client shows the text part would be sent `Ben &amp; Jerry&#39;s`. The
 * HTML part escapes because it is HTML and the text part does not because it is
 * not, and the two sitting one line apart in the same object is precisely how
 * somebody tidies them into agreement and breaks this one.
 */
export function verifyText(brand: string, link: string): string {
  return (
    `We ran the check on ${brand}.\n\n` +
    `Open the full report: ${link}\n\n` +
    "If you did not ask for this, ignore it and nothing opens."
  );
}

/**
 * What the report email is allowed to count, and over what.
 *
 * Five numbers rather than two, because the message was sending one pair and
 * describing it two different ways. The subject said "9 of 14 AI answers did
 * not name Vibe Retail" off a pair counted over *questions* - so on a
 * four-engine scan the true answer figures were 38 of 56, and the subject line
 * a buyer reads first disagreed with the h1 of the page it links to while
 * claiming to be the same measure.
 *
 * The two units are both worth sending and neither substitutes for the other:
 * an answer is one engine's reply to one question, and a question is missed
 * only when every engine that replied left the brand out.
 */
export type ReportCounts = {
  /** Answers (question x engine) that came back without the brand in them. */
  missedAnswers: number;
  /** Answers that came back at all. The denominator for missedAnswers. */
  totalAnswers: number;
  /** Questions some engine answered where none of them named the brand. */
  missedQuestions: number;
  /** Questions at least one engine answered. The denominator for missedQuestions. */
  answeredQuestions: number;
  /** Questions put to the engines, answered or not. */
  askedQuestions: number;
};

/**
 * The headline is the sharpest number this product produces, so it is built
 * once and used by both the HTML and the plain-text part. The text part used
 * to drop it, which meant a client showing text only got the blandest
 * version of the one thing worth saying.
 *
 * The denominator is the questions an engine answered, not the questions we
 * asked. The numerator never counted a question nobody answered - it cannot,
 * because a question with no reply is neither named nor missing - so counting
 * the denominator over everything asked made the two halves of one sentence
 * different measures. A scan where four of fourteen went unanswered read "9 of
 * the 14" for a figure whose real denominator was ten. That is the same defect
 * already fixed on the metric tile the reader lands on; the email kept the old
 * shape and is the copy a buyer sees first.
 */
export function reportHeadline(brand: string, c: ReportCounts, cluster?: ReportCluster | null): string {
  // The nouns stay literal for plural-nouns.test.mts, which reads them.
  const answered = cluster ? count(c.answeredQuestions, "prompt") : count(c.answeredQuestions, "question");
  const asked = cluster ? count(c.askedQuestions, "buying-intent prompt") : count(c.askedQuestions, "buying-intent question");
  return c.missedQuestions > 0
    ? `${c.missedQuestions} of the ${answered} an engine answered came back without ${brand} in the answer.`
    : `We put ${asked} to the engines your buyers use.`;
}

/**
 * The scan's cluster keyword, on a scan from C1 on (R114 S1, 30 Sep 2026):
 * the report it links to draws the prompts as the visitor's first cluster, so
 * the message says prompts and names the keyword the way the page does. Null
 * or absent is a scan from before C1, which keeps its questions. `keyword` is
 * null when none was picked - the page's "Not picked yet"; the message then
 * names no keyword rather than a guessed one.
 */
export type ReportCluster = { keyword: string | null };

/** The sentence after the headline, both parts. Unescaped; the HTML part escapes it. */
export function reportAfter(cluster?: ReportCluster | null): string {
  if (!cluster) return "The report adds the pages you could be placed into, ranked by how many answers a placement would win, and what each engine said.";
  return (
    (cluster.keyword
      ? `The report shows them as your first cluster, joined to “${cluster.keyword}” and where you rank for it on Google, `
      : "The report shows them as your first cluster, ") +
    "then the pages you could be placed into, ranked by how many answers a placement would win, and what each engine said."
  );
}

/**
 * Why this message arrived, for the send that nobody confirmed an address for.
 *
 * Danny's third condition on item 5, 20 September 2026 19:45: "the mail says
 * why it arrived, in its first line: somebody asked for this report on this
 * domain from alwayscited. The stranger case is the one this sentence is for,
 * and it is the difference between an unexpected mail and an unexplained one."
 *
 * It takes the **domain** rather than the brand, and the two are not
 * interchangeable here. Everything else in this message is addressed to the
 * person who asked, so it uses the brand name the crawl found, which is the
 * friendlier of the two. This sentence is addressed to somebody who did not
 * ask, and the only thing that lets them work out what happened is the address
 * that was typed into the form - which is the domain.
 *
 * The **requested** send is the only one that carries it. The unlock's report
 * mail goes to an address that was confirmed by clicking a link in an earlier
 * message, so it has a different answer to the same question and does not need
 * this one. That is why it is a parameter rather than a line in the body.
 */
export function requestedReason(domain: string): string {
  return `Somebody asked alwayscited to email this report on ${domain}.`;
}

/**
 * The subject line, which is the only part of this message most people read.
 *
 * Counted over answers so that it is the same sentence, with the same two
 * numbers, as the h1 of the report it opens.
 */
export function reportSubject(brand: string, c: ReportCounts): string {
  return c.missedAnswers > 0
    ? `${c.missedAnswers} of ${c.totalAnswers} AI answers did not name ${brand}`
    : `Your ${brand} report`;
}

/**
 * The plain-text part of the report message.
 *
 * Leads with the same headline the HTML body does, unescaped - see verifyText.
 * The headline is shared rather than reworded because a client showing text
 * only used to get the blandest version of the one thing worth saying.
 *
 * `requestedFor` is the domain, and it puts `requestedReason` in front of the
 * headline. Both parts carry it or neither does: a reader whose client shows
 * the text part is exactly as likely to be the stranger the sentence is for.
 * **The domain is not escaped here and must not be** - this is text/plain, the
 * same reason `verifyText` gives for the brand.
 */
export function reportText(
  brand: string,
  link: string,
  counts: ReportCounts,
  requestedFor?: string,
  cluster?: ReportCluster | null,
  unsubscribe?: string,
): string {
  return (
    (requestedFor ? `${requestedReason(requestedFor)}\n\n` : "") +
    `${reportHeadline(brand, counts, cluster)}\n\n` +
    (cluster ? `${reportAfter(cluster)}\n\n` : "") +
    `Open your report: ${link}\n\n` +
    "The link works on any device and does not expire." +
    (unsubscribe ? `\n\n${UNSUBSCRIBE_LINE} ${unsubscribe}` : "")
  );
}

/**
 * Every report email carries a way out of follow-ups (Danny, 3 Nov 2026): the link to /unsubscribe/<token>
 * (lib/scan/unsubscribe.ts), and the List-Unsubscribe headers verify-email.ts sets on the send.
 */
export const UNSUBSCRIBE_LINE = "We may follow up about this report. To stop follow-ups and tips, unsubscribe:";

export function reportHtml(
  p: Palette,
  font: string,
  brand: string,
  link: string,
  counts: ReportCounts,
  requestedFor?: string,
  cluster?: ReportCluster | null,
  unsubscribe?: string,
): string {
  const b = escapeHtml(brand);
  return shell(p, font, {
    title: `Your ${b} report is ready`,
    /**
     * Not the headline, which is what this was until the message was first
     * rendered on 19 Sep 2026.
     *
     * The subject on this send is already the number - "38 of 56 AI answers did
     * not name Vibe Retail" - and the preview line sat beside it in the inbox
     * restating it. Two lines, one fact, and the second bought nothing.
     *
     * That is the same failure the preheader was added to fix, one level up:
     * it was fixed against the heading and reintroduced against the subject.
     * The preview line's only job is to say what the subject does not, so it
     * says what opening the report gets you, the way the verification message
     * does. The body still leads with the number.
     */
    preheader: "The pages you could be placed into, ranked, and what each engine said.",
    heading: `Your ${b} report is ready`,
    /**
     * `requestedReason` first and on its own line when this is the requested
     * send, and it is deliberately NOT also the preview line.
     *
     * The preheader's recorded job is to say what the subject does not, and
     * this file already carries the cost of getting that wrong twice - once
     * against the heading, once against the subject. Putting the reason there
     * as well would be the third instance of the same mistake, and it would
     * push out the one line the preview has that the subject does not.
     */
    body:
      (requestedFor ? `${escapeHtml(requestedReason(requestedFor))}<br><br>` : "") +
      reportHeadline(b, counts, cluster) +
      " " +
      escapeHtml(reportAfter(cluster)),
    cta: { href: link, label: "Open your report" },
    footnote:
      "The link works on any device and does not expire. " +
      linkFallback(p, link) +
      (unsubscribe
        ? `<br><br>We may follow up about this report. <a href="${escapeHtml(unsubscribe)}" style="color:${p.quiet};text-decoration:underline;">Unsubscribe</a> from follow-ups and tips.`
        : ""),
  });
}
