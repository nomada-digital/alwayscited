import type { Metadata } from "next";

import { T } from "@/config/tokens";
import { ActionForm } from "@/app/admin/tracking/ActionForm";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";
import { scanReadiness } from "@/lib/scan/readiness";
import { SETTINGS_FALLBACK } from "@/lib/scan/settings";
import { anthropicCallsSince } from "@/lib/scan/spend";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

import { addKeyword } from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Scan operations",
  robots: { index: false, follow: false },
};

/**
 * The ops page on the shared tokens.
 *
 * This was the last object in the tree still defining its own palette - navy
 * #0B1220 and a lilac tint, from before the redesign. It is a noindex ops page
 * so nobody was going to notice, which is exactly why it sat there after the
 * migration was called finished.
 *
 * Kept as a named alias rather than rewritten through forty call sites: the
 * point is that there is one palette, not that this file spells it `T`.
 */
const C = {
  navy: T.ink,
  body: T.soft,
  muted: T.soft,
  border: T.line,
  soft: T.bg,
  purple: T.accent,
  red: T.badFg,
  green: T.goodFg,
  /**
   * The status amber, on the token since 24 September 2026.
   *
   * It was `#92400E`, written twice by hand beside this object, and
   * `palette.test.mts` rule 6 existed to stop anyone "tidying" it onto
   * `T.warnFg` - because the token measured 3.78 on white against this
   * value's 7.09, so the obvious fix was a contrast regression. Danny
   * answered blocked.md 9 and `T.warnFg` is #a95912 now, which clears AA at
   * 5.09. The reason not to merge was the measurement, the measurement has
   * moved, so the merge is right and rule 6 went with it.
   */
  amber: T.warnFg,
};

type ScanRow = {
  id: string;
  public_token: string;
  domain: string;
  topic: string | null;
  cluster_keyword: string | null;
  cluster_keyword_status: string | null;
  market: string | null;
  status: string;
  step: string | null;
  error: string | null;
  engines: string[] | null;
  engines_answered: string[] | null;
  gated_status: string | null;
  dfs_calls: number;
  dfs_cost: number | string | null;
  anthropic_calls: number;
  unlocked_at: string | null;
  created_at: string;
  completed_at: string | null;
  /** Per-phase elapsed in ms, written by the pipeline. Null before 20 Sep 2026. */
  step_ms: Record<string, number> | null;
};

function money(n: number): string {
  return `$${n.toFixed(4)}`;
}

function when(iso: string | null): string {
  if (!iso) return "-";
  return iso.replace("T", " ").slice(0, 16);
}

function seconds(row: ScanRow): string {
  if (!row.completed_at) return "-";
  const ms = new Date(row.completed_at).getTime() - new Date(row.created_at).getTime();
  return `${Math.round(ms / 1000)}s`;
}

/**
 * Where a scan's time actually went, under its wall clock.
 *
 * The figure beside this is `completed_at - created_at`, which includes every
 * minute the row sat waiting for a visitor to confirm the topic. `step_ms` is
 * the pass itself, phase by phase, and the two answer different questions - so
 * both are shown rather than one replacing the other.
 *
 * Rendered from whatever keys the row carries rather than from a list typed
 * here. The phases are expected to change as the pipeline does, and a typed
 * list would quietly stop showing the one that was added - which is the whole
 * failure this column exists to end. `total` is pulled to the front because it
 * is the one key that is not a phase; the rest keep their stored order, which
 * is the order the pipeline wrote them in.
 *
 * Null is a scan that ran before 20 September 2026, or one that died before it
 * could write. Both print nothing, which is honest: neither is a zero.
 */
function Phases({ ms }: { ms: Record<string, number> | null }) {
  if (!ms) return null;
  const entries = Object.entries(ms).filter(([, v]) => typeof v === "number");
  if (!entries.length) return null;
  const total = entries.find(([k]) => k === "total");
  const phases = entries.filter(([k]) => k !== "total");
  const say = ([k, v]: [string, number]) => `${k} ${(v / 1000).toFixed(1)}s`;
  return (
    <span style={{ display: "block", color: C.muted, fontSize: "0.7rem" }}>
      {[...(total ? [total] : []), ...phases].map(say).join(" · ")}
    </span>
  );
}

