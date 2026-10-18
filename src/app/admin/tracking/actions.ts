"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { type TierKey } from "@/components/TierName";
import { enginesFor } from "@/config/pricing";
import { constantTimeEqual, decodeBasicAuth } from "@/lib/constant-time";
import { isPlausibleEmail } from "@/lib/email-address";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ADMIN_LIMITS, dayAfter, liveOn, slugFor, trackingDay, upsellSetting } from "@/lib/tracking/decide";
import { NEEDS_A_KEYWORD } from "@/lib/checkout/signup";
import { type Angle, angleFor, groupPrompts, insertCluster, insertKeyword, insertPrompts, linkKeyword, missingColumn, namesBrandIn, PROMPTS_PER_CLUSTER, readPromptRoom, readSubject, refuseGrouping } from "@/lib/tracking/limits";
import { dispatchTrackingRun, requestRerun } from "@/lib/tracking/runner";
import { RERUN_BUTTON } from "@/lib/tracking/rerun";
import { adminEdit, adminStop, isAdminKind } from "@/lib/tracking/admin-edit";
import { placementFields } from "@/lib/tracking/placements";
import { anchorWarning, nextForm } from "@/lib/tracking/placement-target";
import { readClusterAim } from "@/lib/tracking/placement-target-io";
import { placementSaved } from "@/lib/diy/prompts/placement-prompt";
import { clearScope } from "@/lib/tracking/scope";

/**
 * /admin/tracking's writes - T2 of docs/tracked-dashboard-2026-09-29/BRIEF.md
 * (Danny, 29 Sep 2026).
 *
 * The /admin proxy is not enough on its own: a server action is invoked by
 * its action id and Next answers that id on any path, not only the page that
 * rendered the form. So every action checks the same Basic auth itself, with
 * the proxy's own helpers, before it reads or writes anything. The browser
 * sends the header because the post goes to /admin/tracking, inside the realm.
 *
 * Every action returns a sentence rather than throwing, so the page can say
 * what happened. Limits are enforced in `limits.ts` (BRIEF-3 C2), never only
 * in the form; every tracked insert goes through it.
 */

export type AdminResult = { ok: boolean; message: string };

const TIERS = ["tracked", "mentioned", "cited", "everywhere"];

/** The proxy's check, repeated inside the action. Null when the caller is the admin. */
async function refuseUnlessAdmin(): Promise<AdminResult | null> {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password) return { ok: false, message: "Admin access is not configured." };
  const creds = decodeBasicAuth((await headers()).get("authorization") ?? "");
  if (!creds) return { ok: false, message: "Not authorised." };
  const userOk = constantTimeEqual(creds.user, user);
  const passwordOk = constantTimeEqual(creds.password, password);
  return userOk && passwordOk ? null : { ok: false, message: "Not authorised." };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Create a tracked client from a finished scan: its domain, brand, market and questions. */
