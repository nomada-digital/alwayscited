"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import BrandMark from "./BrandMark";
import NavDropdown, { type NavItem } from "./NavDropdown";
import TierName from "./TierName";
import { TIERS } from "@/config/pricing";
import { T } from "@/config/tokens";
import { D, HEADER_H, WASH, WASH_SIZE } from "./home/dark";

/**
 * The topbar, from the boards.
 *
 * The board's nav: Packages, White label, How it works, Blog. Compare is
 * footer only (Danny, 26 Sep 2026, R29) - the page stays, linked from the
 * footer. Packages still points at the homepage section.
 *
 * "White label" became "For agencies", a dropdown of the two agency pages
 * (Danny, 28 Sep 2026, R63). /white-label stays live, linked from the footer
 * and from both agency pages. Packages is the same dropdown: the four tiers,
 * then "Compare all packages" (R64). On mobile each group's links sit
 * indented under a plain label rather than behind a hover.
 *
 * The Packages list is tier names only, and "Compare all packages" is ink at
 * normal weight, not accent (Danny, 28 Sep 2026, R74).
 *
 * On `/` only it sits on the hero's dark ground, as Main.dc.html draws it:
 * no hairline, links in D.muted, the lockup lifted with `.on-dark`. The wash
 * is painted here as well as on the hero, sized to the same box, so the two
 * read as one surface. Every other route keeps the light bar.
 *
 * Sticky on every site page (R175, Danny, 1 Oct 2026, danny.md line 188):
 * top 0, never hides on scroll, z-index 40 - above page content, below the
 * answer drawer and its backdrop (60/61); the mobile menu and dropdowns live
 * inside it. On `/` the wash stays while the page is at the top and gives way
 * to solid D.ground once scrolled past 8px, so stuck over the page the bar is
 * one flat ground; with JS off it keeps the wash, which is D.ground at its
 * edges. No drop shadow. globals.css offsets anchors and the guide nav by
 * --header-h (HEADER_H) plus a margin: the bars measure 61-68.4px, not one
 * height, so the offset clears the tallest rather than pinning a height.
 *
 * "Log in" for a company that already has a profile (Danny, 13 Oct 2026):
 * the dashboard's sign-in screen, last before Free scan on the bar and above
 * it in the phone menu. A plain link in the nav's own style, so the one
 * filled button stays the scan. `loginHref` comes from the root layout
 * (app-host.ts appHref): /app/login while the dashboard shares this host, the
 * app host's /login once APP_HOST is set - this component cannot read
 * APP_HOST, so it is handed the answer. A plain <a>, not <Link>: the
 * dashboard is another layout, and once it has its own host another origin.
 * The dashboard never shows this header (SiteChrome), so it never shows the
 * link either.
 */

const COMPARE_HREF = "/packages";
const packageLinks: NavItem[] = [
  ...TIERS.map((t) => ({
    key: t.key,
    href: t.href,
    label: (
      <span style={{ fontWeight: 600 }}>
        <TierName tier={t.key} />
      </span>
    ),
  })),
  { key: "compare", href: COMPARE_HREF, label: <span style={{ color: T.ink, fontWeight: 500 }}>Compare all packages</span> },
];
const navLinks = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/blog", label: "Blog" },
];
const AGENCIES = "For agencies";
const LOG_IN = "Log in";
const agencyLinks: NavItem[] = [
  { key: "seo", href: "/seo-agencies", label: "SEO agencies" },
  { key: "pr", href: "/pr-agencies", label: "PR agencies" },
];
const groups = [
  { label: "Packages", items: packageLinks, minWidth: "280px" },
  { label: AGENCIES, items: agencyLinks, minWidth: "190px" },
];

const linkStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 500,
  color: T.soft,
  textDecoration: "none",
};

function Logo({ dark }: { dark: boolean }) {
  return (
    <Link href="/" className={dark ? "on-dark" : undefined} style={{ display: "flex", alignItems: "center", gap: dark ? "4px" : "3px", textDecoration: "none" }}>
      <BrandMark id="hdr" spin size={15} colour={dark ? D.accent : undefined} />
      <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.022em", color: dark ? T.surface : T.ink }}>
        <TierName tier="cited" />
      </span>
    </Link>
  );
}

