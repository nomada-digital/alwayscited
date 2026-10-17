import type { Metadata } from "next";
import Link from "next/link";

import EngineLogo from "@/components/EngineLogo";
import { engineLabel, longDay } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { citingAnswers } from "@/lib/dash/history";
import { pageData } from "@/lib/dash/page-data";
import { SOURCE_RANGES, type SourceRange, siteOf } from "@/lib/dash/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Source", robots: { index: false, follow: false } };

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** One cited site: every answer in the range that cited it, the page it cited, and whether that answer named the client. */
export default async function SourceDetail({ params, searchParams }: { params: Promise<{ client: string; domain: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug, domain: raw0 } = await params;
  const sp = await searchParams;
  const domain = decodeURIComponent(raw0).toLowerCase().slice(0, 253);
  const { raw, base } = await pageData(slug);
  const range: SourceRange = (SOURCE_RANGES as readonly number[]).includes(Number(sp.range)) ? (Number(sp.range) as SourceRange) : 28;
  const from = addDays(raw.today, -range);
  const text = new Map(raw.prompts.map((p) => [p.id, p.text]));
  const rows = (await citingAnswers(raw.client.id, from))
    .filter((a) => text.has(a.question_id))
    .flatMap((a) => (a.citations ?? []).filter((c) => siteOf(c) === domain).map((c) => ({ ...a, url: c.url, title: c.title ?? null })))
    .reverse();
  const pages = [...new Set(rows.map((r) => r.url))];
  const named = new Set(rows.filter((r) => r.named).map((r) => `${r.run_date} ${r.question_id} ${r.engine}`)).size;
  const answers = new Set(rows.map((r) => `${r.run_date} ${r.question_id} ${r.engine}`)).size;
  return (
    <>
      <PageHead
        micro={<><Link href={`${base}/${slug}/sources?range=${range}`}>Sources</Link><span>/</span><span>{domain}</span></>}
        title={domain}
        intro={<>Cited in {answers} answer{answers === 1 ? "" : "s"} to your prompts over the last {range} days, from {pages.length} page{pages.length === 1 ? "" : "s"}. {answers ? `${named} of those answers named you.` : ""}</>}
      >
        <div className="seg" role="group" aria-label="Range">
          {SOURCE_RANGES.map((r) => <Link key={r} href={`?range=${r}`} aria-pressed={r === range} className="seg-link" scroll={false}>{r} days</Link>)}
        </div>
      </PageHead>
      <div className="dash-card">
        <h2>Pages cited</h2>
        <ul className="cites-list">{pages.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer nofollow">{u}</a></li>)}</ul>
      </div>
      <div className="dash-card">
        <h2>Answers citing it</h2>
        {rows.length ? (
          <div className="tbl-wrap" style={{ marginTop: 10 }}>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Prompt</th><th>Engine</th><th>Named you</th></tr></thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={`${r.run_date}-${r.question_id}-${r.engine}-${i}`}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{longDay(r.run_date)}</td>
                    <td style={{ maxWidth: 420 }}><Link href={`${base}/${slug}/ai/${r.question_id}?date=${r.run_date}`}>{text.get(r.question_id)}</Link></td>
                    <td><span title={engineLabel(r.engine)}><EngineLogo engine={r.engine} size={14} /></span></td>
                    <td>{r.named ? <span className="pill accent">Yes</span> : <span className="pill">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Not cited in this range.</p>}
      </div>
    </>
  );
}
