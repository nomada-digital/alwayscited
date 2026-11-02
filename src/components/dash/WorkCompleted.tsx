import { fullDay } from "@/components/dash/Figures";
import { type WorkItem, workFileHref } from "@/lib/dash/work";

/**
 * Work completed (sg-35, 2 Nov 2026): what we have done for the client, newest first, from the hub's record
 * (lib/dash/work.ts, whose reader has already passed every title and note through the census in work-text.ts).
 * Hidden when there is nothing yet. A file opens through the work route, which checks access and hands over a
 * short-lived signed link; no storage address is ever on the page.
 */
export default function WorkCompleted({ items, base, slug }: { items: WorkItem[]; base: string; slug: string }) {
  if (!items.length) return null;
  return (
    <section className="dash-card" id="work" aria-label="Work completed">
      <h2>Work completed</h2>
      <p className="intro">Everything we have done on your site and for your brand, newest first.</p>
      <div className="tbl-wrap" style={{ marginTop: 10 }}>
        <table className="tbl">
          <thead><tr><th>Date</th><th>What we did</th><th>Kind</th><th>File</th></tr></thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{fullDay(w.doneOn)}</td>
                <td>{w.title}{w.note ? <div className="sub" style={{ whiteSpace: "pre-line" }}>{w.note}</div> : null}</td>
                <td><span className="pill">{w.kindLabel}</span></td>
                <td>{w.hasFile ? <a href={workFileHref(base, slug, w.id)} target="_blank" rel="noopener noreferrer">{w.fileName ?? "Open the file"}</a> : <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