const menuRow: React.CSSProperties = { display: "flex", alignItems: "center", minHeight: "44px" };

export default function Header({ loginHref }: { loginHref: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const dark = usePathname() === "/";
  const links = dark ? { ...linkStyle, color: D.muted } : linkStyle;
  const bar = dark ? T.surface : T.ink;

  useEffect(() => {
    if (!dark) return;
    const read = () => setScrolled(window.scrollY > 8);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [dark]);

  return (
    <header
      className="site-header"
      style={
        dark
          ? {
              backgroundColor: D.ground,
              backgroundImage: scrolled ? "none" : WASH,
              backgroundSize: WASH_SIZE,
              backgroundRepeat: "no-repeat",
              minHeight: `${HEADER_H}px`,
            }
          : { background: T.bg, borderBottom: `1px solid ${T.line}` }
      }
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1180px",
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <Logo dark={dark} />
        <div style={{ flexGrow: 1 }} />

        <nav className="nav-links" style={{ display: "flex", alignItems: "center", gap: "20px" }} aria-label="Main navigation">
          {groups.map((g) => (
            <NavDropdown key={g.label} label={g.label} items={g.items} style={links} minWidth={g.minWidth} />
          ))}
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} style={links}>
              {link.label}
            </Link>
          ))}
          <a href={loginHref} style={links}>
            {LOG_IN}
          </a>
          <Link
            href="/#scan"
            style={{
              background: T.accent,
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              padding: dark ? "9px 16px" : "8px 16px",
              borderRadius: dark ? "9px" : "10px",
              textDecoration: "none",
            }}
          >
            Free scan
          </Link>
        </nav>

        <button
          className="md:hidden"
          onClick={() => setOpen((v) => !v)}
          // 44px target (R151, 3 Oct 2026: it was 36x32); the negative margin keeps its old 36x32 footprint, so the header and the bars do not move.
          style={{ background: "none", border: "none", cursor: "pointer", padding: "14px 12px", margin: "-6px -4px" }}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          <span style={{ display: "block", width: "20px", height: "2px", background: bar, marginBottom: "5px" }} />
          <span style={{ display: "block", width: "20px", height: "2px", background: bar, marginBottom: "5px" }} />
          <span style={{ display: "block", width: "20px", height: "2px", background: bar }} />
        </button>
      </div>

      {open && (
        <nav className="site-header__menu" style={{ background: T.surface, borderTop: `1px solid ${T.line}`, padding: "1rem 1.5rem 1.5rem" }} aria-label="Mobile navigation">
          {/* Every row a 44px target (R151, 3 Oct 2026: they measured 18-22px
              opened at 390); the gaps the rows replace are gone, so the menu
              is about as tall as before. */}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
            {groups.map((g) => (
              <li key={g.label}>
                <span style={{ ...linkStyle, color: T.ink, display: "block", paddingTop: "6px" }}>{g.label}</span>
                <ul style={{ listStyle: "none", padding: "0 0 0 16px", margin: "2px 0 0", display: "flex", flexDirection: "column" }}>
                  {g.items.map((link) => (
                    <li key={link.key}>
                      <Link href={link.href} style={{ ...linkStyle, ...menuRow, maxWidth: "300px" }} onClick={() => setOpen(false)}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} style={{ ...linkStyle, ...menuRow }} onClick={() => setOpen(false)}>
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={loginHref} style={{ ...linkStyle, ...menuRow }} onClick={() => setOpen(false)}>
                {LOG_IN}
              </a>
            </li>
            <li style={{ marginTop: "8px" }}>
              <Link
                href="/#scan"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: "44px",
                  boxSizing: "border-box",
                  background: T.accent,
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: 600,
                  padding: "10px 20px",
                  borderRadius: "10px",
                  textDecoration: "none",
                }}
                onClick={() => setOpen(false)}
              >
                Free scan
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
