import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aliasAskMail, billingAskMail, askGate, askItemWord, askMail, askRecipient, readAskAbout, readAskItems, readAskKeyword, readUpgradeCta, recordAsk, upgradeAskMail, upsellMode } from "@/lib/tracking/ask";
import { sendAsk } from "@/lib/tracking/ask-mail";
import { trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";
import { readKept } from "@/lib/tracking/stop";
import { readSurface, upgradeTrigger } from "@/lib/tracking/upgrade-prompts";
import { readAiKept } from "@/lib/diy/ai/prompt-table";
import { recordUsage } from "@/lib/tracking/usage-record";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A member's ask - BRIEF-2 T11 /ask (30 Sep 2026). Posted by a plain HTML
 * form: either Add a cluster's "Ask us to pick one" with the refused keyword,
 * or an upgrade prompt's "Ask about these N" with its `cta` and the `items` ids
 * that triggered it, resolved here against this client's own rows. Rules,
 * mail text and the cap are ask.ts; the send is ask-mail.ts. Session and
 * membership as the note route; the fixture sends nothing. Returns to the
 * Clusters page with `ask=sent|refused` and, on a send, the toast's recipient
 * word and the count sent with it. The page's range, filter and search ride
 * in the action's query and come back too, the toast's keys winning (DS16,
 * 2 Oct 2026); Settings' return is unchanged. The recipient word is `via`, not
 * `to`, which is the range's end and was overwritten by it (DS29, 2 Oct 2026).
 *
 * 13 Oct 2026, DIY P4 (review of P4; spec 10 sections 2.7 and 3.6): an
 * upgrade prompt's ask carries its `surface` in the action's query. `ai`
 * returns to AI visibility with its own view (prompt-table.ts readAiKept);
 * anything else to Clusters, as before. The surface goes into the row's
 * `trigger` beside the item count.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const form = await req.formData().catch(() => null);
  // Settings' "Ask us to change these" returns to Settings; every other ask to Clusters.
  const about = readAskAbout(form?.get("about"));
  const cta = about ? null : readUpgradeCta(form?.get("cta"));
  const sp = new URL(req.url).searchParams;
  const surface = cta ? (readSurface(sp.get("surface")) ?? "clusters") : null;
  const onAi = surface === "ai";
  const kept = onAi ? readAiKept((k) => sp.get(k), APP_LIMITS.search) : readKept((k) => sp.get(k), APP_LIMITS.search);
  // DS41 (2 Oct 2026, R173 pass 4): Settings' asks post its stated range; only from, to and compare go back there.
  const view = about ? Object.fromEntries(Object.entries(kept).filter(([k]) => k === "from" || k === "to" || k === "compare")) : kept;
  const done = (r: "sent" | "refused" | "capped", extra: Record<string, string> = {}) =>
    NextResponse.redirect(
      dashUrl(
        req,
        about
          ? appPath(`/${slug}/settings?${new URLSearchParams({ ...view, ask: r, ...extra })}`)
          : onAi
            ? appPath(`/${slug}/ai?${new URLSearchParams({ ...view, ask: r, ...extra })}`)
            : appPath(`/${slug}/clusters?${new URLSearchParams({ ...view, ...(cta === "mentioned" ? { filter: "never" } : {}), ask: r, ...extra })}`),
      ),
      303,
    );
  if (fixtureMode()) return done("refused");

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const keyword = cta || about ? null : readAskKeyword(form?.get("keyword"));
  const ids = cta ? readAskItems(String(form?.get("items") ?? "").split(",")) : [];
  if (!about && !keyword && !ids.length) return done("refused");

  const db = supabaseAdmin();
  // The account is read here, server-side only; clientsFor keeps account_id out of what pages get.
  const { data: row, error: rowErr } = await db.from("client_domains").select("account_id, brand_aliases").eq("id", client.id).maybeSingle();
  if (rowErr || !row) {
    console.warn(`[app] ask could not read the client's account: ${rowErr?.message ?? "none"}`);
    return done("refused");
  }
  const { data: account, error } = await db.from("accounts").select("upsell_mode, upsell_contact_email").eq("id", row.account_id as string).maybeSingle();
  if (error || !account) {
    console.warn(`[app] ask could not read the account: ${error?.message ?? "none"}`);
    return done("refused");
  }
  const mode = upsellMode(account.upsell_mode);
  const recipient = askRecipient(mode, (account.upsell_contact_email as string | null) ?? null);
  if (!recipient) return done("refused");
  const today = trackingDay();
  const gate = await askGate(db, { clientId: client.id, email, today });
  if (!gate.ok) {
    console.warn(`[app] ask refused: ${gate.reason}`);
    // R151 (3 Oct 2026): the day's cap says so (ask.ts ASK_REFUSED); a failed read keeps "Try again later".
    return done(gate.reason === "capped" ? "capped" : "refused");
  }

  const brand = client.brand ?? client.domain;
  if (about) {
    // The names as Settings draws them, read here: the brand, then each alias once.
    const names = [...new Set([brand, ...((row.brand_aliases as string[] | null) ?? []).filter(Boolean)])];
    const mail = about === "aliases" ? aliasAskMail({ brand, domain: client.domain, member: email, names, mode }) : billingAskMail({ brand, domain: client.domain, member: email, mode });
    if (!(await sendAsk({ agencyContact: recipient.to, replyTo: email, ...mail }))) return done("refused");
    if (!(await recordAsk(db, { clientId: client.id, email, cta: "cluster", trigger: { about } }))) console.warn("[app] ask sent but not recorded");
    return done("sent", { via: recipient.to ? "agency" : "us" });
  }
  let items: string[] = [];
  if (cta) {
    // Only this client's rows: an id from another client, or a made-up one, lists nothing.
    const read =
      cta === "mentioned"
        ? await db.from("tracked_questions").select("text").eq("client_domain_id", client.id).in("id", ids)
        : await db.from("tracked_keywords").select("keyword").eq("client_domain_id", client.id).in("id", ids);
    if (read.error) {
      console.warn(`[app] ask could not read its items: ${read.error.message}`);
      return done("refused");
    }
    items = ((read.data ?? []) as { text?: string; keyword?: string }[]).map((r) => r.text ?? r.keyword ?? "").filter(Boolean);
    if (!items.length) return done("refused");
  }
  const mail = cta ? upgradeAskMail({ brand, domain: client.domain, member: email, cta, items, mode }) : askMail({ brand, domain: client.domain, member: email, keyword: keyword as string, mode });
  if (!(await sendAsk({ agencyContact: recipient.to, replyTo: email, ...mail }))) return done("refused");
  const recorded = cta
    ? await recordAsk(db, { clientId: client.id, email, cta, trigger: upgradeTrigger(surface ?? "clusters", { items: String(items.length) }) })
    : await recordAsk(db, { clientId: client.id, email, cta: "cluster", trigger: { keyword: keyword as string } });
  if (!recorded) console.warn("[app] ask sent but not recorded");
  if (cta) await recordUsage(db, { clientId: client.id, email, event: "cta_ask", path: null, props: { cta }, today });
  // The toast's words are rebuilt on the page (askToast) from these words, never passed as text.
  return done("sent", { via: recipient.to ? "agency" : "us", ...(cta ? { n: String(items.length), of: askItemWord(cta, 2) } : {}) });
}
