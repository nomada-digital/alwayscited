import type { Metadata } from "next";

import { FreshGuard } from "@/components/app/FreshGuard";
import { UsageBeacon } from "@/components/app/UsageBeacon";
import { EngineSprite } from "@/components/EngineLogo";
import { fixtureMode } from "@/lib/tracking/fixture-mode";

/**
 * The alwaystracked client dashboard (T3, 29 Sep 2026). Private: noindex here,
 * `x-robots-tag: noindex` from next.config.ts and `Disallow: /app` in
 * robots.ts - all three closures, as every private route carries.
 */
export const metadata: Metadata = {
  title: "alwaystracked dashboard",
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Throws when TRACKING_FIXTURE=1 meets VERCEL_ENV=production (R93): the
  // made-up fixture client is never served from the live site.
  fixtureMode();
  return (
    <>
      {/* Hides the marketing chrome on the dashboard's own host (SiteChrome, globals.css). */}
      <span data-app-tree hidden />
      <EngineSprite />
      {children}
      <UsageBeacon />
      {/* Caps the age of a page drawn from the router's memory (13 Oct 2026, fresh.ts). */}
      <FreshGuard />
    </>
  );
}
