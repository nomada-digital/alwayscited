import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import EngineLogo from "@/components/EngineLogo";
import AnswerText from "@/components/dash/AnswerText";
import DateControl from "@/components/dash/DateControl";
import { engineLabel, fullDay, pct } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { answerDiff, ownNames } from "@/lib/dash/highlight";
import { type AnswerWords, type Reading, answerWords, promptReadings } from "@/lib/dash/history";
import { ENGINE_ORDER, hostOf } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";
import type { Engine } from "@/lib/dash/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prompt", robots: { index: false, follow: false } };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One prompt, every reading (Danny, 17 Oct 2026: "click into each prompt to
 * see the actual result ... at various dates since the tracking was set up").
 * A strip per engine covers every reading since the prompt was added; the
 * date control picks one, and an optional second date sets the two side by
 * side with what changed between them.
 */
export default async function PromptDetail({ params, searchParams }: { params: Promise<{ client: string; prompt: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug, prompt: id } = await params;
  const sp = await searchParams;
  const { raw, base } = await pageData(slug);
  const prompt = raw.prompts.find((p) => p.id === id);
  if (!prompt) notFound();
  const readings = await promptReadings(raw.client.id, id);
  const dates = [...new Set(readings.map((r) => r.run_date))].sort();
  const latest = dates.at(-1) ?? null;
  const date = typeof sp.date === "string" && DAY.test(sp.date) && dates.includes(sp.date) ? sp.date : latest;
  const vs = typeof sp.vs === "string" && DAY.test(sp.vs) && dates.includes(sp.vs) && sp.vs !== date ? sp.vs : null;
  const [now, then] = await Promise.all([date ? answerWords(raw.client.id, id, date) : Promise.resolve([]), vs ? answerWords(raw.client.id, id, vs) : Promise.resolve([])]);
  const cluster = raw.clusters.find((c) => c.id === prompt.cluster_id);
  const group = raw.groups.find((g) => g.id === prompt.group_id);
  const engines = ENGINE_ORDER.filter((e) => readings.some((r) => r.engine === e));
  const you = ownNames(raw.client);
  const own = raw.client.domain.replace(/^www\./, "").toLowerCase();
  const citesYou = (r: Pick<Reading, "citations">) => (r.citations ?? []).some((c) => { const h = hostOf(c.url); return !!h && (h === own || h.endsWith(`.${own}`)); });
  const href = (q: Record<string, string>) => `${base}/${slug}/ai/${id}?${new URLSearchParams(q)}`;
  const answered = readings.filter((r) => r.answered);
  const back = `${base}/${slug}/ai`;
  return (
    <>
      <PageHead
        micro={<><Link href={back}>AI visibility</Link><span>/</span><span>Prompt</span></>}
        title={<span style={{ fontSize: 24 }}>{prompt.text}</span>}
        intro={<>{cluster ? <>In <Link href={`${base}/${slug}/clusters/${cluster.id}`} style={{ color: "var(--accent)" }}>{cluster.name}</Link>{group ? ` · ${group.name}` : ""}. </> : null}Asked every morning since {fullDay(prompt.added_on)}{prompt.stopped_on ? `, stopped ${fullDay(prompt.stopped_on)}` : ""}. Named in {answered.filter((r) => r.named).length} of {answered.length} answers ({pct(answered.length ? answered.filter((r) => r.named).length / answered.length : null)}) across {dates.length} readings.</>}
      />
      {!dates.length ? (
        <div className="dash-card empty"><b>No reading yet</b>This prompt is first asked at the next morning&rsquo;s check.</div>
      ) : (
        <>
          <div className="dash-card">
            <div className="dash-card-head">
              <div><h2>Every reading</h2><p className="intro">One square per morning. Filled: the answer named you. A dot: it cited your site. Click a day to read it.</p></div>
              <DateControl dates={dates} date={date!} vs={vs} />
            </div>
            <div className="hist">
              {engines.map((e) => (
                <HistRow key={e} engine={e} dates={dates} readings={readings.filter((r) => r.engine === e)} date={date!} vs={vs} href={(d) => href({ date: d, ...(vs ? { vs } : {}) })} citesYou={citesYou} />
              ))}
            </div>
          </div>
          {engines.map((e) => {
            const a = now.find((r) => r.engine === e) ?? null;
            const b = vs ? (then.find((r) => r.engine === e) ?? null) : null;
            const facts = (r: AnswerWords | null) => (r ? { named: r.named, brands: r.brands ?? [], sources: [...new Set((r.citations ?? []).map((c) => hostOf(c.url) ?? c.url))] } : null);
            const diff = vs ? answerDiff(facts(b), facts(a)) : null;
            return (
              <section key={e} className="dash-card" aria-label={engineLabel(e)}>
                <div className="dash-card-head" style={{ marginBottom: 8 }}>
                  <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}><EngineLogo engine={e} size={18} />{engineLabel(e)}</h2>
                  {diff && diff.named !== null ? <DiffLine diff={diff} /> : null}
                </div>
                <div className={vs ? "pair" : undefined}>
                  {vs ? <AnswerCol day={vs} r={b} you={you} citesYou={citesYou} /> : null}
                  <AnswerCol day={date!} r={a} you={you} citesYou={citesYou} />
                </div>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}

function HistRow({ engine, dates, readings, date, vs, href, citesYou }: { engine: Engine; dates: string[]; readings: Reading[]; date: string; vs: string | null; href: (d: string) => string; citesYou: (r: Reading) => boolean }) {
  const by = new Map(readings.map((r) => [r.run_date, r]));
  return (
    <>
      <span title={engineLabel(engine)} style={{ display: "inline-flex" }}><EngineLogo engine={engine} size={14} /></span>
      <div className="hist-row">
        {dates.map((d) => {
          const r = by.get(d);
          const v = !r ? "" : !r.answered ? "none" : r.named ? "named" : "missed";
          const title = `${d}: ${!r ? "not read" : !r.answered ? "no answer" : r.named ? "named you" : "answered without you"}${r && citesYou(r) ? ", cited your site" : ""}`;
          return <Link key={d} href={href(d)} scroll={false} className={`${v}${r && citesYou(r) ? " cites" : ""}${d === date || d === vs ? " sel" : ""}`} title={title} aria-label={title} />;
        })}
      </div>
    </>
  );
}

function DiffLine({ diff }: { diff: ReturnType<typeof answerDiff> }) {
  const bits: string[] = [];
  if (diff.named === "gained") bits.push("Now names you");
  if (diff.named === "lost") bits.push("No longer names you");
  if (diff.brandsIn.length) bits.push(`+ ${diff.brandsIn.slice(0, 3).join(", ")}`);
  if (diff.brandsOut.length) bits.push(`− ${diff.brandsOut.slice(0, 3).join(", ")}`);
  if (diff.sourcesIn.length || diff.sourcesOut.length) bits.push(`sources ${diff.sourcesIn.length ? `+${diff.sourcesIn.length}` : ""}${diff.sourcesOut.length ? ` −${diff.sourcesOut.length}` : ""}`.trim());
  return <span className={`pill${diff.named === "gained" ? " good" : diff.named === "lost" ? " bad" : ""}`} style={{ whiteSpace: "normal" }}>{bits.length ? bits.join(" · ") : "No change in who is named or cited"}</span>;
}

function AnswerCol({ day, r, you, citesYou }: { day: string; r: AnswerWords | null; you: string[]; citesYou: (r: Reading) => boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="dash-micro" style={{ marginBottom: 6, flexWrap: "wrap" }}>
        {fullDay(day)}
        {r ? (r.answered ? <span className={`pill${r.named ? " accent" : ""}`}>{r.named ? "Names you" : "Does not name you"}</span> : <span className="pill">No answer</span>) : <span className="pill">Not read</span>}
        {r && citesYou(r) ? <span className="pill good">Cites your site</span> : null}
      </div>
      {r?.response_text ? (
        <AnswerText text={r.response_text} you={you} rivals={(r.brands ?? []).filter((b) => !you.some((y) => y.toLowerCase() === b.toLowerCase()))} />
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>{r?.answered === false ? "The engine gave no answer to this prompt that morning." : "The words of this answer are not available."}</p>
      )}
      {r?.brands?.length ? <p style={{ fontSize: 12.5, margin: "8px 0 0" }}><span className="muted">Named: </span>{r.brands.join(", ")}</p> : null}
      {r?.citations?.length ? (
        <>
          <div className="dash-micro" style={{ marginTop: 10 }}>Sources cited</div>
          <ul className="cites-list">
            {r.citations.map((c, i) => (
              <li key={`${c.url}-${i}`}>
                <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">{c.title || hostOf(c.url) || c.url}</a> <span className="muted">{hostOf(c.url)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
