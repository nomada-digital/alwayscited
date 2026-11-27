import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath } from "@/lib/dash/fixture";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { refuseRole } from "@/lib/tracking/stop";
import { customerAccess, customerAction, customerPlatform } from "@/lib/tasks/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Your tasks, the customer's own ticks (27 Nov 2026, lib/tasks/store.ts): mark a task done, undo that, or check it now.
 * Owners and editors only, the same rule as the other things a customer changes; a viewer reads the list.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; op?: unknown; platform?: unknown } | null;
  const platform = typeof body?.platform === "string" ? body.platform.slice(0, 20) : "";
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
  const op = body?.op === "done" || body?.op === "undo" || body?.op === "check" || body?.op === "access" || body?.op === "platform" ? body.op : null;
  if (!op || (!id && op !== "access" && op !== "platform")) return Response.json({ ok: false, message: "Pick a task." }, { status: 400 });
  if (dashFixturePath()) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const role = refuseRole(c.status === "ended" ? "viewer" : c.role);
  if (role) return Response.json({ ok: false, message: role }, { status: 403 });
  const db = supabaseAdmin();
  if (op === "platform") {
    const m = await customerPlatform(db, { id: c.id, domain: c.domain }, platform);
    return m ? Response.json({ ok: false, message: m }, { status: 400 }) : Response.json({ ok: true });
  }
  const r = op === "access" ? await customerAccess(db, { id: c.id, domain: c.domain }, email, platform) : await customerAction(db, { id: c.id, domain: c.domain }, email, id!, op);
  return typeof r === "string" ? Response.json({ ok: false, message: r }, { status: 400 }) : Response.json({ ok: true, tasks: r });
}
