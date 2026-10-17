import type { Metadata } from "next";

import { EngineSprite } from "@/components/EngineLogo";
import { dashFixturePath } from "@/lib/dash/fixture";

import "./dash.css";

/**
 * dashboards.alwayscited.com (17 Oct 2026, src/lib/dash/host.ts). Private:
 * noindex here and in every page, `x-robots-tag` and a Disallow-all robots.txt
 * from the proxy, which also 404s this tree on every other host.
 */
export const metadata: Metadata = {
  title: { default: "alwayscited dashboard", template: "%s · alwayscited dashboard" },
  robots: { index: false, follow: false },
};

export default function DashLayout({ children }: { children: React.ReactNode }) {
  // Throws when DASH_FIXTURE meets VERCEL_ENV=production: a snapshot is never served from the live site.
  dashFixturePath();
  return (
    <>
      <span data-dash-tree hidden />
      <EngineSprite />
      {children}
    </>
  );
}