/**
 * How many of a scan's cited domains have a kind stored.
 *
 * Source classification is wrapped in never-fatal, so a classification call
 * that fails takes the placement list with it and says nothing anywhere: the
 * scan completes, the report renders, and the half a visitor trades an email
 * for is simply absent. Three live scans in production cite 1083 pages between
 * them and classify none.
 *
 * A gap of a few is ordinary - a batch that failed leaves its domains
 * deliberately unassessed for the next pass rather than inventing a verdict.
 * Nothing sorted at all is the failure, so that is the only state coloured.
 */
type Coverage = { scan_id: string; cited_domains: number; classified_domains: number };

function Sources({ c }: { c?: Coverage }) {
  if (!c) return <span style={{ color: C.muted }}>-</span>;
  if (!c.cited_domains) return <span style={{ color: C.muted }}>-</span>;
  const none = c.classified_domains === 0;
  return (
    <span style={{ color: none ? C.red : C.body }}>
      {c.classified_domains}/{c.cited_domains}
      {none && (
        <span style={{ display: "block", fontSize: "0.75rem" }}>none sorted</span>
      )}
    </span>
  );
}
function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ background: C.soft, border: `1px solid ${C.border}`, borderRadius: 16, padding: "1.125rem 1.25rem" }}>
      <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.002em", color: C.muted }}>
        {label}
      </p>
      <p style={{ margin: "0.375rem 0 0", fontSize: "1.5rem", fontWeight: 700, color: tone ?? C.navy, letterSpacing: "-0.02em" }}>
        {value}
      </p>
    </div>
  );
}