export async function createClientFromScan(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const token = text(form, "scan").replace(/^.*\/scan\//, "").replace(/[/?#].*$/, "");
  const email = text(form, "email").toLowerCase();
  const tier = text(form, "tier") || "tracked";
  if (!/^[0-9a-f]{32}$/i.test(token)) return { ok: false, message: "Paste a scan URL or its 32-character token." };
  if (email.length > ADMIN_LIMITS.email || !isPlausibleEmail(email)) return { ok: false, message: "An owner email is needed." };
  if (!TIERS.includes(tier)) return { ok: false, message: "Unknown tier." };

  const db = supabaseAdmin();
  const { data: scan, error: sErr } = await db
    .from("scans")
    .select("id, domain, brand_name, topic, market, status, cluster_keyword, cluster_keyword_volume, cluster_keyword_intent, cluster_keyword_status")
    .eq("public_token", token)
    .maybeSingle();
  if (sErr) return { ok: false, message: `Could not read the scan: ${sErr.message}` };
  if (!scan) return { ok: false, message: "No scan with that token." };
  if (scan.status !== "complete") return { ok: false, message: `That scan is ${scan.status}, not complete.` };
  if (scan.market !== "UK" && scan.market !== "US") return { ok: false, message: "That scan has no market." };

  // The account: found by email, or made.
  // Exact, never ilike (8 Oct 2026, audit security-1): `email` is trimmed and lowercased above.
  const { data: found, error: aErr } = await db.from("accounts").select("id").eq("email", email).maybeSingle();
  if (aErr) return { ok: false, message: `Could not read accounts: ${aErr.message}` };
  let accountId = found?.id as string | undefined;
  if (!accountId) {
    const { data: made, error: mErr } = await db.from("accounts").insert({ email }).select("id").single();
    if (mErr) return { ok: false, message: `Could not create the account: ${mErr.message}` };
    accountId = made.id as string;
  }

  const startedOn = dayAfter(trackingDay());
  // question_limit and keyword_limit keep their column defaults and are no
  // longer read (BRIEF-3 C0/C2); cluster_limit is left to its default on
  // insert so a re-run never undoes packs the webhook set.
  const fields = {
    account_id: accountId,
    domain: scan.domain as string,
    brand_name: scan.brand_name as string | null,
    topic: scan.topic as string | null,
    market: scan.market as string,
    slug: slugFor(scan.domain as string),
    status: "active",
    tier,
    started_on: startedOn,
    source_scan_id: scan.id as string,
  };

  // One client per (account, domain, topic, market) - the existing unique key.
  const { data: client, error: cErr } = await db
    .from("client_domains")
    .upsert(fields, { onConflict: "account_id,domain,topic,market" })
    .select("id")
    .single();
  if (cErr) return { ok: false, message: `Could not create the client: ${cErr.message}` };

  const { data: existing, error: eErr } = await db
    .from("tracked_questions")
    .select("text")
    .eq("client_domain_id", client.id);
  if (eErr) return { ok: false, message: `Could not read the client's prompts: ${eErr.message}` };
  const have = new Set((existing ?? []).map((q) => String(q.text).toLowerCase()));

  const { data: sq, error: qErr } = await db
    .from("scan_questions")
    .select("idx, question, kind")
    .eq("scan_id", scan.id)
    .order("idx", { ascending: true });
  if (qErr) return { ok: false, message: `Could not read the scan's prompts: ${qErr.message}` };
  const room = await readPromptRoom(db, client.id as string, null);
  if (typeof room === "string") return { ok: false, message: room };
  // Each prompt keeps its scan kind as its angle (BRIEF-3 C3).
  // A scan prompt that names the brand is left behind. This is a copy of the
  // scan, and the scan measures unprompted naming (R133, 30 Sep 2026). A prompt
  // an admin types in is kept and flagged instead (limits.ts BRANDED_CHIP).
  const subject = await readSubject(db, client.id as string);
  if (typeof subject === "string") return { ok: false, message: subject };
  const rows = (sq ?? [])
    .map((q) => ({ text: String(q.question).trim(), angle: angleFor(q.kind) }))
    .filter((q) => q.text.length >= 8 && q.text.length <= 300 && !have.has(q.text.toLowerCase()) && !namesBrandIn(q.text, subject))
    .slice(0, room.room)
    .map((q) => ({ text: q.text, angle: q.angle, source: "scan", added_on: startedOn, added_by: "nomada" }));

  // A scan made since C1 carries its cluster keyword (or says none qualified):
  // its first 5 prompts become the first cluster, as signup does. An older
  // scan (status null) has no cluster; its prompts stay ungrouped for grouping below.
  let clustered = 0;
  if (scan.cluster_keyword_status && rows.length && have.size === 0) {
    const chosen = scan.cluster_keyword_status === "chosen" && typeof scan.cluster_keyword === "string" && scan.cluster_keyword.trim();
    const cluster = await insertCluster(db, client.id as string, { name: chosen ? (scan.cluster_keyword as string).trim() : NEEDS_A_KEYWORD, tier, started_on: startedOn });
    if (!cluster.ok) return { ok: false, message: `Client made, cluster refused: ${cluster.message}` };
    if (chosen) {
      const kw = await insertKeyword(db, client.id as string, cluster.ids[0]!, {
        keyword: (scan.cluster_keyword as string).trim(),
        added_on: startedOn,
        added_by: "nomada",
        search_volume: (scan.cluster_keyword_volume as number | null) ?? null,
        intent: (scan.cluster_keyword_intent as string | null) ?? null,
      });
      if (!kw.ok) return { ok: false, message: `Cluster made, keyword refused: ${kw.message}` };
    }
    const first = await insertPrompts(db, client.id as string, cluster.ids[0]!, rows.slice(0, PROMPTS_PER_CLUSTER));
    if (!first.ok) return { ok: false, message: `Cluster made, prompts refused: ${first.message}` };
    clustered = Math.min(rows.length, PROMPTS_PER_CLUSTER);
  }
  const copied = await insertPrompts(db, client.id as string, null, rows.slice(clustered));
  if (!copied.ok) return { ok: false, message: `Could not copy the prompts: ${copied.message}` };

  const { error: memErr } = await db
    .from("dashboard_members")
    .upsert({ account_id: accountId, email, role: "owner" }, { onConflict: "account_id,email", ignoreDuplicates: true });
  if (memErr) return { ok: false, message: `Client made, but the owner could not be added: ${memErr.message}` };

  revalidatePath("/admin/tracking");
  return { ok: true, message: `${scan.domain} set up: ${rows.length} scan prompt(s), first check ${startedOn}.` };
}

/** Add a Nomada question or a keyword, up to the client's allowance (limits.ts). */
export async function addTracked(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const clientId = text(form, "client");
  const kind = text(form, "kind");
  const value = text(form, "value");
  if (kind !== "question" && kind !== "keyword") return { ok: false, message: "Unknown kind." };
  if (kind === "question" && (value.length < 8 || value.length > 300)) return { ok: false, message: "A prompt is 8 to 300 characters." };
  if (kind === "keyword" && (value.length < 2 || value.length > 120)) return { ok: false, message: "A keyword is 2 to 120 characters." };

  const db = supabaseAdmin();
  const table = kind === "question" ? "tracked_questions" : "tracked_keywords";
  const column = kind === "question" ? "text" : "keyword";
  const { data: live, error: lErr } = await db
    .from(table)
    .select(`${column}, added_on, stopped_on`)
    .eq("client_domain_id", clientId)
    .is("stopped_on", null);
  if (lErr) return { ok: false, message: `Could not read the current list: ${lErr.message}` };
  const rows = (live ?? []) as unknown as Record<string, string | null>[];
  if (rows.some((r) => String(r[column]).toLowerCase() === value.toLowerCase())) {
    return { ok: false, message: `That ${kind} is already tracked.` };
  }

  const addedOn = dayAfter(trackingDay());
  // Ungrouped until C3's cluster form names one; limits.ts refuses past the allowance.
  const written =
    kind === "question"
      ? await insertPrompts(db, clientId, null, [{ text: value, source: "nomada", added_on: addedOn, added_by: "nomada" }])
      : await insertKeyword(db, clientId, null, { keyword: value, added_on: addedOn, added_by: "nomada" });
  if (!written.ok) return { ok: false, message: written.message };
  revalidatePath("/admin/tracking");
  return { ok: true, message: `Added; first check ${addedOn}.` };
}

/**
 * Group prompts into a cluster - BRIEF-3 C3 (Danny, 29 Sep 2026). With no
 * cluster named, makes a new one on the keyword typed; with one named, adds
 * prompts to it and, if it has none, its keyword. The keyword is an existing
 * ungrouped one when the text matches, else a new row. Each prompt without an
 * angle takes its scan kind, matched by text on the client's source scan.
 * Nothing is re-created or re-run: readings stay on the same rows.
 *
 * The keyword is not yet run through C1's volume and intent check; that check
 * is built with C1 and this form calls it then. Until then Nomada types it.
 */
export async function groupCluster(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const clientId = text(form, "client");
  const clusterIdIn = text(form, "cluster");
  const keyword = text(form, "keyword");
  const ids = form.getAll("prompt").map((v) => String(v)).filter(Boolean);
  if (keyword && (keyword.length < 2 || keyword.length > 120)) return { ok: false, message: "A keyword is 2 to 120 characters." };
  if (!clusterIdIn && !keyword) return { ok: false, message: "A new cluster needs its keyword." };
  if (!clusterIdIn && !ids.length) return { ok: false, message: "Pick the prompts that go in it." };

  const db = supabaseAdmin();
  const { data: client, error: cErr } = await db.from("client_domains").select("id, tier, source_scan_id").eq("id", clientId).single();
  if (cErr) return { ok: false, message: `Could not read the client: ${cErr.message}` };
  const { data: live, error: qErr } = await db
    .from("tracked_questions")
    .select("id, text, added_on")
    .eq("client_domain_id", clientId)
    .is("cluster_id", null)
    .is("stopped_on", null);
  if (qErr) return { ok: false, message: `Could not read the ungrouped prompts: ${qErr.message}` };
  const picked = (live ?? []).filter((q) => ids.includes(q.id as string));
  if (ids.length) {
    // Judged before anything is written, so a refused batch leaves no empty cluster behind.
    const early = refuseGrouping({ ids, ungrouped: new Set((live ?? []).map((q) => q.id as string)), clusterLive: 0 });
    if (early) return { ok: false, message: early };
  }

  // Angles from the source scan's kinds, by text.
  const angles = new Map<string, Angle | null>();
  if (client.source_scan_id && picked.length) {
    const { data: sq, error: sErr } = await db.from("scan_questions").select("question, kind").eq("scan_id", client.source_scan_id as string);
    if (sErr) return { ok: false, message: `Could not read the scan's kinds: ${sErr.message}` };
    const kinds = new Map((sq ?? []).map((q) => [String(q.question).trim().toLowerCase(), angleFor(q.kind)]));
    for (const q of picked) angles.set(q.id as string, kinds.get(String(q.text).trim().toLowerCase()) ?? null);
  }

  let clusterId = clusterIdIn;
  if (!clusterId) {
    // The cluster started when its oldest prompt did, so its history reads from day one.
    const startedOn = picked.map((q) => q.added_on as string).sort()[0] ?? dayAfter(trackingDay());
    const made = await insertCluster(db, clientId, { name: keyword, tier: client.tier as string, started_on: startedOn });
    if (!made.ok) return { ok: false, message: made.message };
    clusterId = made.ids[0]!;
  }

  if (keyword) {
    const { data: ks, error: kErr } = await db.from("tracked_keywords").select("id, keyword").eq("client_domain_id", clientId).is("stopped_on", null);
    if (kErr) return { ok: false, message: `Could not read the keywords: ${kErr.message}` };
    const same = (ks ?? []).find((k) => String(k.keyword).toLowerCase() === keyword.toLowerCase());
    const kw = same
      ? await linkKeyword(db, clientId, clusterId, same.id as string)
      : await insertKeyword(db, clientId, clusterId, { keyword, added_on: dayAfter(trackingDay()), added_by: "nomada" });
    if (!kw.ok) return { ok: false, message: kw.message };
    if (clusterIdIn) {
      const { error: nErr } = await db.from("tracked_clusters").update({ name: keyword }).eq("id", clusterId).eq("name", NEEDS_A_KEYWORD);
      if (nErr) return { ok: false, message: `Keyword linked, name not updated: ${nErr.message}` };
    }
  }

  if (ids.length) {
    const grouped = await groupPrompts(db, clientId, clusterId, ids, angles);
    if (!grouped.ok) return { ok: false, message: grouped.message };
  }
  revalidatePath("/admin/tracking");
  return { ok: true, message: `${clusterIdIn ? "Cluster updated" : `Cluster "${keyword}" made`}: ${ids.length} prompt(s) grouped${keyword ? `, keyword ${keyword}` : ""}.` };
}

/** R102: rewrite one prompt's or keyword's text, only while it has no reading (admin-edit.ts). */
export async function editTracked(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const kind = text(form, "kind");
  if (!isAdminKind(kind)) return { ok: false, message: "Unknown kind." };
  const done = await adminEdit(supabaseAdmin(), { kind, clientId: text(form, "client"), id: text(form, "id"), text: text(form, "value") });
  if (done.ok) revalidatePath("/admin/tracking");
  return done;
}

/** R102: stop one prompt or keyword from tomorrow; the row and its history stay. */
export async function stopTracked(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const kind = text(form, "kind");
  if (!isAdminKind(kind)) return { ok: false, message: "Unknown kind." };
  const done = await adminStop(supabaseAdmin(), { kind, clientId: text(form, "client"), id: text(form, "id"), today: trackingDay() });
  if (done.ok) revalidatePath("/admin/tracking");
  return done;
}

const placementInput = (form: FormData) => ({
  kind: text(form, "kind"),
  url: text(form, "url"),
  status: text(form, "status"),
  scheduled_on: text(form, "scheduled_on"),
  live_on: text(form, "live_on"),
  anchor_text: text(form, "anchor_text"),
  internal_note: text(form, "internal_note"),
});

/**
 * 13 Oct 2026, DIY P2 (spec 10 section 6.7): the placement prompt hook
 * (placement-prompt.ts placementSaved, which has the rules and their test).
 * It runs when a save leaves a placement live - logged live or moved to live -
 * or on the row's Retry (prompt=1), never for a row merely re-saved while
 * live, so switching placement_prompts_enabled on backfills nothing in bulk:
 * each earlier placement gets its prompt through its own Retry. A move to
 * removed stops its prompt. `insertion_prompt` is the "Add a prompt from this
 * article's title" tick a link insertion needs. The hook reads the switch
 * first; while it is off nothing is fetched.
 */
const placementPrompt = (db: ReturnType<typeof supabaseAdmin>, form: FormData, p: { clientId: string; placementId: string; before: string | null; after: string; retry?: boolean; saved: string }) =>
  placementSaved(db, { ...p, retry: p.retry ?? false, insertion: text(form, "insertion_prompt") === "1", today: trackingDay() }, { fetcher: fetch });

/**
 * R96 part 3 (BRIEF-2 T12): log a placement on one of the client's clusters.
 * alwaystracked is reporting only, so its clients have none. placements.ts
 * judges the fields and derives url_key; there is no price field anywhere.
 * A placement logged live adds its prompt (DIY P2, placementPrompt above).
 */
export async function logPlacement(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const clientId = text(form, "client");
  const clusterId = text(form, "cluster");
  const db = supabaseAdmin();
  const { data: client, error: cErr } = await db.from("client_domains").select("id, tier, slug").eq("id", clientId).single();
  if (cErr) return { ok: false, message: `Could not read the client: ${cErr.message}` };
  if (client.tier === "tracked") return { ok: false, message: "alwaystracked clients have no placements." };
  const { data: cluster, error: clErr } = await db.from("tracked_clusters").select("id").eq("id", clusterId).eq("client_domain_id", clientId).maybeSingle();
  if (clErr) return { ok: false, message: `Could not read the cluster: ${clErr.message}` };
  if (!cluster) return { ok: false, message: "Pick one of this client's clusters." };
  const judged = placementFields(placementInput(form), client.tier as string);
  if ("error" in judged) return { ok: false, message: judged.error };
  // 18 Oct 2026 brief 2b / 2c: the placement points at the cluster's target page, for the keyword form the
  // split calls for unless one was picked. Neither blocks the save; what is missing or off is said after it.
  const aim = await readClusterAim(db, clientId, clusterId);
  if (typeof aim === "string") return { ok: false, message: aim };
  const picked = aim.forms.find((f) => f.id === text(form, "target_keyword")) ?? nextForm(aim.forms, aim.placements);
  const aimed = { target_page_id: aim.target?.id ?? null, target_keyword_id: picked?.id ?? null };
  const base = { ...judged.row, client_domain_id: clientId, cluster_id: clusterId, created_by: "nomada" };
  let { data: made, error } = await db.from("placements").insert({ ...base, ...aimed }).select("id").single();
  if (missingColumn(error)) ({ data: made, error } = await db.from("placements").insert(base).select("id").single());
  if (error || !made) return { ok: false, message: `Could not log the placement: ${error?.message ?? "no row came back"}` };
  const warnings = [aim.target ? null : "This cluster has no target page yet: choose one on the dashboard's cluster page.", anchorWarning(judged.row.anchor_text, picked?.keyword)].filter(Boolean);
  const aimLine = `${aim.target ? ` To ${aim.target.url}` : ""}${picked ? `, for "${picked.keyword}"` : ""}.`;
  const message = await placementPrompt(db, form, { clientId, placementId: made.id as string, before: null, after: judged.row.status, saved: `Logged ${judged.row.url_key} (${judged.row.status}).${aimLine}${warnings.length ? ` ${warnings.join(" ")}` : ""}` });
  revalidatePath(`/admin/tracking/${client.slug as string}/placements`);
  return { ok: true, message };
}

/**
 * R96 part 3: change a placement's status, dates, anchor or note. Nomada moves
 * the status by hand; the Sunday check never does. The URL is fixed once
 * logged (url_key is what citations match on), so a wrong one is marked
 * removed and logged again.
 *
 * DIY P2: a move to live, or the row's Retry (prompt=1), adds its prompt; a
 * move to removed stops its prompt from tomorrow, never deleting it. A Retry
 * posts no fields and saves none (13 Oct 2026 review: its hidden copies of the
 * row's fields could write back values a later save had changed).
 */
export async function updatePlacement(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const clientId = text(form, "client");
  const id = text(form, "id");
  const db = supabaseAdmin();
  const { data: row, error: rErr } = await db
    .from("placements")
    .select("id, kind, url, status, cluster_id, client_domains(tier, slug)")
    .eq("id", id)
    .eq("client_domain_id", clientId)
    .maybeSingle();
  if (rErr) return { ok: false, message: `Could not read the placement: ${rErr.message}` };
  if (!row) return { ok: false, message: "No such placement on this client." };
  const owner = row.client_domains as unknown as { tier: string; slug: string };
  if (text(form, "prompt") === "1") {
    const message = await placementPrompt(db, form, { clientId, placementId: id, before: row.status as string, after: row.status as string, retry: true, saved: "" });
    revalidatePath(`/admin/tracking/${owner.slug}/placements`);
    return { ok: true, message };
  }
  const judged = placementFields({ ...placementInput(form), kind: row.kind as string, url: row.url as string }, owner.tier);
  if ("error" in judged) return { ok: false, message: judged.error };
  const { status, scheduled_on, live_on, anchor_text, internal_note } = judged.row;
  // 18 Oct 2026 brief 2c: the keyword form may be changed here; the anchor is checked against it, as a warning.
  const aim = await readClusterAim(db, clientId, row.cluster_id as string);
  if (typeof aim === "string") return { ok: false, message: aim };
  const picked = aim.forms.find((f) => f.id === text(form, "target_keyword")) ?? null;
  const fields = { status, scheduled_on, live_on, anchor_text, internal_note, updated_at: new Date().toISOString() };
  const save = (f: Record<string, unknown>) => db.from("placements").update(f).eq("id", id).eq("client_domain_id", clientId);
  let { error } = await save(picked ? { ...fields, target_keyword_id: picked.id } : fields);
  if (missingColumn(error)) ({ error } = await save(fields));
  if (error) return { ok: false, message: `Could not save the placement: ${error.message}` };
  const warning = anchorWarning(anchor_text, picked?.keyword);
  const message = await placementPrompt(db, form, { clientId, placementId: id, before: row.status as string, after: status, saved: `Saved: ${status}.${warning ? ` ${warning}` : ""}` });
  revalidatePath(`/admin/tracking/${owner.slug}/placements`);
  return { ok: true, message };
}

/**
 * Add or remove a dashboard member on an account.
 *
 * AG-1 (9 Oct 2026, scope.ts): a member someone added here keeps whatever
 * client scope they have - none for someone new, so every client - except an
 * owner, whose scope is cleared: owners always see every client, and the
 * owner-only mails (runner first_reading, lifecycle-sweep) rely on that.
 *
 * A removal leaves the scope as it is (AG-1 review, 9 Oct 2026), as Settings'
 * Remove does: nothing reads a removed member's scope, a Settings invite
 * clears it before they are live, and a clear landing after an invite had
 * made them live would leave them seeing every client. So re-adding here
 * someone removed while limited brings them back limited, as their line on
 * this page then says; it used to bring them back seeing every client.
 */
export async function setMember(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const accountId = text(form, "account");
  const email = text(form, "email").toLowerCase();
  const role = text(form, "role") || "editor";
  const remove = text(form, "remove") === "1";
  if (email.length > ADMIN_LIMITS.email || !isPlausibleEmail(email)) return { ok: false, message: "A valid email is needed." };
  const db = supabaseAdmin();
  if (remove) {
    // BRIEF-4 P0: a removal never deletes the row; it is marked, and every membership read skips it.
    const { error } = await db
      .from("dashboard_members")
      .update({ removed_at: new Date().toISOString(), removed_by: "nomada" })
      .eq("account_id", accountId)
      .eq("email", email)
      .is("removed_at", null);
    if (error) return { ok: false, message: `Could not remove ${email}: ${error.message}` };
  } else {
    if (!["owner", "editor", "viewer"].includes(role)) return { ok: false, message: "Unknown role." };
    const { data: added, error } = await db
      .from("dashboard_members")
      // Re-adding a removed member revives the same row (unique account_id, email).
      .upsert({ account_id: accountId, email, role, removed_at: null, removed_by: null }, { onConflict: "account_id,email" })
      .select("id")
      .single();
    if (error) return { ok: false, message: `Could not add ${email}: ${error.message}` };
    if (role === "owner") {
      const e = await clearScope(db, { memberId: added.id as string, by: "nomada" });
      if (e) return { ok: false, message: `${email} is owner, but still limited to some clients: ${e}` };
    }
  }
  revalidatePath("/admin/tracking");
  return { ok: true, message: remove ? `${email} removed.` : `${email} is ${role}.` };
}

/** An account's upgrade prompts: nomada (default), agency (asks the agency, no tier names) or off. */
export async function setUpsell(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const accountId = text(form, "account");
  const setting = upsellSetting(text(form, "mode"), text(form, "contact"));
  if ("error" in setting) return { ok: false, message: setting.error };
  const db = supabaseAdmin();
  const { error } = await db.from("accounts").update({ upsell_mode: setting.mode, upsell_contact_email: setting.contact }).eq("id", accountId);
  if (error) return { ok: false, message: `Could not save the prompt mode: ${error.message}` };
  revalidatePath("/admin/tracking");
  return { ok: true, message: setting.mode === "agency" ? `Agency mode; asks go to ${setting.contact}.` : `Prompts: ${setting.mode}.` };
}

/**
 * "Run now" - the only manual spend. Opens today's run if there is none and
 * posts it down the same signed path the cron uses. A run already running or
 * finished today is left alone by the run route's claim.
 *
 * Today's failed, partial or stalled run is re-run (9 Oct 2026, audit
 * reliability-4): requestRerun refuses it under the switch and the cap, or
 * asks for it by a compare-and-swap that writes only a marker, and it is
 * dispatched like any run; the runner claims the ask and reads again only
 * what did not come back (rerun.ts). Until that pass closes, the run's status
 * and error line are what they were, so a dispatch that fails here, a re-run
 * never claimed and one the platform kills all leave the day as it was
 * (review of b2e0019). A complete run, or one still reading inside 15
 * minutes, is refused as before. Posting twice dispatches twice and the
 * claim reads once.
 */
export async function runNow(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const clientId = text(form, "client");
  const db = supabaseAdmin();
  const day = trackingDay();

  const { data: client, error: cErr } = await db.from("client_domains").select("id, tier").eq("id", clientId).single();
  if (cErr) return { ok: false, message: `Could not read the client: ${cErr.message}` };
  const { data: qs, error: qErr } = await db
    .from("tracked_questions")
    .select("added_on, stopped_on")
    .eq("client_domain_id", clientId);
  if (qErr) return { ok: false, message: `Could not read the prompts: ${qErr.message}` };
  if (!(qs ?? []).some((q) => liveOn(q as { added_on: string; stopped_on: string | null }, day))) {
    return { ok: false, message: "No prompt is live today - new prompts start at the next daily check." };
  }

  const engines = [...enginesFor((client.tier as TierKey) ?? "tracked")];
  const { error: iErr } = await db
    .from("tracking_runs")
    .upsert({ client_domain_id: clientId, run_date: day, engines }, { onConflict: "client_domain_id,run_date", ignoreDuplicates: true });
  if (iErr) return { ok: false, message: `Could not open today's run: ${iErr.message}` };
  const { data: run, error: rErr } = await db
    .from("tracking_runs")
    .select("id, run_date, status, error, started_at, step_ms")
    .eq("client_domain_id", clientId)
    .eq("run_date", day)
    .single();
  if (rErr) return { ok: false, message: `Could not read today's run: ${rErr.message}` };
  const rerun = run.status !== "queued";
  if (rerun) {
    const asked = await requestRerun(
      { id: run.id as string, run_date: run.run_date as string, status: run.status as string, error: (run.error as string | null) ?? null, started_at: (run.started_at as string | null) ?? null, step_ms: run.step_ms },
      day,
    ).catch((err: unknown) => ({ ok: false as const, message: `Could not ask for a re-run: ${err instanceof Error ? err.message : String(err)}` }));
    if (!asked.ok) return { ok: false, message: asked.message };
  }

  try {
    await dispatchTrackingRun(run.id as string);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, message: rerun ? `Dispatch failed: ${why}. Today's run is as it was, and ${RERUN_BUTTON} asks again.` : `Dispatch failed: ${why}` };
  }
  revalidatePath("/admin/tracking");
  return { ok: true, message: rerun ? "Re-run dispatched: it reads again only what did not come back. Refresh in a few minutes." : "Run dispatched. Refresh in a few minutes." };
}
