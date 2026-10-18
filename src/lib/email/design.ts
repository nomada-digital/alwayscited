import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import { T } from "../../config/tokens.ts";
import { escapeHtml } from "../scan/email-render.ts";

/**
 * The customer emails' building blocks (brief item 2e, 18 Oct 2026), ported
 * from the approved designs in alwayscited-emails/*.html: 600px, tables and
 * inline styles only, mobile-fluid. Each block renders its HTML and its plain
 * text together, so the two versions of an email cannot say different things.
 *
 * Colours are the tokens (config/tokens.ts), never a typed hex: the designs'
 * green and red pills are T.goodFg/goodBg and T.badFg/badBg, their neutral pill
 * T.chip. Plain module, relative imports, no I/O: node --test renders it.
 *
 * The mark is a hosted 48x48 PNG (Gmail and Outlook block SVG). The file is
 * public/email/mark-48.png, added on its own branch; the address is absolute
 * because a mail client has no base URL.
 */

export const MARK_URL = "https://alwayscited.com/email/mark-48.png";

const F = "'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** One block of an email: its HTML and the same thing as plain text (empty text adds nothing to the plain version). */
export type Block = { html: string; text: string };

/** A block, or a falsy value where a block with no data behind it is left out. */
export type MaybeBlock = Block | null | false | undefined | "" | 0;

const e = escapeHtml;

/** A sentence with bold runs: `**x**` is bold in the HTML and plain in the text. Everything else is escaped. */
function rich(s: string): string {
  return e(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

/**
 * The small label over the headline. The designs set it in capitals, but the
 * brand and the tier names never take one (AGENTS.md), so a label naming
 * either is drawn as written; the plain text is always as written.
 */
export function eyebrow(s: string): Block {
  const caps = /always/i.test(s) ? "" : "text-transform:uppercase;";
  return { html: `<p style="margin:0 0 10px;font-family:${F};font-size:12px;letter-spacing:0.06em;${caps}color:${T.soft};font-weight:600">${e(s)}</p>`, text: s };
}

export function h1(s: string): Block {
  return { html: `<h1 style="margin:0 0 14px;font-family:${F};font-size:26px;line-height:1.2;letter-spacing:-0.03em;color:${T.ink};font-weight:700">${e(s)}</h1>`, text: s };
}

export function h2(s: string): Block {
  return { html: `<h2 style="margin:26px 0 10px;font-family:${F};font-size:16px;line-height:1.3;letter-spacing:-0.02em;color:${T.ink};font-weight:700">${e(s)}</h2>`, text: s };
}

/** A body paragraph. `**bold**` runs are allowed. */
export function para(s: string): Block {
  return { html: `<p style="margin:0px 0 14px;font-family:${F};font-size:15px;line-height:1.6;color:${T.ink};font-weight:400">${rich(s)}</p>`, text: plain(s) };
}

/** A quiet note under a block (13px, soft). */
export function note(s: string, link?: { label: string; href: string; after?: string }): Block {
  const tail = link ? ` <a href="${e(link.href)}" style="color:${T.ink};font-weight:600">${e(link.label)}</a>${e(link.after ?? "")}` : "";
  const tailText = link ? ` ${link.label} (${link.href})${link.after ?? ""}` : "";
  return { html: `<p style="margin:14px 0 0px;font-family:${F};font-size:13px;line-height:1.6;color:${T.soft};font-weight:400">${rich(s)}${tail}</p>`, text: `${plain(s)}${tailText}` };
}

/** The 12px line under the stat tiles. */
export function fine(s: string): Block {
  return { html: `<p style="margin:6px 0 0px;font-family:${F};font-size:12px;line-height:1.6;color:${T.soft};font-weight:400">${e(s)}</p>`, text: s };
}

/** A cluster's keyword, its other form, and the target page under it. */
export function keywordHead(k: { keyword: string; pair?: string | null; target?: string | null }): Block {
  const pair = k.pair ? ` <span style="color:${T.soft};font-weight:500">+ ${e(k.pair)}</span>` : "";
  const target = k.target ? `<div style="font-family:${MONO};font-size:12px;color:${T.soft}">&rarr; ${e(k.target)}</div>` : "";
  return {
    html: `<div style="margin:22px 0 4px;font-family:${F};font-size:16px;font-weight:700;color:${T.ink};letter-spacing:-0.02em">${e(k.keyword)}${pair}</div>${target}`,
    text: [`${k.keyword}${k.pair ? ` + ${k.pair}` : ""}`, ...(k.target ? [`-> ${k.target}`] : [])].join("\n"),
  };
}

export type Tone = "good" | "bad" | "quiet";
const toneFg = (t: Tone) => (t === "good" ? T.goodFg : t === "bad" ? T.badFg : T.soft);

/** Up to three stat tiles side by side. Never fewer than one: callers hide the block when they have nothing. */
export function stats(tiles: readonly { value: string; label: string; note?: { text: string; tone: Tone } | null }[]): Block {
  const cells = tiles.map(
    (t) =>
      `<td width="33%" valign="top" style="padding:14px 14px 12px;border:1px solid ${T.line};border-radius:12px;background:${T.surface}"><div style="font-family:${F};font-size:24px;font-weight:700;letter-spacing:-0.03em;color:${T.ink};line-height:1.1">${e(t.value)}</div><div style="font-family:${F};font-size:12px;line-height:1.4;color:${T.soft};margin-top:4px">${e(t.label)}</div>${
        t.note ? `<div style="font-family:${F};font-size:12px;font-weight:600;color:${toneFg(t.note.tone)};margin-top:6px">${e(t.note.text)}</div>` : ""
      }</td>`,
  );
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 6px;border-collapse:separate"><tr>${cells.join(`<td width="8" style="font-size:0">&nbsp;</td>`)}</tr></table>`,
    text: tiles.map((t) => `${t.value} ${t.label}${t.note ? ` (${t.note.text})` : ""}`).join("\n"),
  };
}

export function pill(s: string, tone: Tone): string {
  const [bg, fg] = tone === "good" ? [T.goodBg, T.goodFg] : tone === "bad" ? [T.badBg, T.badFg] : [T.chip, T.soft];
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:${fg};font-family:${F};font-size:12px;font-weight:600;white-space:nowrap">${e(s)}</span>`;
}

export type Row = { left: string; sub?: string | null; italic?: boolean; right: string; tone?: Tone | null };

/** A two-column table: a header row, then rows whose right cell is plain or a pill. */
export function table(head: readonly [string, string], rows: readonly Row[]): Block {
  const th = (s: string, align: string) => `<td style="padding:9px 12px;font-family:${F};font-size:12px;color:${T.soft};font-weight:600;border-bottom:1px solid ${T.line};text-align:${align}">${e(s)}</td>`;
  const td = (inner: string, align: string) => `<td style="padding:10px 12px;font-family:${F};font-size:14px;color:${T.ink};border-bottom:1px solid ${T.line};text-align:${align}">${inner}</td>`;
  const body = rows.map((r) => {
    const left = (r.italic ? `<i>${e(r.left)}</i>` : e(r.left)) + (r.sub ? `<br><span style="font-size:12px;color:${T.soft}">${e(r.sub)}</span>` : "");
    return `<tr>${td(left, "left")}${td(r.tone ? pill(r.right, r.tone) : e(r.right), "right")}</tr>`;
  });
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 6px;border:1px solid ${T.line};border-radius:12px;border-collapse:separate;background:${T.surface}"><tr>${th(head[0], "left")}${th(head[1], "right")}</tr>${body.join("")}</table>`,
    text: [
      `${head[0]}${head[1] ? ` / ${head[1]}` : ""}`,
      ...rows.map((r) => `- ${r.left}${r.right ? (r.tone ? ` [${r.right}]` : ` - ${r.right}`) : ""}${r.sub ? `\n  ${r.sub}` : ""}`),
    ].join("\n"),
  };
}

