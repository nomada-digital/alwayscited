import type { Metadata } from "next";

import BrandMark from "@/components/BrandMark";
import TierName from "@/components/TierName";
import { DASH_NEXT_MAX, dashNext } from "@/lib/dash/host";
import { TOKEN_CHARS, isTokenShape } from "@/lib/tracking/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

/**
 * The page a sign-in link opens. A button, not an automatic sign-in: mail
 * scanners open links on delivery, and a link spent by the scanner would
 * leave its owner signed out (paid-get.test.mts).
 */
export default async function DashAuth({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" && isTokenShape(sp.token) ? sp.token : null;
  const next = dashNext(sp.next);
  return (
    <div className="dash">
      <div className="auth">
        <div className="dash-card">
          <div className="dash-logo" style={{ padding: 0, marginBottom: 22 }}>
            <BrandMark id="auth" size={16} />
            <TierName tier="cited" />
            <small>dashboard</small>
          </div>
          {token ? (
            <form action="/api/dash/auth" method="post">
              <input type="hidden" name="token" value={token} maxLength={TOKEN_CHARS} />
              {next ? <input type="hidden" name="next" value={next} maxLength={DASH_NEXT_MAX} /> : null}
              <h1 style={{ margin: "0 0 6px", fontSize: 22, letterSpacing: "-0.025em" }}>Open your dashboard</h1>
              <p className="muted" style={{ margin: "0 0 18px" }}>{sp.failed === "1" ? "That did not work. Try once more, or ask for a new link." : "One click and you're in."}</p>
              <button type="submit" className="btn primary" style={{ width: "100%", padding: "10px 14px" }}>Sign in</button>
            </form>
          ) : (
            <>
              <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>That link does not work</h1>
              <p className="muted">Ask for a new one.</p>
              <a className="btn primary" href="/login">Back to sign in</a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
