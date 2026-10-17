import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import DateControl from "@/components/dash/DateControl";
import { Change, Pos, Spark, fullDay } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { keywordReadings } from "@/lib/dash/history";
import { pageChangeOf, pathKey, pathOf } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Keyword", robots: { index: false, follow: false } };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One tracked keyword, every Google reading (17 Oct 2026): its position over
 * the whole time tracked, which page of the site ranked each day, and
 * Google's top 20 on any day - side by side with another day when one is
 * picked, so who moved past whom is plain. The top 20 is stored from 13 Oct
 * 2026; earlier days show the position only.
 */
export default async function KeywordDetail({ params, searchParams }: { params: Promise<{ client: string; keyword: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug, keyword: id } = await params;
  const sp = await searchParams;
  const { raw, base } = await pageData(slug);
  const kw = raw.keywords.find((k) => k.id === id);
  if (!kw) notFound();
  const days = await keywordReadings(raw.client.id, id);
  const dates = days.map((d) => d.run_date);
  const date = typeof sp.date === "string" && DAY.test(sp.date) && dates.includes(sp.date) ? sp.date : (dates.at(-1) ?? null);
  const vs = typeof sp.vs === "string" && DAY.test(sp.vs) && dates.includes(sp.vs) && sp.vs !== date ? sp.vs : null;
  const at = days.find((d) => d.run_date === date) ?? null;
  const before = vs ? (days.find((d) => d.run_date === vs) ?? null) : null;
  const own = raw.client.domain.replace(/^www\./, "").toLowerCase();
  const isOwn = (domain: string) => domain.replace(/^www\./, "").toLowerCase() === own || domain.toLowerCase().endsWith(`.${own}`);
  const cluster = raw.clusters.find((c) => c.id === kw.cluster_id);
  const best = days.reduce<number | null>((m, d) => (d.position !== null && (m === null || d.position < m) ? d.position : m), null);
  // Every switch of ranking page, newest first.
  const swaps: { on: string; from: string; to: string }[] = [];
  let prev: string | null = null;
  for (const d of days) {
    const p = pathOf(d.url);
    if (p && prev && p !== prev) swaps.push({ on: d.run_date, from: prev, to: p });
    if (p) prev = p;
  }
  swaps.reverse();
  const recent = pageChangeOf(days.map((d) => [d.run_date, d.position, d.url]));
  // Matched on host and path, so "www." or a trailing slash is not read as a different result.
  const rankOf = (top: { domain: string; url: string; rank: number }[] | null, url: string) => top?.find((t) => pathKey(t.url) === pathKey(url))?.rank ?? null;
  const ranked = days.map((d) => d.position).filter((p): p is number => p !== null);
  const worst = ranked.length ? Math.max(...ranked) : null;
  return (
    <>
      <PageHead
        micro={<><Link href={`${base}/${slug}/google`}>Search positions</Link><span>/</span><span>Keyword</span></>}
        title={kw.keyword}
        intro={<>{kw.search_volume ? `${kw.search_volume.toLocaleString("en-GB")} searches a month. ` : ""}Tracked on Google ({raw.client.market}) since {fullDay(kw.added_on)}{cluster ? <>, in <Link href={`${base}/${slug}/clusters/${cluster.id}`} style={{ color: "var(--accent)" }}>{cluster.name}</Link></> : null}.{best !== null ? ` Best position: ${best}.` : ""}</>}
      />
      {!days.length ? (
        <div className="dash-card empty"><b>No reading yet</b>It is checked on Google at the next morning&rsquo;s check.</div>
      ) : (
        <>
          <div className="dash-card">
            <div className="dash-card-head">
              <div><h2>Position over time</h2><p className="intro">Every morning since tracking began; lower is better. {recent ? <>Google switched pages on {fullDay(recent.on)}.</> : null}</p></div>
              <DateControl dates={dates} date={date!} vs={vs} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 8, alignItems: "stretch" }}>
              <div className="muted num" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 11.5, textAlign: "right" }}><span>#{best ?? "-"}</span><span>#{worst ?? "-"}</span></div>
              <Spark values={days.map((d) => d.position)} invert width={900} height={120} fluid max={worst ?? undefined} />
            </div>
            <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}><span>{fullDay(dates[0]!)}</span><span>{fullDay(dates.at(-1)!)}</span></div>
            {swaps.length ? (
              <div style={{ marginTop: 12 }}>
                <div className="dash-micro">Ranking page changes</div>
                <ul className="cites-list">{swaps.map((s) => <li key={s.on}>{fullDay(s.on)}: {s.from} → <b>{s.to}</b></li>)}</ul>
              </div>
            ) : null}
          </div>
          <div className="dash-card">
            <div className="dash-card-head">
              <div>
                <h2>Google&rsquo;s top 20{date ? `, ${fullDay(date)}` : ""}</h2>
                <p className="intro">You: <Pos pos={at?.position ?? null} />{before ? <> · {fullDay(before.run_date)}: <Pos pos={before.position} /> <Change n={before.position !== null && at?.position != null ? before.position - at.position : null} /></> : null}{at?.url ? <> · ranking page {pathOf(at.url)}</> : null}</p>
              </div>
            </div>
            {at?.top?.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th className="r">#</th><th>Result</th>{before ? <th className="r">{fullDay(before.run_date)}</th> : null}</tr></thead>
                  <tbody>
                    {at.top.slice(0, 20).map((t) => {
                      const was = before ? rankOf(before.top, t.url) : null;
                      return (
                        <tr key={`${t.rank}-${t.url}`} className={isOwn(t.domain) ? "you" : ""}>
                          <td className="r num">{t.rank}</td>
                          <td style={{ maxWidth: 520 }}><a href={t.url} target="_blank" rel="noopener noreferrer nofollow">{t.domain}</a><div className="sub" style={{ overflowWrap: "anywhere" }}>{pathOf(t.url)}</div></td>
                          {before ? <td className="r num">{was === null ? <span className="pill">new</span> : <>{was} <Change n={was - t.rank} /></>}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted" style={{ margin: 0 }}>The top 20 was not stored for this day. It is kept for every reading from 13 October 2026.</p>}
          </div>
        </>
      )}
    </>
  );
}
