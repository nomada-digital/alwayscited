import { SCAN_LIMITS } from "@/config/contact";
import { TIERS } from "@/config/pricing";
import { isPlausibleEmail, normalizeEmail } from "@/lib/email-address";
import { clientIp, hashIp } from "@/lib/scan/ip";
import { readWalkthroughCategory, readWalkthroughMarket, readWalkthroughName } from "@/lib/scan/walkthrough-fields";
import { sendWalkthroughAlert } from "@/lib/scan/walkthrough-mail";
import { writeAsk } from "@/lib/scan/walkthrough-store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isWorkEmail, WORK_EMAIL_REFUSAL } from "@/lib/work-email";
import { workEmailBlockedExtra } from "@/lib/work-email-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Requests one caller may make in a rolling day. Each one emails Danny. */
const PER_IP_PER_DAY = 5;

/**
 * The walkthrough ask from a tier page, where there is no scan - 28 September
 * 2026, pricing spec section 6 (Danny, danny.md line 55: "reuse
 * WalkthroughForm... stored in walkthrough_requests and emailed to Danny as
 * today").
 *
 * The sibling of `/api/scan/[token]/walkthrough`, with `scan_id` left null
 * (the column is nullable, `on delete set null`). Two things differ because
 * of that null. The unique `(scan_id, email, kind)` index does not dedupe -
 * nulls are distinct - so a same-address, same-kind ask in the last day is
 * looked up here and answered yes without a second alert. And `from` is held
 * to the four tier pages' own paths, so the alert never carries a string a
 * caller made up.
 *
 * 13 Oct 2026 (Danny): name, category and market are required, read in the
 * form's order after `from`, as in the scan route beside this one.
 */
export async function POST(req: Request) {
  let body: { email?: string; kind?: string; from?: string; name?: unknown; category?: unknown; market?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const kind = body.kind === "demo" ? "demo" : body.kind === "video" ? "video" : null;
  if (!kind) return Response.json({ error: "bad_kind", message: "Pick a video or a demo." }, { status: 400 });

  const from = TIERS.find((t) => t.href === body.from)?.href;
  if (!from) return Response.json({ error: "bad_from" }, { status: 400 });

  const name = readWalkthroughName(body.name);
  if (!name.ok) return Response.json({ error: name.error, message: name.message }, { status: 400 });

  const email = normalizeEmail(body.email ?? "");
  if (email.length > SCAN_LIMITS.email || !isPlausibleEmail(email)) {
    return Response.json({ error: "bad_email", message: "That email does not look right." }, { status: 400 });
  }
  if (!isWorkEmail(email, await workEmailBlockedExtra())) {
    return Response.json({ error: "personal_email", message: WORK_EMAIL_REFUSAL }, { status: 400 });
  }

  const category = readWalkthroughCategory(body.category);
  if (!category.ok) return Response.json({ error: category.error, message: category.message }, { status: 400 });
  const market = readWalkthroughMarket(body.market);
  if (!market.ok) return Response.json({ error: market.error, message: market.message }, { status: 400 });
  const ask = { name: name.value, category: category.value, market: market.value };

  const db = supabaseAdmin();
  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countErr } = await db
    .from("walkthrough_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (countErr) {
    console.warn("[walkthrough] could not count recent requests: " + countErr.message);
    return Response.json({ error: "read_failed", message: "We could not reach the checker. Please try again." }, { status: 502 });
  }
  if ((count ?? 0) >= PER_IP_PER_DAY) {
    return Response.json(
      { error: "rate_limited", message: "We have your request - we will be in touch." },
      { status: 429 },
    );
  }

  const done = {
    ok: true,
    message:
      kind === "video"
        ? "Thanks. Luke will send your Loom."
        : "Thanks. Danny will be in touch.",
  };

  // Same address, same kind, no scan, in the last day: already asked. Say yes, alert nobody.
  const { count: repeat, error: repeatErr } = await db
    .from("walkthrough_requests")
    .select("id", { count: "exact", head: true })
    .is("scan_id", null)
    .eq("email", email)
    .eq("kind", kind)
    .gte("created_at", since);
  if (repeatErr) {
    console.warn("[walkthrough] could not check for a repeat: " + repeatErr.message);
    return Response.json({ error: "read_failed", message: "We could not reach the checker. Please try again." }, { status: 502 });
  }
  if ((repeat ?? 0) > 0) return Response.json(done);

  // writeAsk goes again without name, category and market while their
  // migration is not applied, rather than lose the ask.
  const { data: inserted, error: insertErr } = await writeAsk(ask, (fields) =>
    db
      .from("walkthrough_requests")
      .insert({ scan_id: null, email, kind, ip_hash: ipHash, ...fields })
      .select("id"),
  );
  if (insertErr) {
    console.error("[walkthrough] could not store the request: " + insertErr.message);
    return Response.json({ error: "write_failed", message: "That did not go through. Please try again." }, { status: 502 });
  }
  const fresh = inserted?.[0]?.id as string | undefined;

  if (fresh) {
    const sent = await sendWalkthroughAlert({ kind, email, ask, scan: null, from });
    if (sent) {
      const { error: notedErr } = await db
        .from("walkthrough_requests")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", fresh);
      if (notedErr) console.warn("[walkthrough] sent but could not stamp notified_at: " + notedErr.message);
    }
  }

  return Response.json(done);
}
