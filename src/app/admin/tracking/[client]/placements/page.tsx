import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { T } from "@/config/tokens";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { linkCheckState, PLACEMENT_KINDS, PLACEMENT_LIMITS, PLACEMENT_STATUSES } from "@/lib/tracking/placements";
import { PLACEMENT_PROMPTS_PER_CLIENT, missingColumn } from "@/lib/tracking/limits";
import { SWITCHED_OFF, placementPromptsOn } from "@/lib/diy/prompts/placement-prompt";
import { anchorWarning, formSplit, nextForm, sharedTargets, targetWarning } from "@/lib/tracking/placement-target";
import { type ClusterAim, readClusterAim } from "@/lib/tracking/placement-target-io";

import { ActionForm } from "../../ActionForm";
import { logPlacement, updatePlacement } from "../../actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Placements",
  robots: { index: false, follow: false },
};

/**
 * /admin/tracking/[client]/placements - R96 part 3, BRIEF-2 T12 (Danny, 29 Sep
 * 2026, danny.md line 88). Behind the /admin Basic auth. Nomada logs each
 * placement on a cluster here: kind, URL, status, scheduled and live dates,
 * anchor. url_key is derived (placements.ts); there is no price field. A row
 * the Sunday link check alerted on (link_present false) is flagged at the top.
 *
 * Clusters are made on /admin/tracking itself (BRIEF-3 C3), so the brief's
 * separate clusters page would be a second copy of that form.
 *
 * 13 Oct 2026, DIY P2 (spec 10 section 6.7): each live row says the prompt it
 * added, or offers Retry, which posts the row's own save with prompt=1. A link
 * insertion adds one only with "Add a prompt from this article's title"
 * ticked. While placement_prompts_enabled is off the page says so, and a save
 * fetches nothing.
 */

const input = {
  padding: "6px 8px",
  border: `1px solid ${T.line}`,
  borderRadius: "6px",
  fontSize: "13px",
  color: T.ink,
  background: T.surface,
} as const;

const KIND_LABEL: Record<string, string> = { guest_post: "guest post", link_insertion: "link insertion", on_site: "on-site", coverage: "coverage" };

type Row = Record<string, unknown>;
type PlacementPrompt = { id: string; text: string; added_on: string; stopped_on: string | null; origin_ref: string | null };

