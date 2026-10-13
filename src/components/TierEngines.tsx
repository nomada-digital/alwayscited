import EngineLogo from "@/components/EngineLogo";
import type { TierKey } from "@/components/TierName";
import { enginesFor } from "@/config/pricing";
import { listOf } from "@/config/scan-shape";
import { ENGINE_SPECS } from "@/lib/scan/engines";

/**
 * The engines a tier reads, as their own marks (pricing spec, Danny, 27 Sep
 * 2026, section 4): four on alwaystracked, five with Claude on every tier
 * above it. Logos only: the visible "Includes Claude" line went on 28 Sep
 * (Danny, danny.md line 61, R60). No claim that Claude matters more than the
 * others.
 *
 * The list comes from `enginesFor` in pricing.ts, so the staircase, the table
 * and the tier pages cannot disagree about which tier reads what. The marks
 * are decorative to a screen reader; the sr-only sentence carries every name,
 * Claude included where the tier reads it.
 */
export default function TierEngines({
  tier,
  size = 16,
  colour,
  style,
}: {
  tier: TierKey;
  size?: number;
  /** Text colour for the line, and for the single-colour ChatGPT mark. */
  colour?: string;
  style?: React.CSSProperties;
}) {
  const engines = enginesFor(tier);
  const names = listOf(engines.map((e) => ENGINE_SPECS[e].label));
  return (
    <div
      className="tier-engines"
      style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", color: colour, ...style }}
    >
      <span className="sr-only">Reads {names}.</span>
      <span aria-hidden="true" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
        {engines.map((e) => (
          <EngineLogo key={e} engine={e} size={size} inline />
        ))}
      </span>
    </div>
  );
}
