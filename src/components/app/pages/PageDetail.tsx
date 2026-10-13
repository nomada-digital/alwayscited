import type { ReactNode } from "react";

import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import { type PageTab, TABS, TAB_LABEL, pageAction, pagePath, pagesPath } from "@/lib/diy/pages/paths";

import PagesStyle from "./PagesStyle";
import { DARK, Notice, OFF, Reason, SMALL, Toast } from "./parts";

/**
 * One key page (13 Oct 2026, DIY P8; spec 10 section 4.9, the detail): its
 * name and address, where it came from, "Check this page now" (one of the
 * month's page checks; hidden while DIY is off), and its four tabs - Schema,
 * Fit and examples, Basics, History - each a link, so the tab lives in the
 * URL and works with JS off.
 */

const TAB_PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 16px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "14px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;

export default function PageDetail({
  slug,
  pageId,
  title,
  url,
  origin,
  tab,
  cluster,
  toast,
  readOnly,
  reason,
  canWrite,
  enabled,
  checksOut,
  unreadable,
  children,
}: {
  slug: string;
  pageId: string;
  title: string;
  url: string;
  origin: string;
  tab: PageTab;
  cluster: string | null;
  toast: string | null;
  readOnly: string | null;
  reason: string;
  canWrite: boolean;
  enabled: boolean;
  /** The used-up line for page checks, or null with checks left. */
  checksOut: string | null;
  /** "We couldn't read this page on 3 Nov (HTTP 403).", or null. */
  unreadable: string | null;
  children: ReactNode;
}) {
  const off = !canWrite;
  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <PagesStyle />
      <nav aria-label="Back">
        <Link href={pagesPath(slug)} style={{ color: T.accent, fontWeight: 600, textDecoration: "none", fontSize: "14px", minHeight: "44px", display: "inline-flex", alignItems: "center" }}>
          All your pages
        </Link>
      </nav>
      <header style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
        <h1 className="yp-break" style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>
          {title}
        </h1>
        <p style={{ ...SMALL, overflowWrap: "anywhere" }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: T.soft, textDecoration: "underline" }}>
            {url}
          </a>
          {` · ${origin}`}
        </p>
      </header>
      <div id="page-result" style={{ display: "flex", flexDirection: "column" }}>
        <Toast text={toast} />
      </div>
      {readOnly ? <Notice>{readOnly}</Notice> : null}
      {unreadable ? <Notice>{unreadable}</Notice> : null}
      {enabled ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <form method="post" action={pageAction(slug, pageId, tab, cluster)} style={{ margin: 0 }}>
            <button type="submit" name="do" value="check" disabled={off || checksOut !== null} aria-describedby={off ? "detail-reason" : checksOut ? "checks-out" : "check-note"} style={{ ...DARK, ...(off || checksOut ? OFF : {}) }}>
              Check this page now
            </button>
          </form>
          {checksOut ? (
            <span id="checks-out" style={SMALL}>
              {checksOut}
            </span>
          ) : (
            <span id="check-note" style={SMALL}>
              Reads it now, with JavaScript and the validator. Uses one of this month's page checks.
            </span>
          )}
        </div>
      ) : null}
      {off ? <Reason id="detail-reason" text={reason} /> : null}
      <nav aria-label="Tabs" className="yp-tabs">
        {TABS.map((t) => (
          <Link key={t} href={pagePath(slug, pageId, { tab: t, ...(cluster && t === "fit" ? { cluster } : {}) })} aria-current={tab === t ? "page" : undefined} style={TAB_PILL(tab === t)}>
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>
      <div id="fit-result" style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
