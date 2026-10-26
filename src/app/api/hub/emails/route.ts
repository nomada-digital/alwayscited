import { timingSafeEqual } from "node:crypto";

import { TRACKED_PRICE } from "@/config/pricing";
import { emailCatalogue, isTestRecipient, testSubject } from "@/lib/email/catalogue";
import { sendLifecycle } from "@/lib/email/lifecycle-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agency hub's Emails tab (26 Oct 2026, lib/email/catalogue.ts): every lifecycle and transactional email's
 * previews, and a test send. Server to server only, as /api/hub/offer is: the hub's edge function alwayscited-admin
 * sends `x-hub-secret`, which must equal HUB_OFFER_SECRET; unset, the door answers 503. The hub reads and writes the
 * switches themselves (app_settings email_<name>_enabled) with the service key, and logs every change there.
 *
 * POST {action: "list"} -> {emails: CatalogueEntry[]} - previews on made-up data; reads no row, sends nothing.
 * POST {action: "test", name, to} -> {sent, cases} - every case of one written email to `to`, subject marked [Test].
 *   The hub asks for one before an admin may switch an email on, to that admin's own address. Only a
 *   @nomadadigital.co.uk address is ever sent one. It does not ask the flag: the point is to see it while it is off.
 */
export async function POST(req: Request) {
  const secret = process.env.HUB_OFFER_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-hub-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const emails = emailCatalogue(TRACKED_PRICE);
  if (body.action === "list") return Response.json({ emails }, { headers: { "cache-control": "no-store" } });
  if (body.action !== "test") return Response.json({ error: "bad_request" }, { status: 400 });

  const entry = emails.find((e) => e.name === body.name);
  if (!entry) return Response.json({ error: "unknown_email" }, { status: 400 });
  if (!entry.written) return Response.json({ error: "not_written" }, { status: 400 });
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!isTestRecipient(to)) return Response.json({ error: "bad_recipient" }, { status: 400 });

  let sent = 0;
  for (const c of entry.cases) {
    if (await sendLifecycle({ memberEmail: to, mail: { subject: testSubject(`${c.subject} (${c.label})`), html: c.html, text: c.text } })) sent++;
  }
  if (!sent) return Response.json({ error: "send_failed", cases: entry.cases.length }, { status: 502 });
  return Response.json({ sent, cases: entry.cases.length });
}

/** Server to server only. */
export function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
}
