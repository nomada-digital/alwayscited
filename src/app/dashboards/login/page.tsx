import type { Metadata } from "next";
import { redirect } from "next/navigation";

import BrandMark from "@/components/BrandMark";
import TierName from "@/components/TierName";
import { SITE_ORIGIN } from "@/lib/app-host";
import { dashEmail } from "@/lib/dash/access";
import { requestBase } from "@/lib/dash/page-data";
import { tierInfo } from "@/lib/dash/plan";

import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function DashLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if ((await dashEmail()) && sp.none !== "1") redirect((await requestBase()) || "/");
  const note = sp.link === "expired" ? "That link has expired or was already used. Ask for a new one." : sp.out === "1" ? "You're signed out." : sp.none === "1" ? "That address has no sites on this dashboard yet." : null;
  return (
    <div className="dash">
      <div className="auth">
        <div className="dash-card">
          <div className="dash-logo" style={{ padding: 0, marginBottom: 22 }}>
            <BrandMark id="login" size={16} />
            <TierName tier="cited" />
            <small>dashboard</small>
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, letterSpacing: "-0.025em" }}>Sign in</h1>
          <p className="muted" style={{ margin: "0 0 18px" }}>We email you a link. No password.</p>
          {note ? <div className="banner" style={{ marginBottom: 14 }}>{note}</div> : null}
          <LoginForm />
          <p className="faint" style={{ margin: "22px 0 0", fontSize: 12.5 }}>
            Not a customer yet? <a href={`${SITE_ORIGIN}/alwaystracked`} style={{ color: "var(--accent)" }}>{tierInfo("tracked").action}</a>
          </p>
        </div>
      </div>
    </div>
  );
}