/** Numbered steps, each a title and a line under it. */
export function steps(list: readonly { title: string; body: string }[]): Block {
  const rows = list.map(
    (s, i) =>
      `<tr><td valign="top" width="34" style="padding:0 0 14px"><div style="width:24px;height:24px;border-radius:999px;background:${T.accent};color:${T.surface};font-family:${F};font-size:12px;font-weight:700;line-height:24px;text-align:center">${i + 1}</div></td><td valign="top" style="padding:0 0 14px"><div style="font-family:${F};font-size:15px;font-weight:600;color:${T.ink}">${e(s.title)}</div><div style="font-family:${F};font-size:14px;line-height:1.55;color:${T.soft}">${e(s.body)}</div></td></tr>`,
  );
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px">${rows.join("")}</table>`,
    text: list.map((s, i) => `${i + 1}. ${s.title}\n   ${s.body}`).join("\n"),
  };
}

/** The shaded box: a bold first line and a soft line under it. */
export function callout(title: string, body: string): Block {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr><td style="background:${T.chip};border-radius:12px;padding:16px 18px"><p style="margin:0px 0 4px;font-family:${F};font-size:14px;line-height:1.6;color:${T.ink};font-weight:400"><b>${e(title)}</b></p><p style="margin:0px 0 0px;font-family:${F};font-size:14px;line-height:1.6;color:${T.soft};font-weight:400">${e(body)}</p></td></tr></table>`,
    text: `${title}\n${body}`,
  };
}

/** The email's one button. `bgcolor` as well as the style, for Outlook; lifecycle.test.mts counts exactly one per email. */
export function button(href: string, label: string): Block {
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td bgcolor="${T.accent}" style="background:${T.accent};border-radius:10px"><a href="${e(href)}" style="display:inline-block;padding:13px 22px;font-family:${F};font-size:15px;font-weight:600;color:${T.surface};text-decoration:none">${e(label)} &rarr;</a></td></tr></table>`,
    text: `${label}: ${href}`,
  };
}

