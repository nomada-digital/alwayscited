import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath } from "@/lib/dash/fixture";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { tickDeliverable } from "@/lib/deliverables/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer's "Mark as done" (25 Nov 2026, lib/deliverables/store.ts tickDeliverable). JSON in, JSON out:
 * `{ action: "tick", id, note?, url? }`. Signed-in owners and editors of this client only: a viewer, a demo link and
 * the hub's view-as link are refused (the pages never send them here). The deliverable must be shared with the
 * customer and theirs to do; who ticked it and when is recorded, and the customer success manager is told.
 * Answers `{ ok: true, by, at }` or `{ ok: false, message }` in words the card shows as they are.
 */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const no = (message: string, status = 422) => Response.json({ ok: false, message }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return no("Your session has ended. Sign in again.", 401);
  if (dashFixturePath()) return no("Not available in a local fixture run.", 404);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof b?.id === "string" && ID.test(b.id) ? b.id : null;
  if (b?.action !== "tick" || !id) return no("That could not be read.", 400);
  const clients = await clientsFor(email).catch(() => null);
  if (!clients) return no("Could not read your access. Try again.", 502);
  const c = clients.find((x) => x.slug === slug);
  if (!c) return no("Not found.", 404);
  if ((c.role !== "owner" && c.role !== "editor") || c.status === "ended") return no("An owner or editor on your account can mark this as done.", 403);
  const r = await tickDeliverable({ clientId: c.id, domain: c.domain, id, by: email, note: b.note, url: b.url }, supabaseAdmin());
  if (!r.ok) return no(r.message, r.status);
  return Response.json({ ok: true, by: email, at: new Date().toISOString(), slack: r.slack });
}
