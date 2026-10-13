import Link from "@/components/app/AppLink";
import { H2, LINK, SECTION, SMALL } from "@/components/app/plan/styles";
import { T } from "@/config/tokens";
import { appPath } from "@/lib/app-host";
import type { StandLine } from "@/lib/diy/shell/day-zero";

/**
 * "Where you stand today" (13 Oct 2026, DIY P9; spec 10 section 4.1): the
 * Overview's day-0 block, before the first daily check. Each line comes from
 * a stored read (day-zero.ts whereYouStand), with its kind's label under it,
 * and opens the page that holds the detail. Server drawn: nothing here needs
 * JavaScript. With no line, the Overview draws nothing.
 */
export default function WhereYouStand({ lines, slug }: { lines: readonly StandLine[]; slug: string }) {
  if (!lines.length) return null;
  const LABEL: Record<StandLine["id"], string> = { google: "On Google", pages: "Your top pages", crawlers: "Crawler access", schema: "Your homepage" };
  const MORE: Record<StandLine["id"], string> = { google: "See every ranking keyword", pages: "See every ranking keyword", crawlers: "See crawler access", schema: "See its schema" };
  return (
    <section aria-labelledby="stand-h" data-where-you-stand="" style={SECTION}>
      <h2 id="stand-h" style={H2}>
        Where you stand today
      </h2>
      <p style={SMALL}>What we and DataForSEO read before your first daily check. The daily figures start from that check.</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "12px" }}>
        {lines.map((l) => (
          <li key={l.id} data-stand={l.id} style={{ display: "flex", flexDirection: "column", gap: "4px", paddingTop: "12px", borderTop: `1px solid ${T.hair}`, minWidth: 0 }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>{LABEL[l.id]}</span>
            <span style={{ fontSize: "14px", lineHeight: 1.5, color: T.ink, overflowWrap: "anywhere" }}>{l.text}</span>
            <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
              <span style={{ fontSize: "12px", color: T.soft }}>{l.basis}</span>
              <Link href={appPath(`/${slug}${l.to}`)} style={{ ...LINK, fontSize: "13px", display: "inline-flex", alignItems: "center", minHeight: "44px" }}>
                {MORE[l.id]}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
