import type { Metadata } from "next";

import { longDay } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { dashFixturePath } from "@/lib/dash/fixture";
import { pageData } from "@/lib/dash/page-data";
import { type GridView, loadGrids } from "@/lib/local/data";
import { type PointRead, rankBand } from "@/lib/local/grid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Map pack", robots: { index: false, follow: false } };

/**
 * Map pack geo-grids (22 Oct 2026). Each grid is one keyword read on Google
 * Maps from a square of points, weekly, inside the tracking run
 * (lib/local/run.ts). The latest full read is drawn point by point, with the
 * rank written in every cell so colour is never the only signal; the trend
 * and who holds the pack sit beside it.
 */
export default async function MapPack({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw } = await pageData(slug);
  const views = dashFixturePath() ? [] : await loadGrids(raw.client.id, raw.today).catch((err: unknown) => {
    console.warn(`[dash] grids read failed: ${err instanceof Error ? err.message : String(err)}`);
    return [] as GridView[];
  });
  return (
    <>
      <PageHead micro="Map pack · Google Maps" title="Where you show on the map" intro="Each grid reads one search on Google Maps from points across an area, once a week, because the map results change street by street. Every cell is where your listing ranked from that spot." />
      {views.length ? views.map((v) => <GridCard key={v.grid.id} view={v} />) : <div className="dash-card"><div className="empty"><b>No map grids yet</b>Grids are set up with your Google Business Profile, and the first read lands within a week.</div></div>}
    </>
  );
}

function cellLabel(p: PointRead, depth: number): string {
  return p.rank === null ? `${depth}+` : String(p.rank);
}

function GridCard({ view }: { view: GridView }) {
  const { grid, latest, days } = view;
  const total = grid.size * grid.size;
  const s = latest?.summary ?? null;
  const prev = days.length > 1 ? days[days.length - 2]!.summary : null;
  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>{grid.label}: &ldquo;{grid.keyword}&rdquo;</h2>
          <p className="intro">{grid.size}x{grid.size} points, {Number(grid.spacing_km)} km apart, read {grid.cadence}. {latest ? <>Latest read {longDay(latest.day)}.</> : "Not read yet."}</p>
        </div>
      </div>
      {latest && s ? (
        <>
          <div className="dash-grid k3" style={{ marginBottom: 16 }}>
            <div className="kpi">
              <span className="l">In the map pack (top 3)</span>
              <span className="v">{s.inPack}<small>of {total} points</small></span>
              <span className="s">{prev ? deltaLine(s.inPack - prev.inPack, "points") : "First read"}</span>
            </div>
            <div className="kpi">
              <span className="l">Showing at all (top {grid.depth})</span>
              <span className="v">{s.found}<small>of {total} points</small></span>
              <span className="s">{prev ? deltaLine(s.found - prev.found, "points") : "First read"}</span>
            </div>
            <div className="kpi">
              <span className="l">Average rank</span>
              <span className="v">{s.found ? s.avgRank : `${grid.depth}+`}</span>
              <span className="s">A point where you are not in the top {grid.depth} counts as {grid.depth + 1}.</span>
            </div>
          </div>
          <div className="dash-grid side">
            <div>
              <div className="mapgrid" style={{ gridTemplateColumns: `repeat(${grid.size}, minmax(0, 1fr))` }} role="table" aria-label={`Rank at each of ${total} points, north at the top`}>
                {latest.points.map((p) => (
                  <span key={`${p.row}-${p.col}`} role="cell" className={`pos ${{ pack: "top3", near: "top10", far: "", none: "none" }[rankBand(p.rank)]}`} title={`${p.lat}, ${p.lng}: ${p.rank === null ? `not in the top ${grid.depth}` : `rank ${p.rank}`}${p.top[0] ? `. #1 here: ${p.top[0].title}` : ""}`}>
                    {cellLabel(p, grid.depth)}
                  </span>
                ))}
              </div>
              <p className="faint" style={{ margin: "8px 0 0", fontSize: 12.5 }}>North at the top. Green is the map pack (1-3), purple 4-10, grey further out, and {grid.depth}+ is not in the top {grid.depth}.</p>
            </div>
            <div>
              <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Who holds the pack</h3>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Listing</th><th className="r">Top-3 at</th><th className="r">Reviews</th></tr></thead>
                  <tbody>
                    {s.owners.slice(0, 6).map((o) => (
                      <tr key={o.cid ?? o.title} className={o.cid === grid.gbp_cid ? "you" : ""}>
                        <td style={{ fontWeight: 600 }}>{o.title}{o.cid === grid.gbp_cid ? <span className="pill accent" style={{ marginLeft: 8 }}>you</span> : null}</td>
                        <td className="r num">{o.points} of {total}</td>
                        <td className="r num">{o.reviews ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          {days.length > 1 ? (
            <div className="tbl-wrap" style={{ marginTop: 16 }}>
              <table className="tbl">
                <thead><tr><th>Read</th><th className="r">In the pack</th><th className="r">Showing</th><th className="r">Average rank</th></tr></thead>
                <tbody>
                  {[...days].reverse().slice(0, 12).map((d) => (
                    <tr key={d.day}><td>{longDay(d.day)}</td><td className="r num">{d.summary.inPack}</td><td className="r num">{d.summary.found}</td><td className="r num">{d.summary.found ? d.summary.avgRank : `${grid.depth}+`}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : <div className="empty"><b>Not read yet</b>The first read lands within a week of the grid being set up.</div>}
    </div>
  );
}

function deltaLine(d: number, unit: string): string {
  if (d === 0) return "No change on the last read";
  return `${d > 0 ? "Up" : "Down"} ${Math.abs(d)} ${unit} on the last read`;
}
