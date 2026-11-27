/**
 * The batched "We've added N tasks to your dashboard" email (27 Nov 2026, Danny). Short, from hello@alwayscited.com, signed by the
 * account lead. Pure builder; who gets it, and whether it is sent or left as a draft, is notify.ts.
 */
export type TaskEmail = { subject: string; html: string; text: string; fromName: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function taskEmail(p: { n: number; slug: string; firstName: string | null; lead: string | null }): TaskEmail {
  const lead = p.lead?.trim() || "the alwayscited team";
  const link = `https://dashboards.alwayscited.com/${p.slug}/tasks`;
  const what = p.n === 1 ? "a task" : `${p.n} tasks`;
  const subject = `We've added ${what} to your dashboard`;
  const hi = p.firstName ? `Hi ${p.firstName}` : "Hi there";
  const line = p.n === 1 ? "It has plain steps, and it ticks itself off once we can see the change." : "Each one has plain steps, and most tick themselves off once we can see the change.";
  const text = `${hi},\n\nWe've added ${what} to your dashboard. ${line}\n\nOpen your tasks: ${link}\n\nCheers\n${lead}`;
  const html =
    `<p>${esc(hi)},</p><p>We've added ${esc(what)} to your dashboard. ${esc(line)}</p>` +
    `<p><a href="${link}" style="display:inline-block;background:#6d3df5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Open your tasks</a></p>` +
    `<p>Cheers<br>${esc(lead)}</p>`;
  return { subject, html, text, fromName: p.lead ? `${p.lead.trim()} @ alwayscited` : "alwayscited" };
}
