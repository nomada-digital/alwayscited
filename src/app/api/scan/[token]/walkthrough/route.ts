import { NextResponse } from "next/server";

import { SCAN_LIMITS } from "@/config/contact";
import { isPlausibleEmail, normalizeEmail } from "@/lib/email-address";
import { clientIp, hashIp } from "@/lib/scan/ip";
import { markClaimed } from "@/lib/scan/unlock";
import { readWalkthroughCategory, readWalkthroughMarket, readWalkthroughName } from "@/lib/scan/walkthrough-fields";
import { sendWalkthroughAlert } from "@/lib/scan/walkthrough-mail";
import { refusedOutcome, walkthroughBack } from "@/lib/scan/walkthrough-outcome";
import { writeAsk } from "@/lib/scan/walkthrough-store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isWorkEmail, WORK_EMAIL_REFUSAL } from "@/lib/work-email";
import { workEmailBlockedExtra } from "@/lib/work-email-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Requests one caller may make in a rolling day. Each one emails Danny. */
const PER_IP_PER_DAY = 5;

/**
 * A request for a walkthrough of alwaystracked - a Loom video or a demo call.
 *
 * The result page's only call to action since 24 September 2026, when the
 * email gate came off. What it does: stores the request, stamps the scan as
 * claimed (transcripts are kept indefinitely since 24 September, so the stamp
 * now marks a scan somebody asked about rather than saving its answers from a
 * purge), and emails Danny. It sends nothing to the
 * visitor - Danny replies himself, which is the point of asking for him.
 *
 * 13 Oct 2026 (Danny): name, category and market are required, read in the
 * form's order - name, email, category, market - so the one refusal a form
 * post without script comes back with is the first field that is wrong.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  // R151 (3 Oct 2026): the form posts here without script too, and is answered
  // with a 303 back to its page carrying only the outcome, never the address.
  const isForm = !(req.headers.get("content-type") ?? "").includes("application/json");
  let body: { email?: string; kind?: string; back?: unknown; name?: unknown; category?: unknown; market?: unknown };
  if (isForm) {
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "bad_request" }, { status: 400 });
    body = {
      email: String(form.get("email") ?? ""),
      kind: String(form.get("kind") ?? ""),
      back: form.get("back") ?? undefined,
      name: String(form.get("name") ?? ""),
      category: String(form.get("category") ?? ""),
      market: String(form.get("market") ?? ""),
    };
  } else {
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
  }
  const answer = (json: { ok?: true; error?: string; message?: string }, status = 200) => {
    if (!isForm) return Response.json(json, { status });
    const outcome = json.ok || status === 429 ? (body.kind === "demo" ? "demo" : "video") : refusedOutcome(json.error);
    return NextResponse.redirect(new URL(`${walkthroughBack(body.back, token)}?walkthrough=${outcome}#walkthrough`, req.url), 303);
  };

  const kind = body.kind === "demo" ? "demo" : body.kind === "video" ? "video" : null;
  if (!kind) return answer({ error: "bad_kind", message: "Pick a video or a demo." }, 400);

  const name = readWalkthroughName(body.name);
  if (!name.ok) return answer({ error: name.error, message: name.message }, 400);

  const email = normalizeEmail(body.email ?? "");
  if (email.length > SCAN_LIMITS.email || !isPlausibleEmail(email)) {
    return answer({ error: "bad_email", message: "That email does not look right." }, 400);
  }
  if (!isWorkEmail(email, await workEmailBlockedExtra())) {
    return answer({ error: "personal_email", message: WORK_EMAIL_REFUSAL }, 400);
  }

  const category = readWalkthroughCategory(body.category);
  if (!category.ok) return answer({ error: category.error, message: category.message }, 400);
  const market = readWalkthroughMarket(body.market);
  if (!market.ok) return answer({ error: market.error, message: market.message }, 400);
  const ask = { name: name.value, category: category.value, market: market.value };

  const db = supabaseAdmin();
  const { data: scan, error: readErr } = await db
    .from("scans")
    .select("id, domain, brand_name, topic, unlocked_at")
    .eq("public_token", token)
    .maybeSingle();
  if (readErr) {
    console.warn("[walkthrough] could not read the scan: " + readErr.message);
    return answer({ error: "read_failed", message: "We could not reach the checker. Please try again." }, 502);
  }
  if (!scan) return answer({ error: "not_found" }, 404);

  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countErr } = await db
    .from("walkthrough_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (countErr) {
    console.warn("[walkthrough] could not count recent requests: " + countErr.message);
    return answer({ error: "read_failed", message: "We could not reach the checker. Please try again." }, 502);
  }
  if ((count ?? 0) >= PER_IP_PER_DAY) {
    return answer({ error: "rate_limited", message: "We have your request - we will be in touch." }, 429);
  }

  // Same scan, same address, same kind: already asked. Say yes, alert nobody.
  // writeAsk goes again without name, category and market while their
  // migration is not applied, rather than lose the ask.
  const { data: inserted, error: insertErr } = await writeAsk(ask, (fields) =>
    db
      .from("walkthrough_requests")
      .upsert({ scan_id: scan.id, email, kind, ip_hash: ipHash, ...fields }, { onConflict: "scan_id,email,kind", ignoreDuplicates: true })
      .select("id"),
  );
  if (insertErr) {
    console.error("[walkthrough] could not store the request: " + insertErr.message);
    return answer({ error: "write_failed", message: "That did not go through. Please try again." }, 502);
  }
  const fresh = inserted?.[0]?.id as string | undefined;

  // Claimed, so the purge keeps the transcripts. Never fatal: the request is stored.
  if (!scan.unlocked_at) await markClaimed(scan.id as string);

  if (fresh) {
    const sent = await sendWalkthroughAlert({
      kind,
      email,
      ask,
      scan: {
        domain: scan.domain as string,
        brand: (scan.brand_name as string | null) ?? null,
        topic: (scan.topic as string | null) ?? null,
        token,
      },
    });
    if (sent) {
      const { error: notedErr } = await db
        .from("walkthrough_requests")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", fresh);
      if (notedErr) console.warn("[walkthrough] sent but could not stamp notified_at: " + notedErr.message);
    }
  }

  return answer({
    ok: true,
    message:
      kind === "video"
        ? "Thanks. Luke will send your Loom."
        : "Thanks. Danny will be in touch.",
  });
}
