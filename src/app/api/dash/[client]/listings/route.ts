import { localListingsFor } from "@/config/local-listings";
import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath } from "@/lib/dash/fixture";
import { saveListingTick } from "@/lib/dash/listings";
import { clientsFor, writeRole } from "@/lib/tracking/member";
import { refuseRole } from "@/lib/tracking/stop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A tick on Local listings (17 Nov 2026): {item, done}, by an owner or editor, for an item on the customer's own list. */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const list = localListingsFor(slug);
  if (!list) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { item?: unknown; done?: unknown } | null;
  const item = typeof body?.item === "string" ? body.item : "";
  if (!list.items.some((i) => i.key === item) || typeof body?.done !== "boolean") return Response.json({ ok: false, message: "That item is not on your list." }, { status: 400 });
  if (dashFixturePath()) return Response.json({ ok: true });
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const clients = await clientsFor(email).catch(() => null);
  if (!clients) return Response.json({ ok: false, message: "Could not read your access. Try again." }, { status: 502 });
  const client = clients.find((c) => c.slug === slug);
  if (!client) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  if (refuseRole(writeRole(client))) return Response.json({ ok: false, message: "Viewers cannot tick items off." }, { status: 403 });
  const ok = await saveListingTick(client.id, email, item, body.done);
  return ok ? Response.json({ ok: true }) : Response.json({ ok: false, message: "That did not save. Try again." }, { status: 502 });
}
