import type { Metadata } from "next";

import BuildForYou from "@/components/dash/BuildForYou";
import GuideBox from "@/components/dash/GuideBox";
import { PageHead } from "@/components/dash/Shell";
import EngineLogo from "@/components/EngineLogo";
import { engineLabel } from "@/components/scan/result-figures";
import { pageData } from "@/lib/dash/page-data";
import { KIND_LABEL, type Recommendation } from "@/lib/dash/recommendations";
import { readRecommendations } from "@/lib/dash/recommendations-read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recommendations", robots: { index: false, follow: false } };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11-16" as "16 November". */
function dayLabel(d: string): string {
  const [, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? ""}`.trim();
}

function Evidence({ e }: { e: Recommendation["evidence"] }) {
  const rows: React.ReactNode[] = [];
  if (e.answers !== undefined) rows.push(<div key="a" className="rec-ev-row"><span className="rec-ev-k">Seen in</span><span>{e.answers} {e.answers === 1 ? "answer" : "answers"}{e.since ? ` since ${dayLabel(e.since)}` : ""}</span></div>);
  if (e.engines?.length) rows.push(<div key="e" className="rec-ev-row"><span className="rec-ev-k">Engines</span><span className="rec-engines">{e.engines.map((g) => <span key={g} className="rec-engine"><EngineLogo engine={g} size={14} /> {engineLabel(g)}</span>)}</span></div>);
  if (e.prompts?.length) rows.push(<div key="p" className="rec-ev-row"><span className="rec-ev-k">{e.prompts.length === 1 ? "Prompt" : "Prompts"}</span><span>{e.prompts.map((p) => <q key={p} className="rec-quote">{p}</q>)}</span></div>);
  if (e.competitors?.length) rows.push(<div key="c" className="rec-ev-row"><span className="rec-ev-k">Named instead</span><span>{e.competitors.join(", ")}</span></div>);
  if (e.url) rows.push(<div key="u" className="rec-ev-row"><span className="rec-ev-k">Page</span><span><a href={e.url} target="_blank" rel="noopener noreferrer">{e.domain ?? e.url}</a></span></div>);
  else if (e.domain) rows.push(<div key="d" className="rec-ev-row"><span className="rec-ev-k">Site</span><span>{e.domain}</span></div>);
  if (!rows.length) return null;
  return <div className="rec-ev"><h3>Evidence</h3>{rows}</div>;
}

export default async function Recommendations({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws } = await pageData(slug);
  const recs = await readRecommendations(ws.client.id, ws.today);
  return (
    <>
      <PageHead micro="Recommendations" title="What to do this week" intro="A few things you can do yourself, chosen from your own readings. Each one says why, shows what we saw and gives the steps." />
      {!recs.ok ? (
        <div className="dash-card empty" role="status"><b>Your recommendations could not be read just now</b>This is a problem on our side, not a sign there is nothing for you. Please try again in a few minutes.</div>
      ) : !recs.items.length ? (
        <div className="dash-card empty"><b>Nothing here yet</b>Your first recommendations arrive after your first full week of readings, once we have reviewed them.</div>
      ) : (
        <>
          <p className="faint" style={{ margin: "0 0 12px", fontSize: 12.5 }}>Week of {dayLabel(recs.week!)}. Anything you have not done yet stays here until the next set.</p>
          {recs.items.map((r, i) => (
            <div key={r.id} className="dash-card rec">
              <div className="rec-top">
                <span className="pill accent">{KIND_LABEL[r.kind]}</span>
                {r.status === "done" ? <span className="pill good">Done</span> : null}
                {r.week_of !== recs.week ? <span className="pill">From the week of {dayLabel(r.week_of)}</span> : null}
              </div>
              <h2>{r.title}</h2>
              <div className="rec-why"><h3>Why</h3><p>{r.why}</p></div>
              <Evidence e={r.evidence} />
              {r.how.length ? <div style={{ marginTop: 12 }}><GuideBox guide={{ label: "How to do this", title: "How to do this", steps: r.how }} open={i === 0} /></div> : null}
              {r.href ? <p style={{ margin: "12px 0 0" }}><a className="btn sm" href={r.href} target="_blank" rel="noopener noreferrer">Open the page to act on</a></p> : null}
            </div>
          ))}
        </>
      )}
      {recs.ok ? <BuildForYou upgrades={recs.upgrades} tier={ws.client.tier} /> : null}
    </>
  );
}
