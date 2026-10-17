import type { Metadata } from "next";

import EngineLogo from "@/components/EngineLogo";
import { engineLabel, longDay, pct } from "@/components/dash/Figures";
import GuideBox from "@/components/dash/GuideBox";
import Nudges from "@/components/dash/Nudges";
import PromptManager from "@/components/dash/PromptManager";
import { PROMPTS_GUIDE } from "@/config/guidance";
import { PageHead } from "@/components/dash/Shell";
import { trimRaw } from "@/lib/dash/model";
import { planShape } from "@/lib/dash/plan";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI visibility", robots: { index: false, follow: false } };

export default async function Ai({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw, ws, base, demo, nudge } = await pageData(slug);
  const rows = ws.clusters.flatMap((c) => [...c.groups, c.own].flatMap((g) => g.prompts.map((p) => ({ p }))));
  // Per engine: named / answered on each prompt's latest reading.
  const byEngine = ws.engines.map((e) => {
    const cells = rows.map((r) => r.p.cells[e]).filter((v) => v === "named" || v === "missed");
    return { e, rate: cells.length ? cells.filter((v) => v === "named").length / cells.length : null, n: cells.length };
  });
  return (
    <>
      <PageHead micro={<>AI visibility{ws.lastRun ? <> · {longDay(ws.lastRun.run_date)}</> : null}</>} title="Does AI name you?" intro="Every prompt you track, asked of every engine each morning. A filled mark is an answer that names you; an empty one gave no answer." />
      <div className={`dash-grid ${byEngine.length > 4 ? "k5" : "k4"}`}>
        {byEngine.map(({ e, rate, n }) => (
          <div key={e} className="kpi">
            <span className="l" style={{ display: "flex", gap: 6, alignItems: "center" }}><EngineLogo engine={e} size={14} />{engineLabel(e)}</span>
            <span className="v">{pct(rate)}</span>
            <span className="s">of {n} answers name you</span>
          </div>
        ))}
      </div>
      <Nudges ws={ws} base={base} ctx={nudge} only={["to-mentioned", "to-everywhere"]} />
      <div className="dash-card" style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}><GuideBox guide={PROMPTS_GUIDE} /></div>
        <PromptManager slug={slug} base={base} initial={trimRaw(raw)} plan={planShape()} demo={demo} />
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
