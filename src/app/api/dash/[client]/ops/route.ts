import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { clientsFor } from "@/lib/tracking/member";
import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath, fixtureClient, fixtureWrite } from "@/lib/dash/fixture";
import { readOp } from "@/lib/dash/ops";
import type { RawClient, TierKey } from "@/lib/dash/types";
import { loadStructure, writeOp } from "@/lib/dash/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Apply one edit on the dashboards host (17 Oct 2026, src/lib/dash/ops.ts).
 * JSON in, JSON out: `{ ok: true, ids }` maps each tempId the browser drew to
 * the row's real id; `{ ok: false, message }` is a refusal in words the page
 * shows as they are. Signed-in members of this client only; viewers and ended
 * clients are refused by refuseOp's role rule.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const op = readOp(await req.json().catch(() => null));
  if (!op) return Response.json({ ok: false, message: "That change could not be read." }, { status: 400 });

  if (dashFixturePath()) {
    if (fixtureClient().slug !== slug) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
    const r = fixtureWrite(op);
    return Response.json(r, { status: r.ok ? 200 : (r.status ?? 422) });
  }

  const clients = await clientsFor(email).catch(() => null);
  if (!clients) return Response.json({ ok: false, message: "Could not read your access. Try again." }, { status: 502 });
  const c = clients.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const client: RawClient = {
    id: c.id, slug: c.slug, domain: c.domain, brand: c.brand, market: c.market, tier: c.tier as TierKey, status: c.status ?? "active",
    started_on: c.started_on, cluster_limit: c.cluster_limit ?? 10, trial_ends_at: c.trial_ends_at ?? null, payment_status: null, brand_aliases: [],
  };
  const db = supabaseAdmin();
  const raw = await loadStructure(db, { client, role: c.role, today: trackingDay() });
  if (typeof raw === "string") return Response.json({ ok: false, message: raw }, { status: 502 });
  const r = await writeOp(db, raw, op, email);
  if (!r.ok) return Response.json(r, { status: r.status ?? 422 });
  return Response.json(r);
}
