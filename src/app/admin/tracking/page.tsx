import type { Metadata } from "next";

import { T } from "@/config/tokens";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { ADMIN_LIMITS, UPSELL_MODES, trackingDay } from "@/lib/tracking/decide";
import { PROMPTS_PER_CLUSTER, type Subject, namesBrandIn, trackingCounts } from "@/lib/tracking/limits";
import { readScopes, sees } from "@/lib/tracking/scope";
import { RERUN_BUTTON, rerunLine } from "@/lib/tracking/rerun";
import { type HealthRun, RUN_STATES, type RunHealth, STATE_WORDS, readRunHealth, runState } from "@/lib/tracking/run-health";
import { SETUP_CONFIRMED_EVENT, setupState } from "@/lib/tracking/setup-landing";

import { ActionForm } from "./ActionForm";
import PlanSignals from "./PlanSignals";
import { addTracked, createClientFromScan, editTracked, groupCluster, runNow, setMember, setUpsell, stopTracked } from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Tracking operations",
  robots: { index: false, follow: false },
};

/**
 * /admin/tracking - T2 of docs/tracked-dashboard-2026-09-29/BRIEF.md (Danny,
 * 29 Sep 2026). Behind the /admin Basic auth. Until Stripe exists, this is
 * how an alwaystracked client is made: from a finished scan, then Nomada adds
 * questions and keywords up to the limit, and the members who can log in.
 *
 * Lists only clients set up here (a slug is set by the create action), so the
 * rows client_domains held before tracking are never shown or tracked.
 *
 * Today's runs head the page (9 Oct 2026, audit reliability-6): run-health.ts
 * readRunHealth, the reading the summary mail and /api/health/runs make, so
 * the three cannot disagree. A run left `running` past 15 minutes reads as
 * stalled here rather than "running $0.00" until the 03:45 sweep, and "Run
 * now" on a failed, partial or stalled run re-reads what did not come back
 * (audit reliability-4, rerun.ts), with where that re-run is beside it. The
 * prompt, keyword, run and cluster reads are paged (audit reliability-2;
 * clusters from the review of 348abbd): every client's rows in one select
 * stop at PostgREST's thousand.
 */

const input = {
  padding: "6px 8px",
  border: `1px solid ${T.line}`,
  borderRadius: "6px",
  fontSize: "13px",
  color: T.ink,
  background: T.surface,
} as const;

const money = (n: number) => `$${n.toFixed(2)}`;

type Row = Record<string, unknown>;

/** Every page of a read, with the page's own message when one fails. */
const all = <R,>(what: string, page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>) =>
  selectAll<R>(page).catch((err: unknown) => {
    throw new Error(`could not read ${what}: ${err instanceof Error ? err.message : String(err)}`);
  });

