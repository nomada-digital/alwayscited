import { T } from "@/config/tokens";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";

const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));
const WORDS = ["no", "one", "two", "three", "four", "five"];

/**
 * "How this was measured" (13 Oct 2026, DIY P4; spec 10 section 4.2 row 8).
 * Built from engines.ts's own facts - each engine's label and whether we read
 * it as a person sees it (`scraper`) or ask its API (`model`) - and the
 * prompts counted, never typed, so it follows the tier's engines and the
 * readers as they change.
 */
export function measuredText(prompts: number, engines: readonly Engine[]): string {
  const read = engines.filter((e) => ENGINE_SPECS[e].kind === "scraper").map((e) => ENGINE_SPECS[e].label);
  const asked = engines.filter((e) => ENGINE_SPECS[e].kind === "model").map((e) => ENGINE_SPECS[e].label);
  const parts: string[] = [];
  if (read.length) parts.push(`${and(read)} ${read.length === 1 ? "is" : "are"} read through ${read.length === 1 ? "its" : "their"} consumer interface`);
  // The spec's "a slightly different question" is not used: /app says prompts, never questions (prompts-copy.test.mts).
  if (asked.length) parts.push(`${and(asked)} ${asked.length === 1 ? "is" : "are"} asked through ${asked.length === 1 ? "its" : "their"} API`);
  return `${prompts} ${prompts === 1 ? "prompt" : "prompts"} on ${WORDS[engines.length] ?? engines.length} engines, checked daily. ${parts.join("; ")}${parts.length ? ". " : ""}No modelled figures: every figure here is counted from answers we read.`;
}

export default function Measured({ prompts, engines }: { prompts: number; engines: readonly Engine[] }) {
  return (
    <section aria-labelledby="ai-measured-h" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
      <h2 id="ai-measured-h" style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: T.ink }}>
        How this was measured
      </h2>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.55, color: T.soft, maxWidth: "760px" }}>{measuredText(prompts, engines)}</p>
    </section>
  );
}
