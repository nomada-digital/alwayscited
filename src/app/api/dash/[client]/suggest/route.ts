import { readSuggest, suggest } from "@/lib/dash/suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Suggest a change from a view-as page (lib/dash/suggest.ts): agency staff only, through the hub's ac-suggest. */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const p = readSuggest(await req.json().catch(() => null));
  if (!p) return Response.json({ ok: false, message: "Add a few words first." }, { status: 400 });
  const r = await suggest(slug, p);
  return r.ok ? Response.json({ ok: true }) : Response.json({ ok: false, message: r.message }, { status: r.status });
}
