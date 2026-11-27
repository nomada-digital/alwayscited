/**
 * The batched dashboard email (27 Nov 2026, Danny): "We've added N tasks to your dashboard", the fortnightly connection reminder, or the
 * two in one. Short, from hello@alwayscited.com, signed by the account lead. Pure builder; who gets it, and whether it is sent or left
 * as a draft, is notify.ts. A reminder lists only what is missing, each with a one-click button to its connect card.
 */
export type TaskEmail = { subject: string; html: string; text: string; fromName: string };
export type Missing = "gsc" | "ga4" | "bing";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const CONNECT_COPY: Record<Missing, { name: string; benefit: string }> = {
  gsc: { name: "Search Console", benefit: "so we can see exactly which searches and pages bring you visitors" },
  ga4: { name: "Google Analytics", benefit: "so we can see what visitors do once they arrive" },
  bing: { name: "Bing Webmaster Tools", benefit: "so we can see how you show up in Bing and Copilot" },
};
const ORDER: Missing[] = ["gsc", "ga4", "bing"];

const BTN = "display:inline-block;background:#6d3df5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px";

export function taskEmail(p: { n: number; slug: string; firstName: string | null; lead: string | null; missing?: Missing[] }): TaskEmail {
  const lead = p.lead?.trim() || "the alwayscited team";
  const base = `https://dashboards.alwayscited.com/${p.slug}`;
  const missing = ORDER.filter((m) => p.missing?.includes(m));
  const hi = p.firstName ? `Hi ${p.firstName}` : "Hi there";
  const what = p.n === 1 ? "a task" : `${p.n} tasks`;
  const parts: { text: string; html: string }[] = [];

  if (p.n > 0) {
    const line = p.n === 1 ? "It has plain steps, and it ticks itself off once we can see the change." : "Each one has plain steps, and most tick themselves off once we can see the change.";
    parts.push({
      text: `We've added ${what} to your dashboard. ${line}\n\nOpen your tasks: ${base}/tasks`,
      html: `<p>We've added ${esc(what)} to your dashboard. ${esc(line)}</p><p><a href="${base}/tasks" style="${BTN}">Open your tasks</a></p>`,
    });
  }
  if (missing.length) {
    const intro = p.n > 0 ? "One more thing. Help us get more from your data:" : "Help us get more from your data. Connect these in your dashboard so we can make sharper optimisations:";
    const items = missing.map((m) => ({ ...CONNECT_COPY[m], url: `${base}/integrations#connect-${m}` }));
    parts.push({
      text: `${intro}\n\n${items.map((i) => `- Connect ${i.name} ${i.benefit}: ${i.url}`).join("\n")}\n\nEach takes about a minute. Reply if you'd like a hand.`,
      html:
        `<p>${esc(intro)}</p>` +
        items.map((i) => `<p style="margin:0 0 12px">Connect ${esc(i.name)} ${esc(i.benefit)}.<br><a href="${i.url}" style="${BTN};margin-top:6px">Connect ${esc(i.name)}</a></p>`).join("") +
        `<p>Each takes about a minute. Reply if you'd like a hand.</p>`,
    });
  }
  const subject = p.n > 0 ? `We've added ${what} to your dashboard` : missing.length === 1 ? `Help us get more from your data: connect ${CONNECT_COPY[missing[0]!].name}` : "Help us get more from your data";
  const text = `${hi},\n\n${parts.map((x) => x.text).join("\n\n")}\n\nCheers\n${lead}`;
  const html = `<p>${esc(hi)},</p>${parts.map((x) => x.html).join("")}<p>Cheers<br>${esc(lead)}</p>`;
  return { subject, html, text, fromName: p.lead ? `${p.lead.trim()} @ alwayscited` : "alwayscited" };
}
