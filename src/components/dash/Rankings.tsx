import EngineLogo, { SearchLogo } from "@/components/EngineLogo";
import { pathOf } from "@/lib/dash/model";
import { pageOne, pageOneOverall, sameSite } from "@/lib/dash/share";
import type { RankRow } from "@/lib/dash/views-data";

import { GooglePos, Pos, Rate, pct } from "./Figures";

/**
 * The Google rankings view (Danny, 15 Nov 2026): every tracked keyword's Google position and page, whether an AI
 * Overview shows and names the customer's site, and Bing beside it with its mark; then the share of page 1, each
 * keyword's top 10 weighted by click-through with the Overview as a slot of its own (share.ts), and overall.
 *
 * The page of results used for the share is the latest one that read cleanly and agrees with the position shown: a
 * reading our two sources disagreed on (lib/tracking/crosscheck.ts), a page of fewer than 10 results, or a page whose
 * own reading is 10 or more places from the position shown (15 Nov 2026: Volunteero's degraded pages, without it) is
 * passed over for the one before.
 */
type Kw = { id: string; keyword: string; pos: number | null; url: string | null; read: boolean; varies: boolean };

const Faint = ({ children }: { children: React.ReactNode }) => <span className="faint" style={{ fontSize: 12 }}>{children}</span>;
const Page = ({ url }: { url: string | null }) => (url ? <a href={url} target="_blank" rel="noopener noreferrer" className="muted" style={{ fontSize: 12.5 }}>{pathOf(url) === "/" ? "Home page" : pathOf(url)}</a> : <Faint>-</Faint>);

export default function Rankings({ keywords, rows, extras, domain, varies }: { keywords: Kw[]; rows: RankRow[]; extras: boolean; domain: string; varies: Set<string> }) {
  const byKw = new Map<string, RankRow[]>();
  for (const r of [...rows].sort((a, b) => b.run_date.localeCompare(a.run_date))) byKw.set(r.keyword_id, [...(byKw.get(r.keyword_id) ?? []), r]);
  const list = keywords.map((k) => {
    const mine = byKw.get(k.id) ?? [];
    const latest = mine[0] ?? null;
    const agrees = (p: number | null) => (p === null ? k.pos === null : k.pos !== null && Math.abs(p - k.pos) < 10);
    const clean = mine.find((r) => (r.top?.length ?? 0) >= 10 && !varies.has(`${r.run_date}|${r.keyword_id}`) && agrees(r.position)) ?? null;
    const aioOf = (r: RankRow | null) => (r && r.aio_shown ? (r.aio_sources ?? []) : null);
    const page = clean ? pageOne(clean.top ?? [], aioOf(clean), domain) : null;
    return { k, latest, page };
  }).sort((a, b) => (a.k.pos ?? 999) - (b.k.pos ?? 999) || a.k.keyword.localeCompare(b.k.keyword));
  const pages = list.flatMap((l) => (l.page ? [l.page] : []));
  const overall = pageOneOverall(pages, domain);
  const youShare = overall.find((o) => o.you)?.share ?? null;

  const aioCell = (r: RankRow | null) => {
    if (!extras || !r || r.aio_shown == null) return <Faint>From the next daily check</Faint>;
    if (!r.aio_shown) return <Faint>No AI Overview</Faint>;
    return (r.aio_sources ?? []).some((d) => sameSite(d, domain)) ? <span className="pill good">Shows, you&apos;re in it</span> : <span className="pill">Shows, you&apos;re not in it</span>;
  };
  const bingCell = (r: RankRow | null) => {
    if (!extras || !r || r.bing_read == null) return <Faint>From the next daily check</Faint>;
    if (!r.bing_read) return <Faint>No clear reading</Faint>;
    // Bing is read to the top 20, as the hub reads it (dataforseo-request.ts bingRankRequest).
    return r.bing_position != null ? <Pos pos={r.bing_position} /> : <span className="pos none" style={{ fontSize: 12 }} title="Bing was read and your site is not in its top 20 for this search">Not in top 20</span>;
  };

  return (
    <>
      <div className="dash-card">
        <div className="dash-card-head">
          <div>
            <h2>Your rankings today</h2>
            <p className="intro">Every tracked keyword on Google and Bing, the page that ranks, and whether Google shows an AI Overview with your site in it.</p>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Keyword</th>
                <th className="r"><span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><SearchLogo engine="google" size={13} />Google</span></th>
                <th>Page</th>
                <th><span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><EngineLogo engine="google_aio" size={13} />AI Overview</span></th>
                <th className="r"><span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><SearchLogo engine="bing" size={13} />Bing</span></th>
                <th>Page</th>
                <th className="r">Your share of page 1</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ k, latest, page }) => (
                <tr key={k.id}>
                  <td>{k.keyword}</td>
                  <td className="r"><GooglePos pos={k.pos} read={k.read} varies={k.varies} /></td>
                  <td><Page url={k.pos !== null ? k.url : null} /></td>
                  <td>{aioCell(latest)}</td>
                  <td className="r">{bingCell(latest)}</td>
                  <td>{extras && latest?.bing_read ? <Page url={latest.bing_url ?? null} /> : <Faint>-</Faint>}</td>
                  <td className="r num">{page && page.total ? pct(page.you / page.total) : <Faint>-</Faint>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="dash-card">
        <div className="dash-card-head">
          <div>
            <h2>Share of page 1</h2>
            <p className="intro">How much of Google&apos;s first page you hold across your tracked keywords, against the sites you share it with. Higher positions count for more, by how often people click them, and an AI Overview counts as a place of its own, shared between the sites it cites.</p>
          </div>
        </div>
        {overall.length ? (
          <>
            <p style={{ margin: "0 0 12px" }}><span className="pill accent">You hold {pct(youShare)} of page 1</span> <span className="muted" style={{ fontSize: 13 }}>across {pages.length} keyword{pages.length === 1 ? "" : "s"}</span></p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Site</th><th>Share of page 1</th></tr></thead>
                <tbody>
                  {overall.map((o) => (
                    <tr key={o.site} className={o.you ? "you" : undefined}>
                      <td>{o.you ? <strong>{o.site} (you)</strong> : o.site}</td>
                      <td><Rate r={o.share} title={`${pct(o.share)} of page 1`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="faint" style={{ margin: 0 }}>Your share of page 1 shows once your keywords have been read.</p>}
      </div>
    </>
  );
}
