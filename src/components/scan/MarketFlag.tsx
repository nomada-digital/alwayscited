import { useId } from "react";

import type { Market } from "@/lib/scan/contract";

/**
 * The market's flag beside its name on a market button (29 Oct 2026, Danny: "a flag on each CTA"). Drawn rather than
 * an emoji, which Windows shows as two letters. Decorative: the button's own text names the market.
 */
export default function MarketFlag({ market, size = 18 }: { market: Market; size?: number }) {
  const clip = "flag" + useId().replace(/[^\w-]/g, "");
  const h = Math.round((size * 2) / 3);
  const box = { width: size, height: h, borderRadius: 2, flexShrink: 0, display: "inline-block", verticalAlign: "-2px", boxShadow: "0 0 0 1px rgba(0,0,0,0.12)" } as const;
  if (market === "JM") {
    return (
      <svg aria-hidden="true" viewBox="0 0 12 8" style={box} preserveAspectRatio="none">
        <rect width="12" height="8" fill="#009b3a" />
        <path d="M0 0 L6 4 L0 8 Z M12 0 L6 4 L12 8 Z" fill="#000000" />
        <path d="M0 0 L12 8 M12 0 L0 8" stroke="#fed100" strokeWidth="1.3" />
      </svg>
    );
  }
  if (market === "UK") {
    return (
      <svg aria-hidden="true" viewBox="0 0 60 40" style={box} preserveAspectRatio="none">
        <clipPath id={clip}>
          <path d="M30 20 h30 v20 z v20 h-30 z h-30 v-20 z v-20 h30 z" />
        </clipPath>
        <rect width="60" height="40" fill="#012169" />
        <path d="M0 0 L60 40 M60 0 L0 40" stroke="#ffffff" strokeWidth="8" />
        <path d="M0 0 L60 40 M60 0 L0 40" clipPath={`url(#${clip})`} stroke="#c8102e" strokeWidth="5" />
        <path d="M30 0 v40 M0 20 h60" stroke="#ffffff" strokeWidth="12" />
        <path d="M30 0 v40 M0 20 h60" stroke="#c8102e" strokeWidth="7" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 19 13" style={box} preserveAspectRatio="none">
      <rect width="19" height="13" fill="#ffffff" />
      {[0, 2, 4, 6, 8, 10, 12].map((y) => (
        <rect key={y} y={y} width="19" height="1" fill="#b22234" />
      ))}
      <rect width="8" height="7" fill="#3c3b6e" />
    </svg>
  );
}
