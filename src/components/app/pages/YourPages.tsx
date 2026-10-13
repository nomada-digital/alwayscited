import type { ReactNode } from "react";

import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import { type PagesView, VIEWS, VIEW_LABEL, pagesPath } from "@/lib/diy/pages/paths";
import type { Issue } from "@/lib/diy/pages/view";

import PagesStyle from "./PagesStyle";
import { Notice, Toast } from "./parts";

/**
 * Your pages' frame (13 Oct 2026, DIY P8; spec 10 section 4.9): the heading,
 * the toast, the read-only reason, the night's failure line, and the switch
 * between the three views - the key pages, the crawlers and the schema
 * examples library. Every switch is a link, so it works with JS off; the
 * view lives in the URL.
 */

const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 16px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "14px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;

export default function YourPages({
  slug,
  view,
  keep,
  toast,
  readOnly,
  failedNight,
  children,
}: {
  slug: string;
  view: PagesView;
  keep: { issue?: Issue; cluster?: string };
  toast: string | null;
  readOnly: string | null;
  failedNight: boolean;
  children: ReactNode;
}) {
  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <PagesStyle />
      <header style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Your pages</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>Is your own page the problem, and what exactly would you change? The pages that decide your clusters, read by us each week.</p>
      </header>
      <Toast text={toast} />
      {readOnly ? <Notice>{readOnly}</Notice> : null}
      {failedNight ? <Notice>Some checks didn't finish last night; they retry tonight.</Notice> : null}
      <nav aria-label="View" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {VIEWS.map((v) => (
          <Link key={v} href={pagesPath(slug, v === "pages" ? keep : { view: v })} aria-current={view === v ? "page" : undefined} style={PILL(view === v)}>
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

export { PILL };
