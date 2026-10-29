import type { Utm } from "@/lib/scan/handoff";
import { scanReady } from "@/lib/scan/readiness";

import LiveScanChecker from "./LiveScanChecker";
import ScanBox, { type ScanBoxCopy } from "./ScanBox";

/**
 * A page's scan card (R181): the live checker in that card's wording when the
 * funnel can run a scan, else the GET to /scan it always was - the same split
 * HeroSection makes between LiveScanChecker and RequestScanForm. `id` is the
 * dormant card's only; the live one takes its ids from useId.
 */
export default function PageScanBox({ id, handoff, ...copy }: ScanBoxCopy & { id: string; handoff?: { ref: string | null; market: "UK" | "US" | "JM" | null; utm?: Utm | null } }) {
  // A partner's page (29 Oct 2026, /partners/the-lab) tags its scans with its ref and market, as /scan's hand-off does.
  return scanReady() ? <LiveScanChecker box={copy} handoff={handoff} /> : <ScanBox id={id} {...copy} />;
}