export default async function PlacementsAdmin({ params }: { params: Promise<{ client: string }> }) {
  if (!supabaseConfigured()) return <div style={{ padding: "40px" }}>Database not configured.</div>;
  const { client: slug } = await params;
  const db = supabaseAdmin();
  const { data: client, error: cErr } = await db.from("client_domains").select("id, domain, tier, slug").eq("slug", slug).maybeSingle();
  if (cErr) throw new Error(`could not read the client: ${cErr.message}`);
  if (!client) notFound();
  const id = client.id as string;

  const [{ data: clusters, error: clErr }, { data: rows, error: pErr }] = await Promise.all([
    db.from("tracked_clusters").select("id, name, stopped_on").eq("client_domain_id", id).order("created_at", { ascending: true }),
    db
      .from("placements")
      .select("*")
      .eq("client_domain_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (clErr) throw new Error(`could not read clusters: ${clErr.message}`);
  if (pErr) throw new Error(`could not read placements: ${pErr.message}`);
  // 18 Oct 2026 brief 2b / 2c: each live cluster's target page, keyword forms and split, and where the Sunday
  // check found each live placement's link pointing (link_checks.target, newest per page).
  const aims = new Map<string, ClusterAim>();
  for (const c of (clusters ?? []).filter((c) => c.stopped_on === null)) {
    const aim = await readClusterAim(db, id, c.id as string);
    if (typeof aim === "string") throw new Error(aim);
    aims.set(c.id as string, aim);
  }
  const { data: checks } = await db.from("link_checks").select("url_key, target, checked_at").eq("client_domain_id", id).order("checked_at", { ascending: false });
  const linkTarget = (urlKey: unknown) => ((checks ?? []).find((c) => c.url_key === urlKey)?.target as string | null | undefined) ?? null;
  const conflicts = sharedTargets((clusters ?? []).filter((c) => aims.has(c.id as string)).map((c) => ({ name: c.name as string, target: aims.get(c.id as string)!.target?.url ?? null })));
  // DIY P2: the switch, and the prompts placements added (none to read before the prompt_origins migration).
  const [promptsOn, { data: pq, error: pqErr }] = await Promise.all([
    placementPromptsOn(db),
    db.from("tracked_questions").select("id, text, added_on, stopped_on, origin_ref").eq("client_domain_id", id).eq("origin_kind", "placement").order("added_on", { ascending: false }),
  ]);
  if (pqErr && !missingColumn(pqErr)) throw new Error(`could not read the placement prompts: ${pqErr.message}`);
  const placementPrompts = (pq ?? []) as PlacementPrompt[];
  const livePlacementPrompts = placementPrompts.filter((q) => q.stopped_on === null).length;

  const kinds = PLACEMENT_KINDS.filter((k) => k !== "coverage" || client.tier === "everywhere");
  const liveClusters = (clusters ?? []).filter((c) => c.stopped_on === null);
  const nameOf = (cid: unknown) => ((clusters ?? []).find((c) => c.id === cid)?.name as string | undefined) ?? "-";
  const list = (rows ?? []).map((r) => ({ r, check: linkCheckState(r as { status: string; last_checked_on: string | null; link_present: boolean | null }) }));
  const flagged = list.filter((x) => x.check.flagged);

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px", color: T.ink, fontSize: "14px" }}>
      <p style={{ margin: "0 0 4px", fontSize: "13px" }}>
        <a href="/admin/tracking" style={{ color: T.soft }}>
          Tracking
        </a>
      </p>
      <h1 style={{ fontSize: "24px", margin: "0 0 4px" }}>
        Placements <span style={{ color: T.soft, fontWeight: 400 }}>- {client.domain as string} - {client.tier as string}</span>
      </h1>
      <p style={{ color: T.soft, margin: "0 0 12px" }}>
        Live placements are link-checked on Sundays. The check never changes a status; a row it alerted on is flagged here until you mark it removed.
      </p>
      <p role="status" style={{ margin: "0 0 24px", fontWeight: promptsOn ? 400 : 700, color: promptsOn ? T.soft : T.ink }}>
        {promptsOn
          ? `Placement prompts are on: a guest post or coverage that goes live adds one prompt from its title (${livePlacementPrompts} of ${PLACEMENT_PROMPTS_PER_CLIENT} live on this client). Earlier live placements get theirs through Retry.`
          : SWITCHED_OFF}
      </p>

      {client.tier !== "tracked" && liveClusters.length ? (
        <section aria-label="Target pages" style={{ border: `1px solid ${T.line}`, borderRadius: "10px", padding: "16px", marginBottom: "24px" }}>
          <h2 style={{ fontSize: "16px", margin: "0 0 8px" }}>Where each cluster&apos;s placements point</h2>
          {liveClusters.map((c) => {
            const aim = aims.get(c.id as string);
            if (!aim) return null;
            const split = formSplit(aim.forms, aim.placements);
            const next = nextForm(aim.forms, aim.placements);
            return (
              <div key={c.id as string} style={{ padding: "6px 0", borderTop: `1px solid ${T.hair}` }}>
                <div style={{ fontSize: "15px" }}>
                  <strong>{c.name as string}</strong> →{" "}
                  {aim.target ? (
                    <a href={aim.target.url} rel="noopener noreferrer" target="_blank" style={{ color: T.ink, fontWeight: 700 }}>
                      {aim.target.url}
                    </a>
                  ) : (
                    <span style={{ color: T.badFg, fontWeight: 700 }}>no target page chosen</span>
                  )}
                </div>
                <div style={{ fontSize: "12.5px", color: T.soft }}>
                  {split.length ? `Anchors so far: ${split.map((f) => `"${f.keyword}" ${f.count}`).join(" · ")}` : "No cluster keyword yet."}
                  {next && split.length > 1 ? ` · next placement: "${next.keyword}"` : ""}
                </div>
              </div>
            );
          })}
          {conflicts.map((line) => (
            <p key={line} role="alert" style={{ margin: "8px 0 0", fontWeight: 700 }}>
              {line}
            </p>
          ))}
        </section>
      ) : null}

      {client.tier === "tracked" ? (
        <p style={{ color: T.soft }}>alwaystracked is reporting only: no placements.</p>
      ) : (
        <section style={{ border: `1px solid ${T.line}`, borderRadius: "10px", padding: "16px", marginBottom: "24px" }}>
          <h2 style={{ fontSize: "16px", margin: "0 0 8px" }}>Log a placement</h2>
          {liveClusters.length === 0 ? (
            <p style={{ color: T.soft, margin: 0 }}>This client has no cluster yet. Make one on the tracking page first.</p>
          ) : (
            <ActionForm action={logPlacement} submit="Log placement">
              <input type="hidden" name="client" value={id} maxLength={PLACEMENT_LIMITS.id} />
              <select name="cluster" style={input} aria-label="Cluster">
                {liveClusters.map((c) => (
                  <option key={c.id as string} value={c.id as string}>
                    {c.name as string}
                  </option>
                ))}
              </select>
              <select name="kind" style={input} aria-label="Kind">
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <input name="url" maxLength={PLACEMENT_LIMITS.url} placeholder="Page URL" style={{ ...input, width: "360px" }} aria-label="Page URL" />
              <StatusFields status="pitched" scheduled="" live="" />
              <select name="target_keyword" defaultValue="" style={input} aria-label="Keyword form the anchor is for">
                <option value="">Keyword form: next in the split</option>
                {liveClusters.flatMap((c) =>
                  (aims.get(c.id as string)?.forms ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {c.name as string}: {f.keyword}
                    </option>
                  )),
                )}
              </select>
              <input name="anchor_text" maxLength={PLACEMENT_LIMITS.anchor} placeholder="Anchor text" style={{ ...input, width: "220px" }} aria-label="Anchor text" />
              <input name="internal_note" maxLength={PLACEMENT_LIMITS.note} placeholder="Internal note" style={{ ...input, width: "260px" }} aria-label="Internal note" />
              <InsertionTick />
            </ActionForm>
          )}
        </section>
      )}

      {flagged.length ? (
        <p role="alert" style={{ fontWeight: 700, margin: "0 0 12px" }}>
          {flagged.length} placement{flagged.length === 1 ? "" : "s"} flagged by the link check: {flagged.map((x) => x.r.url_key as string).join(", ")}
        </p>
      ) : null}

      {list.length === 0 ? <p style={{ color: T.soft }}>No placements logged.</p> : null}
      {list.map(({ r, check }) => (
        <PlacementRow key={r.id as string} client={id} row={r} cluster={nameOf(r.cluster_id)} aim={aims.get(r.cluster_id as string) ?? null} linkTarget={linkTarget(r.url_key)} check={check} prompt={placementPrompts.find((q) => q.origin_ref === r.id && q.stopped_on === null) ?? placementPrompts.find((q) => q.origin_ref === r.id) ?? null} promptsOn={promptsOn} />
      ))}
    </div>
  );
}

function StatusFields({ status, scheduled, live }: { status: string; scheduled: string; live: string }) {
  return (
    <>
      <select name="status" defaultValue={status} style={input} aria-label="Status">
        {PLACEMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label style={{ fontSize: "12.5px", color: T.soft }}>
        scheduled <input type="date" name="scheduled_on" defaultValue={scheduled} maxLength={PLACEMENT_LIMITS.date} style={input} />
      </label>
      <label style={{ fontSize: "12.5px", color: T.soft }}>
        live <input type="date" name="live_on" defaultValue={live} maxLength={PLACEMENT_LIMITS.date} style={input} />
      </label>
    </>
  );
}

/** "Add a prompt from this article's title": a link insertion's article is someone else's page, so its prompt is the admin's call. */
function InsertionTick() {
  return (
    <label style={{ fontSize: "12.5px", color: T.soft, display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <input type="checkbox" name="insertion_prompt" value="1" maxLength={PLACEMENT_LIMITS.id} />
      Add a prompt from this article&apos;s title (link insertions)
    </label>
  );
}

/**
 * The row's prompt line: the prompt its placement added, or none yet with the
 * Retry. 13 Oct 2026 review: no Retry where it can do nothing - on-site work,
 * which never adds a prompt, and every row while the switch is off - and the
 * Retry posts only which row it is (updatePlacement saves no field on it), so
 * it cannot write back a value another save has changed since this page drew.
 */
function PromptLine({ client, row, prompt, promptsOn }: { client: string; row: Row; prompt: PlacementPrompt | null; promptsOn: boolean }) {
  if (row.status !== "live") return null;
  if (prompt) {
    return (
      <div style={{ fontSize: "12.5px", color: T.soft, margin: "2px 0" }}>
        {prompt.stopped_on ? `Prompt “${prompt.text}” stopped from ${prompt.stopped_on}.` : `Prompt “${prompt.text}”, first asked ${prompt.added_on}.`}
      </div>
    );
  }
  // The page's own line says the switch is off; a row has nothing to add to it.
  if (row.kind === "on_site" || !promptsOn) return null;
  return (
    <ActionForm action={updatePlacement} submit="Retry prompt">
      <span style={{ fontSize: "12.5px", color: T.soft }}>No prompt from this placement.</span>
      <input type="hidden" name="client" value={client} maxLength={PLACEMENT_LIMITS.id} />
      <input type="hidden" name="id" value={row.id as string} maxLength={PLACEMENT_LIMITS.id} />
      <input type="hidden" name="prompt" value="1" maxLength={PLACEMENT_LIMITS.id} />
      {row.kind === "link_insertion" ? <InsertionTick /> : null}
    </ActionForm>
  );
}

function PlacementRow({ client, row, cluster, aim, linkTarget, check, prompt, promptsOn }: { client: string; row: Row; cluster: string; aim: ClusterAim | null; linkTarget: string | null; check: { flagged: boolean; text: string }; prompt: PlacementPrompt | null; promptsOn: boolean }) {
  const form = aim?.forms.find((f) => f.id === row.target_keyword_id) ?? null;
  const warnings = [anchorWarning(row.anchor_text as string | null, form?.keyword), targetWarning(linkTarget, aim?.target?.url)].filter((w): w is string => !!w);
  return (
    <div style={{ borderTop: `1px solid ${T.hair}`, borderLeft: check.flagged ? `3px solid ${T.badFg}` : "3px solid transparent", padding: "8px 0 8px 10px" }}>
      <div>
        <a href={row.url as string} rel="noopener noreferrer nofollow" target="_blank" style={{ color: T.ink }}>
          {row.url_key as string}
        </a>{" "}
        <span style={{ color: T.soft }}>
          - {KIND_LABEL[row.kind as string] ?? String(row.kind)} - {cluster}
        </span>{" "}
        <span style={{ color: check.flagged ? T.badFg : T.soft, fontWeight: check.flagged ? 700 : 400 }}>- {check.flagged ? `flagged: ${check.text}` : check.text}</span>
      </div>
      <ActionForm action={updatePlacement} submit="Save">
        <input type="hidden" name="client" value={client} maxLength={PLACEMENT_LIMITS.id} />
        <input type="hidden" name="id" value={row.id as string} maxLength={PLACEMENT_LIMITS.id} />
        <StatusFields status={row.status as string} scheduled={(row.scheduled_on as string | null) ?? ""} live={(row.live_on as string | null) ?? ""} />
        {aim && aim.forms.length > 1 ? (
          <select name="target_keyword" defaultValue={form?.id ?? ""} style={input} aria-label={`Keyword form for ${row.url_key as string}`}>
            {form ? null : <option value="">Keyword form: not set</option>}
            {aim.forms.map((f) => (
              <option key={f.id} value={f.id}>
                for “{f.keyword}”
              </option>
            ))}
          </select>
        ) : null}
        <input name="anchor_text" defaultValue={(row.anchor_text as string | null) ?? ""} maxLength={PLACEMENT_LIMITS.anchor} placeholder="Anchor text" style={{ ...input, width: "200px" }} aria-label={`Anchor text for ${row.url_key as string}`} />
        <input name="internal_note" defaultValue={(row.internal_note as string | null) ?? ""} maxLength={PLACEMENT_LIMITS.note} placeholder="Internal note" style={{ ...input, width: "220px" }} aria-label={`Note for ${row.url_key as string}`} />
        {row.kind === "link_insertion" ? <InsertionTick /> : null}
      </ActionForm>
      {warnings.map((w) => (
        <div key={w} role="status" style={{ fontSize: "12.5px", color: T.badFg, margin: "2px 0" }}>
          {w}
        </div>
      ))}
      <PromptLine client={client} row={row} prompt={prompt} promptsOn={promptsOn} />
    </div>
  );
}