export default async function TrackingAdmin() {
  if (!supabaseConfigured()) return <div style={{ padding: "40px" }}>Database not configured.</div>;
  const db = supabaseAdmin();
  const now = Date.now();
  const today = trackingDay(new Date(now));
  const since = new Date(now - 14 * 86_400_000).toISOString().slice(0, 10);

  const { data: clients, error: cErr } = await db
    .from("client_domains")
    // question_limit and keyword_limit are no longer read: the allowance is cluster_limit (BRIEF-3 C2, limits.ts).
    .select("id, account_id, domain, brand_name, brand_aliases, market, tier, status, started_on, cluster_limit, slug")
    .not("slug", "is", null)
    .order("created_at", { ascending: true });
  if (cErr) throw new Error(`could not read tracked clients: ${cErr.message}`);
  const ids = (clients ?? []).map((c) => c.id as string);
  const accounts = [...new Set((clients ?? []).map((c) => c.account_id as string))];

  const [
    questions,
    keywords,
    runsById,
    health,
    { data: members, error: mErr },
    { data: accountRows, error: acErr },
    clustersById,
    { data: setups, error: sErr },
  ] = await Promise.all([
    all<Row>("tracked questions", (from, to) => db.from("tracked_questions").select("id, client_domain_id, cluster_id, angle, text, source, added_on, stopped_on").in("client_domain_id", ids).order("id", { ascending: true }).range(from, to)),
    all<Row>("tracked keywords", (from, to) => db.from("tracked_keywords").select("id, client_domain_id, keyword, added_on, stopped_on").in("client_domain_id", ids).order("id", { ascending: true }).range(from, to)),
    all<Row>("tracking runs", (from, to) =>
      db
        .from("tracking_runs")
        .select("client_domain_id, run_date, status, dfs_cost, model_calls, error, created_at, started_at, finished_at, step_ms")
        .in("client_domain_id", ids)
        .gte("run_date", since)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Its own failure is shown on the strip, never the page's.
    readRunHealth(db, today, now).catch((err: unknown) => (err instanceof Error ? err.message : String(err))),
    db.from("dashboard_members").select("id, account_id, email, role").in("account_id", accounts).is("removed_at", null),
    db.from("accounts").select("id, upsell_mode, upsell_contact_email").in("id", accounts),
    all<Row>("clusters", (from, to) =>
      db
        .from("tracked_clusters")
        .select("id, client_domain_id, name, keyword_id, tier, started_on, stopped_on, created_at")
        .in("client_domain_id", ids)
        .is("stopped_on", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // R166 step 6: who confirmed setup, and when.
    db.from("dashboard_events").select("client_domain_id, created_at, member_email").in("client_domain_id", ids).eq("event", SETUP_CONFIRMED_EVENT),
  ]);
  // Newest day first, as the run list below reads them; paged by id.
  const runs = [...runsById].sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)));
  // Oldest first, as they were made; paged by id.
  const clusters = [...clustersById].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (mErr) throw new Error(`could not read dashboard members: ${mErr.message}`);
  // AG-1 (9 Oct 2026): a member limited to some clients is listed only under those.
  const scopes = await readScopes(db, (members ?? []).map((m) => m.id as string));
  if (acErr) throw new Error(`could not read accounts: ${acErr.message}`);
  if (sErr) throw new Error(`could not read setup confirms: ${sErr.message}`);

  const of = (rows: Row[] | null, id: string, key = "client_domain_id") => (rows ?? []).filter((r) => r[key] === id);

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px", color: T.ink, fontSize: "14px" }}>
      <h1 style={{ fontSize: "24px", margin: "0 0 4px" }}>Tracking</h1>
      <p style={{ color: T.soft, margin: "0 0 24px" }}>
        Daily check at 05:00 UTC. Today (London): {today}. Clients are made here from a finished scan.{" "}
        <a href="/admin/tracking/usage" style={{ color: T.ink }}>
          Dashboard usage
        </a>
      </p>

      <RunStrip health={health} today={today} />

      <PlanSignals db={db} clients={clients ?? []} clusters={clusters} keywords={keywords} />

      <section style={{ border: `1px solid ${T.line}`, borderRadius: "10px", padding: "16px", marginBottom: "24px" }}>
        <h2 style={{ fontSize: "16px", margin: "0 0 8px" }}>Create a client from a scan</h2>
        <ActionForm action={createClientFromScan} submit="Create client">
          <input name="scan" maxLength={ADMIN_LIMITS.scan} placeholder="Scan URL or token" style={{ ...input, width: "320px" }} aria-label="Scan URL or token" />
          <input name="email" maxLength={ADMIN_LIMITS.email} placeholder="Owner email" style={{ ...input, width: "220px" }} aria-label="Owner email" />
          <select name="tier" defaultValue="tracked" style={input} aria-label="Tier">
            <option value="tracked">alwaystracked</option>
            <option value="mentioned">alwaysmentioned</option>
            <option value="cited">alwayscited</option>
            <option value="everywhere">alwayseverywhere</option>
          </select>
        </ActionForm>
      </section>

      {(clients ?? []).length === 0 ? <p style={{ color: T.soft }}>No tracked clients yet.</p> : null}

      {(clients ?? []).map((c) => {
        const id = c.id as string;
        const qs = of(questions, id);
        const ks = of(keywords, id);
        const liveQ = qs.filter((q) => q.stopped_on === null);
        const liveK = ks.filter((k) => k.stopped_on === null);
        const n = trackingCounts({ clusterLimit: c.cluster_limit as number, today, prompts: qs as { added_on: string; stopped_on: string | null }[], keywords: ks as { stopped_on: string | null }[] });
        const rs = of(runs, id);
        const todayRun = rs.find((r) => r.run_date === today);
        const todayState = todayRun ? runState(todayRun as HealthRun, now) : null;
        const rerunnable = todayState === "failed" || todayState === "partial" || todayState === "stalled";
        // Where today's re-run is, if one was asked (rerun.ts): the run's own status stays as it was until it closes.
        const rerunNote = todayRun ? rerunLine(todayRun as { started_at: string | null; step_ms?: unknown }, now) : null;
        const cost14 = rs.reduce((n, r) => n + Number(r.dfs_cost ?? 0), 0);
        const ms = of(members, c.account_id as string, "account_id").filter((m) => sees(scopes.of.get(m.id as string), id));
        const account = (accountRows ?? []).find((a) => a.id === c.account_id);
        return (
          <section key={id} style={{ border: `1px solid ${T.line}`, borderRadius: "10px", padding: "16px", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", margin: "0 0 4px" }}>
              {c.domain as string} <span style={{ color: T.soft, fontWeight: 400 }}>/{c.slug as string} - {c.market as string} - {c.tier as string} - {c.status as string} - started {String(c.started_on ?? "-")} - {setupState({ started_on: (c.started_on as string | null) ?? null }, of(setups, id) as { created_at: string; member_email: string | null }[])}</span>
            </h2>
            <p style={{ margin: "0 0 8px", color: T.soft }}>
              Clusters allowed {c.cluster_limit as number} - prompts {n.prompts}/{n.promptLimit} ({n.checkedToday} live today) - keywords {n.keywords}/{n.keywordLimit} -today&apos;s run:{" "}
              {todayRun && todayState ? `${STATE_WORDS[todayState]} ${money(Number(todayRun.dfs_cost ?? 0))}${todayRun.error ? ` (${todayRun.error})` : ""}` : "none"} - 14 days {money(cost14)}
              {c.tier !== "tracked" ? (
                <>
                  {" - "}
                  <a href={`/admin/tracking/${c.slug as string}/placements`} style={{ color: T.ink }}>
                    Placements
                  </a>
                </>
              ) : null}
            </p>
            <ActionForm action={runNow} submit={rerunnable ? RERUN_BUTTON : "Run now"}>
              <input type="hidden" name="client" value={id} maxLength={ADMIN_LIMITS.id} />
              <span style={{ fontSize: "12.5px", color: T.soft }}>
                {rerunnable ? "Reads again only what did not come back today, under the same cap." : "The only manual spend."}
              </span>
              {todayRun && (todayState === "stuck" || todayState === "undispatched") ? (
                <span style={{ fontSize: "12.5px", color: T.ink, fontWeight: 700 }}>
                  stuck - queued since {String(todayRun.created_at).slice(11, 16)}Z and never claimed:{" "}
                  {(todayRun.error as string | null) ?? "no dispatch error recorded"}
                </span>
              ) : null}
              {todayRun && todayState === "stalled" ? (
                <span style={{ fontSize: "12.5px", color: T.ink, fontWeight: 700 }}>
                  stalled - running since {String(todayRun.started_at).slice(11, 16)}Z and never closed; the platform stopped it
                </span>
              ) : null}
              {rerunNote ? <span style={{ fontSize: "12.5px", color: T.ink }}>{rerunNote}</span> : null}
            </ActionForm>
            <ActionForm action={addTracked} submit="Add prompt">
              <input type="hidden" name="client" value={id} maxLength={ADMIN_LIMITS.id} />
              <input type="hidden" name="kind" value="question" maxLength={ADMIN_LIMITS.id} />
              <input name="value" maxLength={ADMIN_LIMITS.question} placeholder="A buyer prompt, ungrouped" style={{ ...input, width: "480px" }} aria-label="Prompt" />
            </ActionForm>
            <ActionForm action={addTracked} submit="Add keyword">
              <input type="hidden" name="client" value={id} maxLength={ADMIN_LIMITS.id} />
              <input type="hidden" name="kind" value="keyword" maxLength={ADMIN_LIMITS.id} />
              <input name="value" maxLength={ADMIN_LIMITS.keyword} placeholder="A Google keyword" style={{ ...input, width: "280px" }} aria-label="Keyword" />
            </ActionForm>
            <ClusterAdmin
              client={id}
              subject={{ brand: (c.brand_name as string | null) ?? null, domain: c.domain as string, aliases: (c.brand_aliases as string[] | null) ?? [] }}
              clusters={of(clusters, id)}
              prompts={liveQ}
              keywords={liveK}
            />
            <EditOrStop client={id} prompts={liveQ} keywords={liveK} />
            <div>
              <strong style={{ fontSize: "13px" }}>Members</strong>{" "}
              {ms
                .map((m) => {
                  const only = scopes.of.get(m.id as string)?.length;
                  return `${m.email as string} (${m.role as string}${only ? `, ${only === 1 ? "this client only" : `this and ${only - 1} more`}` : ""})`;
                })
                .join(", ") || "none"}
              <ActionForm action={setMember} submit="Save member">
                <input type="hidden" name="account" value={c.account_id as string} maxLength={ADMIN_LIMITS.id} />
                <input name="email" maxLength={ADMIN_LIMITS.email} placeholder="Email" style={{ ...input, width: "220px" }} aria-label="Member email" />
                <select name="role" defaultValue="editor" style={input} aria-label="Role">
                  <option value="owner">owner</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
                <label style={{ fontSize: "13px" }}>
                  <input type="checkbox" name="remove" value="1" maxLength={ADMIN_LIMITS.id} /> remove
                </label>
              </ActionForm>
            </div>
            <div style={{ marginTop: "8px" }}>
              <strong style={{ fontSize: "13px" }}>Upgrade prompts</strong>{" "}
              {String(account?.upsell_mode ?? "nomada")}
              {account?.upsell_contact_email ? ` - asks go to ${account.upsell_contact_email as string}` : ""}
              <ActionForm action={setUpsell} submit="Save prompts">
                <input type="hidden" name="account" value={c.account_id as string} maxLength={ADMIN_LIMITS.id} />
                <select name="mode" defaultValue={String(account?.upsell_mode ?? "nomada")} style={input} aria-label="Upgrade prompt mode">
                  {UPSELL_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m === "nomada" ? "nomada - brand sold direct" : m === "agency" ? "agency - ask the agency, no tier names" : "off - no prompts"}
                    </option>
                  ))}
                </select>
                <input name="contact" maxLength={ADMIN_LIMITS.email} defaultValue={(account?.upsell_contact_email as string | null) ?? ""} placeholder="Agency contact email" style={{ ...input, width: "220px" }} aria-label="Agency contact email" />
              </ActionForm>
            </div>
            {rs.length ? (
              <p style={{ margin: "8px 0 0", fontSize: "12.5px", color: T.soft }}>
                Last 14 days: {rs.map((r) => `${r.run_date as string} ${r.status as string} ${money(Number(r.dfs_cost ?? 0))}`).join(" - ")}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Today's runs across every client (9 Oct 2026, audit reliability-6): how
 * many should have run, each state's count, and every client not complete
 * with its error line - the summary mail's lines, on the page.
 */
function RunStrip({ health, today }: { health: RunHealth | string; today: string }) {
  const box = { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "12px 16px", marginBottom: "24px" } as const;
  if (typeof health === "string") {
    return (
      <section style={box}>
        <strong>Today&apos;s runs</strong> <span style={{ color: T.badFg }}>could not be read: {health}</span>
      </section>
    );
  }
  const looking = health.clients.filter((c) => c.state !== "complete");
  const tally = RUN_STATES.filter((s) => health.counts[s] > 0).map((s) => `${STATE_WORDS[s]} ${health.counts[s]}`);
  return (
    <section style={box}>
      <strong>Today&apos;s runs</strong>{" "}
      <span style={{ color: T.soft }}>
        ({today}) - {health.expected} should run{tally.length ? ` - ${tally.join(", ")}` : ""}
        {health.settled ? "" : " - still in flight"}
        {" - "}
        <a href="/api/health/runs" style={{ color: T.ink }}>
          health JSON
        </a>
      </span>
      {looking.length ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: "20px", fontSize: "13px" }}>
          {looking.map((c) => (
            <li key={c.id}>
              {c.domain}: <strong>{STATE_WORDS[c.state]}</strong>
              {c.error ? <span style={{ color: T.soft }}> - {c.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * R102 (Danny, 29 Sep 2026, danny.md line 94): each live prompt and keyword
 * with a text fix and a stop. The fix is refused server-side once the row has
 * a reading (admin-edit.ts), so the history never mixes two questions; stop
 * sets `stopped_on` to tomorrow and deletes nothing. Separate forms from the
 * cluster pickers above, which are one form each and cannot hold these.
 */
function EditOrStop({ client, prompts, keywords }: { client: string; prompts: Row[]; keywords: Row[] }) {
  const rows = [...prompts.map((q) => ({ kind: "prompt", id: q.id as string, value: q.text as string })), ...keywords.map((k) => ({ kind: "keyword", id: k.id as string, value: k.keyword as string }))];
  return (
    <details style={{ margin: "8px 0" }}>
      <summary>Fix or stop a prompt or keyword ({rows.length})</summary>
      <p style={{ margin: "4px 0", color: T.soft, fontSize: "12.5px" }}>Text fixes only before the first reading; after that, stop it and add a new one. Stop takes effect tomorrow and keeps its history.</p>
      {rows.map((r) => (
        <div key={`${r.kind}-${r.id}`} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", borderTop: `1px solid ${T.hair}` }}>
          <ActionForm action={editTracked} submit="Save text">
            <input type="hidden" name="client" value={client} maxLength={ADMIN_LIMITS.id} />
            <input type="hidden" name="kind" value={r.kind} maxLength={ADMIN_LIMITS.id} />
            <input type="hidden" name="id" value={r.id} maxLength={ADMIN_LIMITS.id} />
            <span style={{ fontSize: "12px", color: T.soft, width: "56px" }}>{r.kind}</span>
            <input name="value" defaultValue={r.value} maxLength={r.kind === "prompt" ? ADMIN_LIMITS.question : ADMIN_LIMITS.keyword} style={{ ...input, width: "440px" }} aria-label={`Text of ${r.kind}: ${r.value}`} />
          </ActionForm>
          <ActionForm action={stopTracked} submit="Stop">
            <input type="hidden" name="client" value={client} maxLength={ADMIN_LIMITS.id} />
            <input type="hidden" name="kind" value={r.kind} maxLength={ADMIN_LIMITS.id} />
            <input type="hidden" name="id" value={r.id} maxLength={ADMIN_LIMITS.id} />
          </ActionForm>
        </div>
      ))}
    </details>
  );
}

const angleShort = (a: unknown) => (a ? ` [${String(a)}]` : "");

/**
 * The cluster list and "Ungrouped" - BRIEF-3 C3 (Danny, 29 Sep 2026). A
 * cluster is one keyword and up to 5 prompts; ungrouped prompts and keywords
 * are still read daily and shown here only (R111). Grouping moves the rows,
 * so readings already taken stay with them.
 */
/** A live prompt that names the client's brand always names it; Nomada stops it and adds a buyer's version (30 Sep 2026). */
function BrandFlag({ text, subject }: { text: string; subject: Subject }) {
  return namesBrandIn(text, subject) ? <strong style={{ color: T.ink }}> - names the brand</strong> : null;
}

function ClusterAdmin({ client, subject, clusters, prompts, keywords }: { client: string; subject: Subject; clusters: Row[]; prompts: Row[]; keywords: Row[] }) {
  const linked = new Set(clusters.map((c) => c.keyword_id as string | null).filter(Boolean));
  const ungroupedQ = prompts.filter((q) => q.cluster_id === null);
  const ungroupedK = keywords.filter((k) => !linked.has(k.id as string));
  const pick = (
    <div style={{ display: "grid", gap: "2px", width: "100%" }}>
      {ungroupedQ.map((q) => (
        <label key={q.id as string} style={{ fontSize: "13px" }}>
          <input type="checkbox" name="prompt" value={q.id as string} maxLength={ADMIN_LIMITS.id} /> {q.text as string}
          <BrandFlag text={q.text as string} subject={subject} />
          <span style={{ color: T.soft }}>
            {" "}
            ({q.source as string}, from {q.added_on as string}){angleShort(q.angle)}
          </span>
        </label>
      ))}
    </div>
  );
  return (
    <details style={{ margin: "8px 0" }} open={ungroupedQ.length > 0}>
      <summary>
        Clusters {clusters.length} - prompts {prompts.length} ({ungroupedQ.length} ungrouped) - keywords {keywords.length} ({ungroupedK.length} ungrouped)
      </summary>
      {clusters.map((c) => {
        const qs = prompts.filter((q) => q.cluster_id === c.id);
        const kw = keywords.find((k) => k.id === c.keyword_id);
        return (
          <div key={c.id as string} style={{ borderLeft: `3px solid ${T.line}`, padding: "4px 0 4px 10px", margin: "8px 0" }}>
            <strong>{c.name as string}</strong>{" "}
            <span style={{ color: T.soft }}>
              - keyword {kw ? `${kw.keyword as string} (from ${kw.added_on as string})` : "none"} -{qs.length}/{PROMPTS_PER_CLUSTER} prompts - from {c.started_on as string}
            </span>
            <ol style={{ margin: "4px 0", paddingLeft: "20px" }}>
              {qs.map((q) => (
                <li key={q.id as string}>
                  {q.text as string} <span style={{ color: T.soft }}>({q.source as string}, from {q.added_on as string}){angleShort(q.angle)}</span>
                  <BrandFlag text={q.text as string} subject={subject} />
                </li>
              ))}
            </ol>
            {(!kw || qs.length < PROMPTS_PER_CLUSTER) && (ungroupedQ.length > 0 || !kw) ? (
              <ActionForm action={groupCluster} submit="Add to this cluster">
                <input type="hidden" name="client" value={client} maxLength={ADMIN_LIMITS.id} />
                <input type="hidden" name="cluster" value={c.id as string} maxLength={ADMIN_LIMITS.id} />
                {!kw ? <input name="keyword" maxLength={ADMIN_LIMITS.keyword} placeholder="Its Google keyword" style={{ ...input, width: "280px" }} aria-label="Cluster keyword" /> : null}
                {qs.length < PROMPTS_PER_CLUSTER ? pick : null}
              </ActionForm>
            ) : null}
          </div>
        );
      })}
      <div style={{ margin: "8px 0" }}>
        <strong style={{ fontSize: "13px" }}>Ungrouped</strong>{" "}
        <span style={{ color: T.soft, fontSize: "13px" }}>
          Still read daily; admin only.{ungroupedK.length ? ` Keywords: ${ungroupedK.map((k) => `${k.keyword as string} (from ${k.added_on as string})`).join(", ")}.` : ""}
        </span>
        {ungroupedQ.length ? (
          <ActionForm action={groupCluster} submit="New cluster">
            <input type="hidden" name="client" value={client} maxLength={ADMIN_LIMITS.id} />
            <input name="keyword" maxLength={ADMIN_LIMITS.keyword} placeholder="Its Google keyword" style={{ ...input, width: "280px" }} aria-label="New cluster keyword" />
            <span style={{ fontSize: "12.5px", color: T.soft }}>Pick up to {PROMPTS_PER_CLUSTER}; the rest stay ungrouped and running.</span>
            {pick}
          </ActionForm>
        ) : (
          <p style={{ margin: "4px 0", color: T.soft, fontSize: "13px" }}>No ungrouped prompts.</p>
        )}
      </div>
    </details>
  );
}