function Readiness() {
  const { ready, missingRequired, missingRecommended } = scanReadiness();
  if (ready && missingRecommended.length === 0) return null;

  const rows = [
    ...missingRequired.map((r) => ({ ...r, blocking: true })),
    ...missingRecommended.map((r) => ({ ...r, blocking: false })),
  ];

  return (
    <div
      style={{
        marginTop: "1.25rem",
        padding: "1rem 1.25rem",
        background: missingRequired.length ? "rgba(245,158,11,0.10)" : C.soft,
        border: `1px solid ${missingRequired.length ? "rgba(245,158,11,0.35)" : C.border}`,
        borderRadius: 14,
      }}
    >
      <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: C.navy }}>
        {missingRequired.length
          ? "The live checker is switched off until these are set"
          : "Running live. These are still worth setting"}
      </p>
      {missingRequired.length > 0 && (
        <p style={{ margin: "0.375rem 0 0", fontSize: "0.8125rem", color: C.body, lineHeight: 1.6 }}>
          Visitors see the request form instead, which captures the domain and an address and reports
          nothing. Nothing is fabricated while these are missing.
        </p>
      )}
      <ul style={{ margin: "0.75rem 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
        {rows.map((r) => (
          <li key={r.key} style={{ fontSize: "0.8125rem", color: C.body }}>
            <code style={{ fontWeight: 700, color: r.blocking ? C.amber : C.navy }}>{r.key}</code>
            <span style={{ color: C.muted }}> &mdash; {r.why}</span>
            {!r.blocking && <span style={{ color: C.muted }}> (optional)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function AdminScansPage() {
  if (!supabaseConfigured()) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", color: C.navy }}>Scan operations</h1>
        <p style={{ color: C.body }}>
          The database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload.
        </p>
        <Readiness />
      </div>
    );
  }

  const db = supabaseAdmin();
  // This page is force-dynamic and its whole job is "the last 24 hours", so
  // reading the clock here is deliberate rather than an accidental impurity.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: today, error: todayErr },
    { data: recent, error: recentErr },
    { data: settings, error: settingsErr },
    modelCalls,
  ] = await Promise.all([
    db.from("scans").select("status, dfs_calls, dfs_cost, anthropic_calls, unlocked_at").gte("created_at", since),
    db
      .from("scans")
      .select(
        "id, public_token, domain, topic, cluster_keyword, cluster_keyword_status, market, status, step, error, engines, engines_answered, gated_status, dfs_calls, dfs_cost, anthropic_calls, unlocked_at, created_at, completed_at, step_ms",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("app_settings").select("key, value"),
    // Read through the same function the start route enforces with, rather
    // than summed off the rows above. Those rows are scans, and the day's
    // model bill is no longer only scans: an attempt that failed before its
    // row existed is a debit, and a tile that showed a smaller number than
    // the ceiling it is printed against would be the one place you would
    // look to find out why scans had stopped and be told nothing.
    anthropicCallsSince(since),
  ]);

  /**
   * A read that failed must not print as a measurement on the page you come to
   * when you suspect something is wrong.
   *
   * All three errors were discarded. The day summary then read `0 / 200` scans
   * and `$0.0000 / $60` spent - which is what a quiet day looks like, and is the
   * single most reassuring pair of numbers on this page - and the settings read
   * is worse than reassuring: `enabled` is `setting("scans_enabled") !== false`,
   * so an unreadable settings table renders the kill switch as **on** and
   * suppresses the "scans are switched off" banner. That is the same failure
   * direction settings.ts is written around, on the surface an operator checks
   * to find out whether the switch took.
   *
   * Not fatal, following the rule already written beside the coverage read: a
   * number we could not get shows as a dash and everything else on the page
   * still answers. What changes is that the dash exists at all, and that the
   * page says which read is missing rather than leaving a zero to be believed.
   */
  const failedReads = [
    todayErr ? "the last 24 hours" : null,
    recentErr ? "the last 50 runs" : null,
    settingsErr ? "app_settings" : null,
  ].filter((s): s is string => Boolean(s));
  for (const [what, err] of [
    ["the day summary", todayErr],
    ["the recent runs", recentErr],
    ["app_settings", settingsErr],
  ] as const) {
    if (err) console.error("[admin] could not read " + what + ": " + err.message);
  }

  const rows = (today ?? []) as Array<Pick<ScanRow, "status" | "dfs_calls" | "dfs_cost" | "anthropic_calls" | "unlocked_at">>;
  const scans = (recent ?? []) as ScanRow[];

  /**
   * Counted in the database rather than here. Citations are the one per-scan
   * table with no small bound - 564 on one scan in production - so fifty scans
   * is tens of thousands of rows and past the PostgREST ceiling besides.
   *
   * A read that fails leaves the map empty and every cell reads a dash, which
   * is what an ops page should do with a number it could not get. It must not
   * take the page down: everything else on it still answers.
   */
  const coverage = new Map<string, Coverage>();
  if (scans.length) {
    const { data: cov, error: covErr } = await db.rpc("scan_source_coverage", {
      p_scans: scans.map((r) => r.id),
    });
    if (covErr) {
      console.warn("[admin] could not read source coverage: " + covErr.message);
    }
    for (const c of (cov ?? []) as Coverage[]) coverage.set(c.scan_id, c);
  }

  // The question this answers is how often classification fails, because one in
  // fifty and one in five want different responses.
  const unsorted = scans.filter((r) => {
    const c = coverage.get(r.id);
    return c && c.cited_domains > 0 && c.classified_domains === 0;
  }).length;

  const total = rows.length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const unlocked = rows.filter((r) => r.unlocked_at).length;
  const dfsCalls = rows.reduce((a, r) => a + (r.dfs_calls ?? 0), 0);
  const dfsCost = rows.reduce((a, r) => a + Number(r.dfs_cost ?? 0), 0);

  const setting = (key: string) => (settings ?? []).find((s) => s.key === key)?.value;
  const enabled = setting("scans_enabled") !== false;
  const cap = Number(setting("daily_scan_cap") ?? 200);
  const costCap = Number(setting("daily_cost_cap_usd") ?? 60);
  // The model ceiling reads its default from the same place the server does,
  // so an unset row shows the number the start route is actually enforcing
  // rather than a second copy of it typed here.
  const callCap = Number(setting("anthropic_calls_per_day") ?? SETTINGS_FALLBACK.anthropic_calls_per_day);
  const freeEngines = (setting("scan_engines_free") as string[] | undefined) ?? [];
  const gatedEngines = (setting("scan_engines_gated") as string[] | undefined) ?? [];

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "0.5rem 0.625rem",
    fontSize: "0.75rem",
    letterSpacing: "0.002em",
    color: C.muted,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "0.5rem 0.625rem",
    fontSize: "0.8125rem",
    color: C.body,
    borderBottom: `1px solid ${C.border}`,
    verticalAlign: "top",
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: C.navy, letterSpacing: "-0.03em", margin: 0 }}>
        Scan operations
      </h1>
      <p style={{ color: C.body, marginTop: "0.375rem" }}>
        Last 24 hours. Cost is what DataForSEO reported per task, so it reconciles against their dashboard.
      </p>
      <p style={{ color: C.muted, marginTop: "0.375rem", fontSize: "0.875rem" }}>
        Free scan reads {freeEngines.join(", ") || "nothing"}. An email additionally runs{" "}
        {gatedEngines.join(", ") || "nothing"} over the same questions.
      </p>

      <Readiness />
      {/* Luke, 3 Nov 2026: an older scan, or one whose keyword was not picked, gains a keyword and its
          Google position on the same link. lib/scan/cluster-keyword.ts addClusterKeyword. */}
      <section style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", border: `1px solid ${C.border}`, borderRadius: 16 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, color: C.navy, margin: 0 }}>Add a keyword to a scan</h2>
        <p style={{ color: C.muted, margin: "0.375rem 0 0.25rem", fontSize: "0.8125rem" }}>
          Picks the Google keyword and reads the position, on the same link, so a shared report shows them. The AI
          answers are kept. A scan that already has a keyword only has its position read again. About $0.10.
        </p>
        <ActionForm action={addKeyword} submit="Add keyword">
          <input
            name="scan"
            maxLength={ADMIN_LIMITS.scan}
            placeholder="alwayscited.com/scan/..."
            aria-label="Scan link"
            style={{ padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 340, fontSize: "13px" }}
          />
        </ActionForm>
      </section>

      {failedReads.length > 0 && (
        <p
          style={{
            marginTop: "1.25rem",
            padding: "0.75rem 1rem",
            background: "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.35)",
            borderRadius: 12,
            color: C.red,
            fontSize: "0.875rem",
          }}
        >
          Could not read {failedReads.join(" or ")}. The figures below that come from{" "}
          {failedReads.join(" or ")} are missing rather than zero
          {settingsErr ? ", and the ceilings and the scans_enabled switch are the built-in defaults, not what is stored" : ""}
          . Reload before acting on anything here.
        </p>
      )}

      {!settingsErr && !enabled && (
        <p
          style={{
            marginTop: "1.25rem",
            padding: "0.75rem 1rem",
            background: "rgba(245,158,11,0.12)",
            border: "1px solid rgba(245,158,11,0.35)",
            borderRadius: 12,
            color: C.amber,
            fontSize: "0.875rem",
          }}
        >
          Scans are switched off. New scans are refused until scans_enabled is set back to true in app_settings.
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.75rem",
          marginTop: "1.5rem",
        }}
      >
        {/* A dash where the read failed. Every one of these is derived from
            `today`, so without it each would print the number a quiet day
            prints, and a quiet day is the thing you would most want to be
            told this is not. */}
        <Tile label="Scans today" value={todayErr ? `- / ${cap}` : `${total} / ${cap}`} />
        <Tile
          label="Spend today"
          value={todayErr ? `- / $${costCap}` : `${money(dfsCost)} / $${costCap}`}
          tone={!todayErr && dfsCost > costCap * 0.8 ? C.red : undefined}
        />
        <Tile label="Unlocked" value={todayErr ? "-" : String(unlocked)} tone={C.purple} />
        <Tile
          label="Failed"
          value={todayErr ? "-" : String(failed)}
          tone={todayErr ? undefined : failed ? C.red : C.green}
        />
        <Tile label="DataForSEO calls" value={todayErr ? "-" : String(dfsCalls)} />
        <Tile label="DataForSEO cost" value={todayErr ? "-" : money(dfsCost)} />
        <Tile
          label="Model calls"
          value={`${modelCalls} / ${callCap}`}
          tone={modelCalls > callCap * 0.8 ? C.red : undefined}
        />
        <Tile label="Cost per scan" value={todayErr || !total ? "-" : money(dfsCost / total)} />
      </div>

      <h2 style={{ fontSize: "1rem", fontWeight: 700, color: C.navy, marginTop: "2.5rem", marginBottom: "0.75rem" }}>
        Last 50 runs
      </h2>
      <p style={{ color: unsorted ? C.red : C.muted, margin: "-0.5rem 0 0.75rem", fontSize: "0.8125rem" }}>
        Sources is how many of the domains the engines cited have a kind stored.
        {unsorted > 0
          ? " " + unsorted + " of these cited sources and sorted none of them, so each derived no placements and said so on the report."
          : " Every run here that cited a source sorted at least one."}
      </p>
      <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th}>Started</th>
              <th style={th}>Domain</th>
              <th style={th}>Topic</th>
              <th style={th}>Market</th>
              <th style={th}>Engines</th>
              <th style={th}>Status</th>
              <th style={th}>Took</th>
              <th style={th}>DFS</th>
              <th style={th}>Cost</th>
              <th style={th}>Model</th>
              <th style={th}>Sources</th>
              <th style={th}>Email</th>
            </tr>
          </thead>
          <tbody>
            {scans.length === 0 && (
              <tr>
                <td style={td} colSpan={12}>
                  No scans yet.
                </td>
              </tr>
            )}
            {scans.map((r) => (
              <tr key={r.public_token}>
                <td style={td}>{when(r.created_at)}</td>
                <td style={{ ...td, color: C.navy, fontWeight: 600 }}>
                  <a href={"/scan/" + r.public_token} style={{ color: C.navy }}>{r.domain}</a>
                </td>
                <td style={td}>
                  {r.topic ?? "-"}
                  <span style={{ display: "block", color: C.muted, fontSize: "0.75rem" }}>
                    {r.cluster_keyword_status === "chosen" ? "keyword: " + r.cluster_keyword : r.cluster_keyword_status ? "no keyword picked" : "before keywords"}
                  </span>
                  {r.status === "complete" && r.cluster_keyword_status !== "chosen" ? (
                    <ActionForm action={addKeyword} submit="Add keyword">
                      <input type="hidden" name="scan" value={r.public_token} maxLength={ADMIN_LIMITS.scan} />
                    </ActionForm>
                  ) : null}
                </td>
                <td style={td}>{r.market ?? "-"}</td>
                <td style={td}>
                  {/* Both lengths RAW - not filtered to the union and not
                      deduped, deliberately, and this comment is why. Every
                      other reader of these columns goes through `knownEngines`
                      (`engine-list-readers.test.mts` walks for the ones that
                      do not), because a repeated name on a row made the
                      campaign headline count one answer twice and the waiting
                      screen draw the same chip twice. This is the page an
                      operator opens to SEE that row, so cleaning the figure
                      here would hide the one thing it is for: a 4/5 that
                      should read 4/4 is the symptom. Exempt by argument, not
                      by oversight. */}
                  {(r.engines_answered ?? []).length}/{(r.engines ?? []).length}
                  {r.gated_status && r.gated_status !== "none" ? (
                    <span style={{ display: "block", color: C.muted, fontSize: "0.75rem" }}>
                      gated {r.gated_status}
                    </span>
                  ) : r.unlocked_at ? (
                    /* An email was traded and the gated pass never started: the
                       cost cap turned it away, or the claim update lost its
                       race. "none" after an unlock was indistinguishable from
                       "no gated engines configured" on this page, so the one
                       state an operator would want to act on was the one it
                       did not show. */
                    <span style={{ display: "block", color: C.red, fontSize: "0.75rem" }}>
                      gated not started
                    </span>
                  ) : null}
                </td>
                <td style={{ ...td, color: r.status === "failed" ? C.red : r.status === "complete" ? C.green : C.body }}>
                  {r.status}
                  {r.step ? ` · ${r.step}` : ""}
                  {r.error ? (
                    <span style={{ display: "block", color: C.muted, fontSize: "0.75rem" }}>{r.error}</span>
                  ) : null}
                </td>
                <td style={td}>
                  {seconds(r)}
                  <Phases ms={r.step_ms} />
                </td>
                <td style={td}>{r.dfs_calls}</td>
                <td style={td}>{money(Number(r.dfs_cost ?? 0))}</td>
                <td style={td}>{r.anthropic_calls}</td>
                <td style={td}>
                  <Sources c={coverage.get(r.id)} />
                </td>
                <td style={td}>{r.unlocked_at ? "yes" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
