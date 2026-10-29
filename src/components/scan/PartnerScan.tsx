"use client";

import { useState } from "react";

import { T } from "@/config/tokens";

import LiveScanChecker from "./LiveScanChecker";
import ScanBox, { type ScanBoxCopy } from "./ScanBox";

type PartnerMarket = "US" | "JM";
const LABEL: Record<PartnerMarket, string> = { US: "United States", JM: "Jamaica" };

/**
 * A partner page's scan card with its own market toggle (29 Oct 2026, /partners/the-lab): the visitor picks where the
 * searches are made from before the check starts, and the scan carries the partner's ref and that market. The start
 * route accepts JM only with a ref that offers it (handoff.ts partnerMayUse). `live` is the page's scanReady(), as
 * PageScanBox reads it; when the funnel is off this is the plain card.
 */
export default function PartnerScan(p: ScanBoxCopy & { id: string; partner: string; markets: readonly PartnerMarket[]; live: boolean }) {
  const [market, setMarket] = useState<PartnerMarket>(p.markets[0] ?? "US");
  const { id, partner, markets, live, ...copy } = p;
  return (
    <div>
      <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
        <legend style={{ fontSize: "13px", fontWeight: 600, color: T.soft, marginBottom: "8px" }}>Check the answers people get in</legend>
        <div style={{ display: "flex", gap: "8px" }}>
          {markets.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarket(m)}
              aria-pressed={market === m}
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                fontWeight: 600,
                fontFamily: "inherit",
                borderRadius: "10px",
                cursor: "pointer",
                color: market === m ? T.surface : T.ink,
                background: market === m ? T.accent : T.surface,
                border: "1px solid " + (market === m ? T.accent : T.line),
              }}
            >
              {LABEL[m]}
            </button>
          ))}
        </div>
      </fieldset>
      {live ? <LiveScanChecker key={market} box={copy} handoff={{ ref: partner, market }} /> : <ScanBox id={id} {...copy} />}
    </div>
  );
}
