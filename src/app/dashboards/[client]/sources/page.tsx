import type { Metadata } from "next";

import EngineLogo from "@/components/EngineLogo";
import { engineLabel } from "@/components/dash/Figures";
import GuideBox from "@/components/dash/GuideBox";
import { PageHead } from "@/components/dash/Shell";
import { SOURCES_GUIDE } from "@/config/guidance";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sources", robots: { index: false, follow: false } };

export default async function Sources({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws } = await pageData(slug);
  const max = Math.max(1, ...ws.sources.map((s) => s.answers));
  return (
    <>
      <PageHead micro="Sources" title="What AI reads" intro="The sites the engines cite when they answer your prompts, last 7 readings. Being named on the ones at the top is how you get named in the answer." />
      <div style={{ marginBottom: 16 }}><GuideBox guide={SOURCES_GUIDE} /></div>
      <div className="dash-card">
        {ws.sources.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Site</th><th>Cited in</th><th className="r">Pages</th><th>Engines</th></tr></thead>
              <tbody>
                {ws.sources.map((s) => (
                  <tr key={s.domain} className={s.you ? "you" : ""}>
                    <td style={{ fontWeight: 600 }}>{s.domain}{s.you ? <span className="pill accent" style={{ marginLeft: 8 }}>you</span> : null}</td>
                    <td style={{ minWidth: 160 }}>
                      <span className="rate"><span className="track" style={{ width: 90 }}><i style={{ width: `${(s.answers / max) * 100}%` }} /></span><span className="num">{s.answers}</span></span>
                    </td>
                    <td className="r num">{s.urls}</td>
                    <td><span className="cells">{s.engines.map((e) => <span key={e} title={engineLabel(e)}><EngineLogo engine={e} size={13} /></span>)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty"><b>No citations yet</b>They appear after the first morning's reading.</div>}
      </div>
    </>
  );
}
