import type { Metadata } from "next";
import { redirect } from "next/navigation";

import TierName from "@/components/TierName";
import { fullDay } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { dashFixturePath } from "@/lib/dash/fixture";
import { pageData } from "@/lib/dash/page-data";
import { showsInsertions, showsPlacements } from "@/lib/links/gate";
import { type LinkRow, readLinks } from "@/lib/links/sheet-store";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your links", robots: { index: false, follow: false } };

/**
 * Link insertions and Placements (Danny, 29 Oct 2026). The links we secure and place for the client, read from the
 * trackers our link team keeps (lib/links/sheet-store.ts, synced from Google Sheets by the agency hub). Placements on
 * alwaysmentioned and up; link insertions on the alwayscited plan and up (gate.ts).
 *
 * Only what the sheet holds is shown: a column the sheet lacks is an empty cell, never a figure made up, and no
 * price or cost column is ever read (sheet-parse.ts). Domain authority is labelled DR or DA as the sheet's own
 * column is. Insertions are "secured", never bought.
 */
export default async function Links({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw, ws, base } = await pageData(slug);
  const tier = ws.client.tier;
  if (!showsPlacements(tier)) redirect(`${base}/${slug}/plan`);
  const read = dashFixturePath()
    ? { rows: [] as LinkRow[], syncedAt: { insertion: null, placement: null } }
    : await readLinks(supabaseAdmin(), raw.client.id).catch((err: unknown) => {
        console.warn(`[dash] links read failed: ${err instanceof Error ? err.message : String(err)}`);
        return { rows: [] as LinkRow[], syncedAt: { insertion: null, placement: null } };
      });
  const insertions = read.rows.filter((r) => r.kind === "insertion");
  const placements = read.rows.filter((r) => r.kind === "placement");
  const withInsertions = showsInsertions(tier);
  return (
    <>
      <PageHead
        micro={<>Your plan · <TierName tier={tier} /></>}
        title="Your links"
        intro={withInsertions ? "Every placement we have published for you and every link insertion we have secured, with where it sits, what it points at and how strong the linking site is." : "Every placement we have published for you, with where it sits, what it points at and how strong the linking site is."}
      />
      <div className="dash-grid k2" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Placements</div><div className="v">{placements.length}</div><div className="s">{liveCount(placements)}</div></div>
        {withInsertions ? <div className="kpi"><div className="l">Link insertions secured</div><div className="v">{insertions.length}</div><div className="s">{liveCount(insertions)}</div></div> : null}
      </div>
      <LinkTable
        title="Placements"
        intro="Articles and listicles on other sites that feature you, with a link to your site."
        rows={placements}
        syncedAt={read.syncedAt.placement}
      />
      {withInsertions ? (
        <LinkTable
          title="Link insertions"
          intro="Links to your site secured inside existing, already-ranking articles on other sites."
          rows={insertions}
          syncedAt={read.syncedAt.insertion}
        />
      ) : null}
    </>
  );
}

function liveCount(rows: LinkRow[]): string {
  if (!rows.length) return "None yet";
  const withStatus = rows.filter((r) => r.status);
  if (!withStatus.length) return `${rows.length} published`;
  const live = withStatus.filter((r) => /^live\b/i.test(r.status!)).length;
  return `${live} live`;
}

/** DR, DA, or both when the sheet mixes them: the label is always the source column's own. */
function authorityHead(rows: LinkRow[]): string {
  const labels = [...new Set(rows.map((r) => r.authority_label).filter(Boolean))];
  return labels.length === 1 ? labels[0]! : labels.length ? "DR / DA" : "DR / DA";
}

function LinkTable({ title, intro, rows, syncedAt }: { title: string; intro: string; rows: LinkRow[]; syncedAt: string | null }) {
  const head = authorityHead(rows);
  const mixed = head === "DR / DA";
  return (
    <section className="dash-card" aria-label={title}>
      <div className="dash-card-head">
        <div>
          <h2>{title}</h2>
          <p className="intro">{intro}</p>
        </div>
        {syncedAt ? <span className="muted" style={{ fontSize: 12 }}>Updated {fullDay(syncedAt.slice(0, 10))}</span> : null}
      </div>
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Live URL</th>
                <th>Target keyword</th>
                <th>Anchor text</th>
                <th>Target page</th>
                <th className="r">{head}</th>
                <th className="r">Page traffic</th>
                <th>Status</th>
                <th className="r">Date live</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.url_key}>
                  <td>
                    <a href={r.live_url} target="_blank" rel="noopener noreferrer">{r.linking_domain ?? ""}</a>
                    <div className="sub" title={r.live_url}>{shortPath(r.live_url)}</div>
                  </td>
                  <td>{r.target_keyword ?? ""}</td>
                  <td>{r.anchor_text ?? ""}</td>
                  <td>{r.target_page ? <a href={r.target_page} target="_blank" rel="noopener noreferrer">{shortPath(r.target_page, true)}</a> : ""}</td>
                  <td className="r num">{r.authority === null ? "" : `${fmt(r.authority)}${mixed && r.authority_label ? ` ${r.authority_label}` : ""}`}</td>
                  <td className="r num">{r.page_traffic === null ? "" : fmt(r.page_traffic)}</td>
                  <td>{r.status ? <span className={`pill${/^live\b/i.test(r.status) ? " good" : ""}`}>{r.status}</span> : ""}</td>
                  <td className="r num">{r.live_on ? fullDay(r.live_on) : (r.live_month ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <b>First links go live soon</b>
          Each one shows here, with its page and figures, once it is live.
        </div>
      )}
    </section>
  );
}

const fmt = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

/** The page's path without the scheme or www, so a long URL reads as where it is. */
function shortPath(url: string, withHost = false): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return withHost ? `${u.hostname.replace(/^www\./, "")}${path === "/" ? "" : path}` : path;
  } catch {
    return url;
  }
}
