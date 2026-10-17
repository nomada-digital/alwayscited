import type { Metadata } from "next";
import Link from "next/link";

import EngineLogo from "@/components/EngineLogo";
import { Cells, EngineHeads, Rate, Strip, engineLabel, longDay, pct } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI visibility", robots: { index: false, follow: false } };

export default async function Ai({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, base } = await pageData(slug);
  const rows = ws.clusters.flatMap((c) => [...c.groups.map((g) => ({ c, g })), { c, g: c.own }].flatMap(({ c, g }) => g.prompts.map((p) => ({ p, c, group: g.id ? g.name : "" }))));
  // Per engine: named / answered on each prompt's latest reading.
  const byEngine = ws.engines.map((e) => {
    const cells = rows.map((r) => r.p.cells[e]).filter((v) => v === "named" || v === "missed");
    return { e, rate: cells.length ? cells.filter((v) => v === "named").length / cells.length : null, n: cells.length };
  });
  return (
    <>
      <PageHead micro={<>AI visibility{ws.lastRun ? <> · {longDay(ws.lastRun.run_date)}</> : null}</>} title="Does AI name you?" intro="Every prompt you track, asked of every engine each morning. A filled mark is an answer that names you; an empty one gave no answer." />
      <div className="dash-grid k4" style={{ gridTemplateColumns: `repeat(${Math.min(5, byEngine.length || 1)}, minmax(0, 1fr))` }}>
        {byEngine.map(({ e, rate, n }) => (
          <div key={e} className="kpi">
            <span className="l" style={{ display: "flex", gap: 6, alignItems: "center" }}><EngineLogo engine={e} size={14} />{engineLabel(e)}</span>
            <span className="v">{pct(rate)}</span>
            <span className="s">of {n} answers name you</span>
          </div>
        ))}
      </div>
      <div className="dash-card" style={{ marginTop: 16 }}>
        <div className="dash-card-head">
          <div><h2>Prompts</h2><p className="intro">Latest reading by engine, then the last {ws.dates.length} readings for each.</p></div>
          <EngineHeads engines={ws.engines} />
        </div>
        {rows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Prompt</th><th>Latest</th><th>Named you</th><th>Readings</th></tr></thead>
              <tbody>
                {rows.map(({ p, c, group }) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 420 }}>{p.text}<div className="sub"><Link href={`${base}/${slug}/clusters/${c.id}`}>{c.name}</Link>{group ? ` · ${group}` : ""}</div></td>
                    <td>{p.measured ? <Cells engines={ws.engines} cells={p.cells} /> : <span className="pill accent">First reading tomorrow</span>}</td>
                    <td><Rate r={p.rate} /></td>
                    <td>
                      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
                        {ws.engines.map((e) => <span key={e} style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={engineLabel(e)}><EngineLogo engine={e} size={10} /><Strip days={p.days[e] ?? []} /></span>)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty"><b>No prompts yet</b>Add prompts to a cluster and the first reading comes the next morning.</div>}
      </div>
      <div className="dash-card">
        <h2>Who gets named</h2>
        <p className="intro">Every brand the engines recommended across your prompts, last 7 readings, by how many answers named it.</p>
        <div className="tbl-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>#</th><th>Brand</th><th className="r">Answers</th></tr></thead>
            <tbody>
              {ws.brands.map((b, i) => (
                <tr key={b.name} className={b.you ? "you" : ""}><td className="faint num">{i + 1}</td><td style={{ fontWeight: b.you ? 700 : 500 }}>{b.name}{b.you ? " (you)" : ""}</td><td className="r num">{b.answers}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
