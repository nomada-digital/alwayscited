import Link from "next/link";

import BrandMark from "./BrandMark";
import { CookieSettingsButton } from "./ConsentBanner";
import TierName from "./TierName";
import { COMPANY_LINE, CONTACT_EMAIL } from "@/config/contact";
import { GRID12, MICRO, T } from "@/config/tokens";

/**
 * The footer pattern every page uses, from HomeFaq.dc.html.
 *
 * Light now, not navy - the boards put it on the page ground with a hairline
 * above it, and it was the last large navy surface on the site.
 *
 * The board's "For" column is back now that /seo-agencies and /pr-agencies
 * exist. The extra tier column came off on 25 Sep 2026 (Q05): the board has
 * three columns - Product, For, Company - and the tier pages are one click
 * away from every package table button and the header's Packages link.
 *
 * Privacy now points at /legal. Terms still does not: terms of service are
 * not drafted, and a link labelled Terms that opens a privacy policy is
 * worse than no link.
 */

const PRODUCT: [string, string][] = [
  ["Free scan", "/#scan"],
  ["Packages", "/packages"],
  ["White label", "/white-label"],
  ["Compare", "/compare"],
];

/**
 * Free tools (R68, danny.md line 69, 28 Sep 2026): a fourth column. The
 * brand block spans 4 and each column 2, so four columns fill the 12 exactly.
 */
const FREE_TOOLS: [string, string][] = [
  ["LLM visibility checker", "/llm-visibility-checker"],
  ["Coverage checker", "/coverage-check"],
];

/** The board's "For" column, which now has pages behind it. */
const FOR: [string, string][] = [
  ["SEO agencies", "/seo-agencies"],
  ["PR agencies", "/pr-agencies"],
];

/**
 * Help (MK-2, 9 Oct 2026) sits beside Contact: the help centre is where a
 * client looks before writing, and the footer is on every page that is not
 * the dashboard. The header's links are Danny's (R29, R63), so it is not there.
 */
const COMPANY: [string, string][] = [
  ["About", "/about"],
  ["Evidence", "/case-studies"],
  ["Blog", "/blog"],
  ["Help", "/help"],
  ["Contact", "/contact"],
];

const link: React.CSSProperties = { fontSize: "13.5px", lineHeight: 1.3, color: T.soft, textDecoration: "none" };
const listStyle: React.CSSProperties = {
  margin: "12px 0 0",
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "9px",
  lineHeight: 1.3,
};

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="footer-col">
      <div style={MICRO}>{title}</div>
      <ul style={listStyle}>{children}</ul>
    </div>
  );
}

export default function Footer() {
  return (
    <footer style={{ marginTop: "44px", borderTop: `1px solid ${T.line}` }}>
      <div
        className="footer-grid"
        style={{
          ...GRID12,
          alignItems: "start",
          maxWidth: "1180px",
          margin: "0 auto",
          padding: "32px 24px 28px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ gridColumn: "span 4" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
            <BrandMark id="ftr" size={15} />
            <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
              <TierName tier="cited" />
            </span>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: "13px", lineHeight: 1.65, color: T.soft, maxWidth: "34ch" }}>
            Built and run by the senior team at{" "}
            <a href="https://nomadadigital.co.uk" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, textDecoration: "none", color: T.ink }}>
              nomada digital
            </a>
            . Be the brand AI recommends.
          </p>
        </div>

        <Column title="Product">
          {PRODUCT.map(([label, href]) => (
            <li key={label}>
              <Link href={href} style={link}>
                {label}
              </Link>
            </li>
          ))}
        </Column>

        <Column title="Free tools">
          {FREE_TOOLS.map(([label, href]) => (
            <li key={label}>
              <Link href={href} style={link}>
                {label}
              </Link>
            </li>
          ))}
        </Column>

        <Column title="For">
          {FOR.map(([label, href]) => (
            <li key={label}>
              <Link href={href} style={link}>
                {label}
              </Link>
            </li>
          ))}
        </Column>

        <Column title="Company">
          {COMPANY.map(([label, href]) => (
            <li key={label}>
              <Link href={href} style={link}>
                {label}
              </Link>
            </li>
          ))}
        </Column>
      </div>

      <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "0 24px 26px", boxSizing: "border-box" }}>
        <div
          style={{
            borderTop: `1px solid ${T.line}`,
            paddingTop: "16px",
            display: "flex",
            alignItems: "baseline",
            gap: "18px",
            flexWrap: "wrap",
            fontSize: "12.5px",
            color: T.soft,
          }}
        >
          <span>&copy; {new Date().getFullYear()} {COMPANY_LINE}</span>
          {/* The board's bottom bar has Privacy and Terms. Privacy exists now;
              terms of service are not drafted, so that link waits rather than
              pointing at a page with no terms on it. */}
          <Link href="/legal" style={{ color: T.soft, textDecoration: "none" }}>
            Privacy
          </Link>
          {/* Reopens the consent banner, so a yes or a no can be changed (15 Oct 2026). */}
          <CookieSettingsButton style={{ color: T.soft }} />
          <div style={{ flexGrow: 1 }} />
          <span>{CONTACT_EMAIL}</span>
        </div>
      </div>
    </footer>
  );
}
