import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import { planPath } from "@/lib/diy/plan/paths";
import type { LogEntry } from "@/lib/diy/plan/worklog";
import { formatDay } from "@/lib/tracking/figures";

import { H2, LINK, SECTION, SMALL } from "./styles";

/**
 * The work log (13 Oct 2026, DIY P3; spec 10 section 4.1 row 10): the last
 * 30 days of work in one strip - done Actions items, placements live,
 * prompts added and verified wins - newest first, each under 21 days marked
 * too early to read. Mounted on the Overview by the shell (P5), from
 * worklog.ts `workLog`.
 */
export default function WorkLog({ entries, slug, max = 8 }: { entries: readonly LogEntry[]; slug: string; max?: number }) {
  const shown = entries.slice(0, max);
  return (
    <section aria-labelledby="log-h" style={SECTION}>
      <h2 id="log-h" style={H2}>
        Work log, last 30 days
      </h2>
      {shown.length === 0 ? (
        <p style={SMALL}>Nothing done in the last 30 days yet. Work you mark done in Actions shows here.</p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {shown.map((e, i) => (
            <li key={`${e.day}-${i}`} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: "12px", padding: "8px 0", borderTop: i ? `1px solid ${T.hair}` : 0, fontSize: "14px" }}>
              <span style={{ color: T.soft, fontSize: "13px" }}>{formatDay(e.day)}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, overflowWrap: "anywhere", color: T.ink }}>
                {e.text}
                {e.early ? <span style={{ fontSize: "12px", color: T.soft }}>Too early to read</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p style={SMALL}>
        {entries.length > shown.length ? `${entries.length - shown.length} more. ` : ""}
        <Link href={planPath(slug, { view: "list", status: "done" })} style={LINK}>
          See everything done
        </Link>
      </p>
    </section>
  );
}