/** A plain underlined link on its own line (trial_ending's "Cancel the trial"). */
export function textLink(href: string, label: string): Block {
  return {
    html: `<p style="margin:4px 0 0px;font-family:${F};font-size:14px;line-height:1.6;color:${T.ink};font-weight:400"><a href="${e(href)}" style="font-family:${F};font-size:14px;color:${T.ink};text-decoration:underline;font-weight:600">${e(label)}</a></p>`,
    text: `${label}: ${href}`,
  };
}

/** Danny's sign-off on #3 and #12, which come from "Danny at alwayscited". */
export function signature(): Block {
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0"><tr><td valign="middle" style="padding-right:12px"><div style="width:40px;height:40px;border-radius:999px;background:${T.ink};color:${T.surface};font-family:${F};font-size:15px;font-weight:700;line-height:40px;text-align:center">DS</div></td><td valign="middle"><div style="font-family:${F};font-size:14px;font-weight:600;color:${T.ink}">Danny Sullivan</div><div style="font-family:${F};font-size:13px;color:${T.soft}">Founder. Reply to this email and it comes to me.</div></td></tr></table>`,
    text: "Danny Sullivan\nFounder. Reply to this email and it comes to me.",
  };
}

/** The line every non-client-facing email's footer carries; never on a client-facing one (the agency's client). */
export const NOMADA_LINE = `Built and run by the senior team at nomada digital. ${COMPANY_LINE}.`;

export type Footer = {
  /** "You're getting this because ..." */
  reason: string;
  /** Email settings, or null for #1 login link and #11 payment failed, which have none. */
  settings: string | null;
  /** #7's one-click unsubscribe link, when the sender could sign one for this recipient. */
  unsubscribe?: string | null;
  help: string;
};

export type Page = {
  title: string;
  preheader: string;
  blocks: readonly MaybeBlock[];
  footer: Footer;
  /**
   * A client-facing email (#8, and any email to a non-owner member an agency invited): the agency's name under
   * the wordmark (when there is one), and no nomada digital line in the footer.
   */
  clientFacing?: { agency: string | null } | null;
};

/** The whole message: wordmark, the white card of blocks, the footer. Blocks that are null are left out. */
export function page(p: Page): { html: string; text: string } {
  const blocks = p.blocks.filter((b): b is Block => !!b);
  const agency = p.clientFacing?.agency?.trim() || null;
  const wordmark =
    `<tr><td style="padding:0 6px 16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding-right:7px"><img src="${MARK_URL}" width="20" height="20" alt="" style="display:block;border:0"></td><td valign="middle"><span style="font-family:${F};font-size:17px;font-weight:700;letter-spacing:-0.03em;color:${T.ink}">alwayscited</span></td></tr></table>` +
    (agency ? `<div style="font-family:${F};font-size:12px;color:${T.soft};margin-top:2px">for ${e(agency)}</div>` : "") +
    `</td></tr>`;
  const f = p.footer;
  const links = [
    ...(f.settings ? [`<a href="${e(f.settings)}" style="color:${T.soft}">Email settings</a>`] : []),
    ...(f.unsubscribe ? [`<a href="${e(f.unsubscribe)}" style="color:${T.soft}">Unsubscribe</a>`] : []),
    `<a href="${e(f.help)}" style="color:${T.soft}">Help</a>`,
    e(CONTACT_EMAIL),
  ];
  const nomada = !p.clientFacing;
  const footer =
    `<tr><td style="padding:18px 8px 0;font-family:${F};font-size:12px;line-height:1.6;color:${T.soft}">\n${e(f.reason)}<br>\n` +
    (nomada ? `${e(NOMADA_LINE)}<br>` : "") +
    `${links.join(" &middot; ")}\n</td></tr>`;
  const html =
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${e(p.title)}</title></head>\n` +
    `<body style="margin:0;padding:0;background:${T.bg}">\n` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${T.bg}">${e(p.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.bg}"><tr><td align="center" style="padding:28px 12px">\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">\n` +
    wordmark +
    `\n<tr><td style="background:${T.surface};border:1px solid ${T.line};border-radius:18px;padding:34px 34px 30px">\n${blocks.map((b) => b.html).join("")}\n</td></tr>\n` +
    footer +
    `\n</table></td></tr></table></body></html>`;
  const text = [
    "alwayscited" + (agency ? ` for ${agency}` : ""),
    "",
    ...blocks.flatMap((b) => (b.text ? [b.text, ""] : [])),
    "--",
    f.reason,
    ...(nomada ? [NOMADA_LINE] : []),
    ...(f.settings ? [`Email settings: ${f.settings}`] : []),
    ...(f.unsubscribe ? [`Unsubscribe: ${f.unsubscribe}`] : []),
    `Help: ${f.help}`,
    CONTACT_EMAIL,
  ].join("\n");
  return { html, text };
}
