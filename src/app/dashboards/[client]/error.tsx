"use client";

import { useEffect } from "react";

/**
 * A page on the dashboards host that could not be read (17 Oct 2026): said
 * plainly, with a retry, inside the sidebar the layout already drew. Nothing
 * is lost - what is tracked is not touched by a failed read.
 */
export default function DashError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="dash-card empty" role="alert">
      <b>This page did not load</b>
      Your tracking is fine - this is a problem reading it just now. Try again, and if it keeps happening, email us{error.digest ? ` with the code ${error.digest}` : ""}.
      <div><button className="btn primary" style={{ marginTop: 14 }} onClick={() => reset()}>Try again</button></div>
    </div>
  );
}
