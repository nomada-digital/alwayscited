"use client";

import { useEffect, useState } from "react";

import { TierText } from "@/components/TierName";
import { CARD, T } from "@/config/tokens";

/**
 * "What lands each month" as a grid of tiles (Danny, 28 Sep 2026, R78): a
 * large figure or short noun, a one-line label under it, and the section's
 * body as detail behind a real button. The detail is in the DOM either way -
 * collapsed by height, not removed - and the server renders it open, so with
 * no script, and to a crawler, every tile reads in full. It closes on mount.
 *
 * Figures are passed in already built by PackagePage from pricing.ts and
 * engines.ts; nothing here knows a number.
 */

export type Tile = { key: string; figure: React.ReactNode; label: string; detail?: string };

function TileCard({ tile, open, onToggle }: { tile: Tile; open: boolean; onToggle: () => void }) {
  const id = `tile-${tile.key}`;
  return (
    <div className="ac-row deliverable-tile" style={{ ...CARD, padding: "18px 18px 16px", display: "flex", flexDirection: "column" }}>
      <div className="deliverable-fig" style={{ fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, color: T.ink, minHeight: "30px", display: "flex", alignItems: "center" }}>
        {tile.figure}
      </div>
      <div style={{ marginTop: "6px", fontSize: "13.5px", fontWeight: 600, lineHeight: 1.4, color: T.soft }}>
        <TierText>{tile.label}</TierText>
      </div>
      {tile.detail ? (
        <>
          <div
            id={id}
            inert={!open}
            style={open ? { marginTop: "10px" } : { height: 0, overflow: "hidden" }}
          >
            <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
              <TierText>{tile.detail}</TierText>
            </p>
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={onToggle}
            style={{
              // A 44px-tall tap target on phones (R151, 1 Oct 2026; was 33px):
              // the extra padding is cancelled by negative margins, so the word
              // sits where it did and the card does not grow.
              marginTop: "auto",
              marginBottom: "-11px",
              marginLeft: "-8px",
              alignSelf: "flex-start",
              background: "none",
              border: "none",
              padding: "12px 8px 11px",
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 600,
              color: T.accent,
              cursor: "pointer",
            }}
          >
            {open ? "Less" : "More"}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** `included` is optional: the package pages draw two grids above the cards with no list under them. */
export default function DeliverableTiles({ tiles, included }: { tiles: Tile[]; included?: string[] }) {
  // Open on the server and without script; closed once there is script to open it.
  const [open, setOpen] = useState<Record<string, boolean> | null>(null);
  useEffect(() => setOpen({}), []);
  const isOpen = (k: string) => open === null || open[k] === true;

  return (
    <>
      <div className="deliverable-grid">
        {tiles.map((t) => (
          <TileCard key={t.key} tile={t} open={isOpen(t.key)} onToggle={() => setOpen((o) => ({ ...o, [t.key]: !isOpen(t.key) }))} />
        ))}
      </div>
      {included?.length ? (
      <div className="ac-row" style={{ marginTop: "18px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: T.ink, marginBottom: "10px" }}>Also included</div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {included.map((item) => (
            <li
              key={item}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "6px 12px",
                border: "1px solid " + T.line,
                borderRadius: "999px",
                background: T.surface,
                fontSize: "13px",
                lineHeight: 1.4,
                color: T.soft,
              }}
            >
              <svg width="11" height="8" viewBox="0 0 12 9" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M1 4.5l3.5 3.5L11 1" stroke={T.accent} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>
                <TierText>{item}</TierText>
              </span>
            </li>
          ))}
        </ul>
      </div>
      ) : null}
    </>
  );
}
