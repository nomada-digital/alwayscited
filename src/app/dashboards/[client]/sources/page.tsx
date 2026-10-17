import type { Metadata } from "next";
import Link from "next/link";

import EngineLogo from "@/components/EngineLogo";
import { engineLabel } from "@/components/dash/Figures";
import GuideBox from "@/components/dash/GuideBox";
import { PageHead } from "@/components/dash/Shell";
import { SOURCES_GUIDE } from "@/config/guidance";
import { citingAnswers } from "@/lib/dash/history";
import { pageData } from "@/lib/dash/page-data";
import { SOURCE_RANGES, type SourceRange, sourcesIn } from "@/lib/dash/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sources", robots: { index: false, follow: false } };

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export default async function Sources({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug } = await params;
  const sp = await searchParams;
  const { raw, ws, base } = await pageData(slug);
  const range: SourceRange = (SOURCE_RANGES as readonly number[]).includes(Number(sp.range)) ? (Number(sp.range) as SourceRange) : 7;
  const from = addDays(raw.today, -range);
  const live = new Set(raw.prompts.filter((p) => p.stopped_on === null || p.stopped_on > from).map((p) => p.id));
  const sources = (await citingAnswers(raw.client.id, from).then((rows) => sourcesIn(rows, live, raw.client.domain))).slice(0, 60);
  const max = Math.max(1, ...sources.map((s) => s.answers));
  const root = `${base}/${slug}/sources`;
  return (
    <>
      <PageHead micro="Sources" title="What AI reads" intro="The sites the engines cite when they answer your prompts. Open one to see every answer that cited it, and the page it cited." />
      <div style={{ marginBottom: 16 }}><GuideBox guide={SOURCES_GUIDE} /></div>
      <div className="dash-card">
        <div className="dash-card-head">
          <div><h2>Cited sites</h2><p className="intro">Across your prompts, the last {range} days.</p></div>
          <div className="seg" role="group" aria-label="Range">
            {SOURCE_RANGES.map((r) => <Link key={r} href={`${root}?range=${r}`} aria-pressed={r === range} className="seg-link" scroll={false}>{r} days</Link>)}
          </div>
        </div>
        {sources.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Site</th><th>Cited in</th><th className="r">Pages</th><th className="r">Prompts</th><th>Engines</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.domain} className={s.you ? "you" : ""}>
                    <td style={{ fontWeight: 600 }}><Link href={`${root}/${encodeURIComponent(s.domain)}?range=${range}`}>{s.domain}</Link>{s.you ? <span className="pill accent" style={{ marginLeft: 8 }}>you</span> : null}</td>
                    <td style={{ minWidth: 150 }}><span className="rate"><span className="track" style={{ width: 90 }}><i style={{ width: `${(s.answers / max) * 100}%` }} /></span><span className="num">{s.answers}</span></span></td>
                    <td className="r num">{s.urls}</td>
                    <td className="r num">{s.prompts}</td>
                    <td><span className="cells">{s.engines.map((e) => <span key={e} title={engineLabel(e)}><EngineLogo engine={e} size={13} /></span>)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty"><b>No citations in this range</b>{ws.dates.length ? "Try a longer range." : "They appear after the first morning's reading."}</div>}
      </div>
    </>
  );
}
