import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";

import { D } from "@/components/home/dark";
import TierName from "@/components/TierName";
import { listIf, onlyIf } from "@/config/capabilities";
import { CARD, SHELL, T } from "@/config/tokens";

export const metadata: Metadata = {
  title: "White label for agencies",
  description:
    "Where the white-label line sits" +
    (onlyIf("dashboardBranding", ": which surfaces carry your branding, which carry ours, and the one place our name appears") ?? "") +
    ". We never contact your client.",
  openGraph: { url: "https://alwayscited.com/white-label", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/white-label" },
};

/**
 * WhiteLabel.dc.html (25 Sep 2026 read, Q14), including its beat: the reskin.
 *
 * The same report card is drawn twice, once as ours and once as a made-up
 * agency's (Northlight Digital), stacked in one grid cell. What is painted is
 * the settled state - the agency's skin, which is what the board itself shows
 * under reduced motion - so the page reads right with no JavaScript. Under
 * `html[data-motion="on"]` the board's 9s loop runs: ours, a wipe in the
 * agency's colour, theirs, and back. The two skins' text is identical apart
 * from the name and domain, so the hidden one is aria-hidden rather than read
 * twice.
 *
 * The board's own framing is the point of the page: "the one place our name
 * appears if you do nothing about it". The cards say "Ours" twice, and that is
 * why they are worth reading - a white-label page that claimed every surface
 * was the agency's would be the less useful page and the less true one.
 *
 * The contract-clause wording is marked rather than paraphrased. What a
 * non-contact clause actually says is a commitment, and inventing a plausible
 * version of it on a sales page is how you end up bound to words nobody
 * agreed.
 *
 * **8 Oct 2026, LB1: the table promised what the product does not do.** Two
 * "Yours" rows - the dashboard in "your logo and colours" and monthly
 * reporting with "none of our marks" - and the hero ("Your client never finds
 * out we exist", "your name, your colours, your domain", the report reskinned
 * on insights.northlight.agency) described a white label that is not built: the
 * dashboard's sidebar draws our mark and the alwaystracked name in every mode,
 * the sign-in mail says alwaystracked, and a report is a CSV. Each now sits
 * behind the capability it claims in `config/capabilities.ts`, so it is
 * withheld until AG-2 (dashboard), RP-1 (reports) and own-domain hosting ship
 * and comes back in its own words when they do. With the hero withheld, "Who
 * sees what" is the page's h1. Also cut, for the same reason and with nothing
 * to restore them from: "Written into the agreement" (/legal lists no such
 * agreement), "Per client or consolidated" (checkout bills each client as its
 * own subscription; held by `consolidatedInvoicing`), and the invoice row's
 * "The one place our name appears", which is false while the dashboard and its
 * mail carry our name - it goes back by hand when AG-2 ships.
 *
 * Later the same day, on review: "Placement summaries: Yours" went the same
 * way. A placement summary is the dashboard's Placements screen, drawn inside
 * the shell whose Lockup carries our mark and the alwaystracked name; only the
 * CSV export is unmarked. So no row is the agency's until AG-2 ships, and the
 * page states only the surfaces that are not - recorded in
 * `white-label-claims.test.mts`. With three rows, the grid is one full line,
 * and the card titles are h2 under the h1 while the hero is withheld.
 */

/** Northlight's brand colour and tint - a made-up agency, deliberately not ours. */
const NORTHLIGHT = { accent: "#0f766e", tint: "#e6f4f1" };

type Skin = { cls: string; brand: React.ReactNode; domain: string; accent: string; tint: string };

/** The reskin claims the agency's domain, so it is gated with the hero that draws it (LB1, 8 Oct 2026). */
const SKINS: Skin[] = listIf<Skin>(
  ["dashboardBranding", "reportBranding", "ownDomain"],
  { cls: "wl-ours", brand: <TierName tier="cited" />, domain: "dashboards.alwayscited.com", accent: T.accent, tint: T.wash },
  { cls: "wl-theirs", brand: "Northlight Digital", domain: "insights.northlight.agency", ...NORTHLIGHT },
);

/**
 * `by` is how many engines cited that made-up page in a made-up month - an
 * illustrative figure, not the size of the engine set, which is what
 * copy.test.mts keeps from being typed. Held as a number so no sentence here
 * reads as a count of the engines we run.
 */
const PLACES: { t: string; u: string; by: number }[] = [
  { t: "The 9 best invoicing apps for freelancers", u: "solodesk.io", by: 3 },
  { t: "Invoicing software, compared", u: "invoicingguide.co", by: 3 },
  { t: "How freelancers get paid on time", u: "freelancefield.com", by: 2 },
];

/** A row claiming a capability the product lacks is written inside `listIf`,
 *  so it draws only once that capability ships (LB1, 8 Oct 2026). */
const ROWS: { surface: string; brand: string; note: string }[] = [
  ...listIf("dashboardBranding", { surface: "The visibility dashboard", brand: "Yours", note: "Your logo and colours." }),
  ...listIf("reportBranding", { surface: "Monthly reporting", brand: "Yours", note: "Generated from the same data, none of our marks on it." }),
  // The placement summary is the dashboard's Placements screen, inside the
  // same shell as every other page of it; only its CSV is unmarked.
  ...listIf("dashboardBranding", { surface: "Placement summaries", brand: "Yours", note: "What went live, where, and what it moved." }),
  { surface: "Outreach to publishers", brand: "Ours", note: "We approach the title. Your client is never named unless you ask." },
  { surface: "The published article", brand: "Publisher", note: "Their words. Neither of us is in the byline." },
  { surface: "Invoices and contracts", brand: "Ours, to you", note: "Your client never sees it." },
];

const TERMS: { label: string; value: string; note: React.ReactNode }[] = [
  { label: "Contract", value: "Monthly", note: "No minimum term. Thirty days to stop." },
  {
    label: "Invoicing",
    value: onlyIf("consolidatedInvoicing", "One, to you") ?? "To you",
    note: onlyIf("consolidatedInvoicing", "Per client or consolidated."),
  },
  { label: "Contact with your client", value: "None", note: null },
];

const pill = (color: string, background: string): React.CSSProperties => ({
  fontSize: "11.5px",
  fontWeight: 600,
  borderRadius: "999px",
  padding: "3px 9px",
  color,
  background,
  whiteSpace: "nowrap",
});

export default function WhiteLabelPage() {
  const eyebrow = <div style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>White label</div>;
  // The hero is the reskin: the dashboard and its report on the agency's
  // domain, in its colours. Withheld until all three are built (LB1).
  const hero = onlyIf(["dashboardBranding", "reportBranding", "ownDomain"], (
    <div className="wl-top">
      <div>
        {eyebrow}
        <h1 className="wl-h1" style={{ margin: "12px 0 0", fontSize: "52px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.03, color: T.ink }}>
          Your client never finds out we exist.
        </h1>
        <p style={{ margin: "20px 0 0", fontSize: "17px", lineHeight: 1.55, color: T.soft, maxWidth: "38ch" }}>
          Same data, same dashboards. Your name, your colours, your domain.
        </p>
      </div>

      <div>
        <div className="wl-skins" style={{ lineHeight: 1.3 }}>
          {SKINS.map((k) => (
            <div
              key={k.cls}
              className={"wl-skin " + k.cls}
              aria-hidden={k.cls === "wl-ours" ? true : undefined}
              style={{ ...CARD, padding: "22px 24px" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", paddingBottom: "16px", borderBottom: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span aria-hidden="true" style={{ width: "22px", height: "22px", borderRadius: "6px", background: k.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>{k.brand}</span>
                </div>
                <span style={{ fontSize: "12px", color: T.soft, overflowWrap: "anywhere" }}>{k.domain}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px", marginTop: "18px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: T.ink }}>Tallyroo, September report</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "44px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: k.accent }}>15%</span>
                    <span style={{ fontSize: "13px", color: T.soft }}>12 of 80 answers name Tallyroo</span>
                  </div>
                </div>
                <div style={{ ...pill(k.accent, k.tint), fontSize: "12px", padding: "4px 10px" }}>Up from 4%</div>
              </div>
              <svg width="100%" height="110" viewBox="0 0 560 110" preserveAspectRatio="none" fill="none" style={{ marginTop: "16px", display: "block" }} aria-hidden="true">
                <path d="M0 96 L80 92 L160 88 L240 70 L320 62 L400 40 L480 34 L560 22" stroke={k.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <path d="M0 106 H560" stroke={T.line} vectorEffect="non-scaling-stroke" />
              </svg>
              <div style={{ fontSize: "12px", fontWeight: 600, color: T.soft, marginTop: "14px" }}>Placements live this month</div>
              {PLACES.map((p) => (
                <div key={p.u} className="wl-place" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "9px 0", borderTop: `1px solid ${T.hair}`, fontSize: "13px", lineHeight: 1.3 }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: T.ink }}>{p.t}</span>
                    <span style={{ color: T.soft }}>{" · " + p.u}</span>
                  </span>
                  <span style={pill(k.accent, k.tint)}>Cited by {p.by} engines</span>
                </div>
              ))}
            </div>
          ))}
          <div className="wl-wipe" aria-hidden="true" style={{ background: NORTHLIGHT.accent }} />
        </div>
        <div style={{ marginTop: "12px", fontSize: "12px", color: T.soft }}>Illustrative. Northlight and Tallyroo are made up.</div>
      </div>
    </div>
  ));
  // With the hero withheld, the table's heading is the page's one h1, and the
  // cards under it step up a level so the outline does not skip h2.
  const Heading = hero ? "h2" : "h1";
  const CardTitle = hero ? "h3" : "h2";

  return (
    <div style={{ ...SHELL, paddingTop: "72px", paddingBottom: "72px" }}>
      {hero}

      <section style={{ marginTop: hero ? "96px" : 0 }}>
        {hero ? null : eyebrow}
        <div className="wl-head" style={hero ? undefined : { marginTop: "12px" }}>
          <Heading
            className={hero ? undefined : "wl-h1"}
            style={{ margin: 0, fontSize: hero ? "28px" : "52px", fontWeight: 700, letterSpacing: hero ? "-0.03em" : "-0.04em", lineHeight: hero ? undefined : 1.03, color: T.ink, flexShrink: 0 }}
          >
            Who sees what
          </Heading>
          {onlyIf("dashboardBranding", (
            <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.5, color: T.soft }}>
              Including the one place our name appears if you do nothing about it.
            </p>
          ))}
        </div>
        <div className="wl-grid" style={{ marginTop: "24px" }}>
          {ROWS.map((r) => (
            <div key={r.surface} className="ac-row" style={{ ...CARD, borderRadius: "16px", padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <CardTitle style={{ margin: 0, fontSize: "14.5px", fontWeight: 700, color: T.ink }}>{r.surface}</CardTitle>
                <span style={r.brand === "Yours" ? pill(T.goodFg, T.goodBg) : pill(T.soft, T.chip)}>{r.brand}</span>
              </div>
              <div style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, marginTop: "8px" }}>{r.note}</div>
            </div>
          ))}
        </div>

        <div className="wl-grid" style={{ marginTop: "16px" }}>
          {TERMS.map((t) => (
            <div key={t.label} className="ac-row" style={{ background: T.ink, color: T.surface, borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontSize: "12.5px", color: D.muted }}>{t.label}</div>
              <div style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.03em", marginTop: "4px", color: T.surface }}>{t.value}</div>
              {t.note ? <div style={{ fontSize: "13px", lineHeight: 1.5, color: D.muted, marginTop: "4px" }}>{t.note}</div> : null}
            </div>
          ))}
        </div>

        <p style={{ margin: "22px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
          <Link href="/packages" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
            See what it costs
          </Link>{" "}
          {/* WhiteLabel.dc.html leaves the scan as plain words, so the step an
              agency takes first had nothing to click (R151, 3 Oct 2026). */}
          - or{" "}
          <Link href="/#scan" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
            run a scan on a client
          </Link>{" "}
          first.
        </p>
      </section>
    </div>
  );
}
