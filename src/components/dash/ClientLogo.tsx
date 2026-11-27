"use client";

import { useState } from "react";

/** Up to two letters from the brand: the first letters of its first two words. */
export const initialsOf = (name: string) => (name.trim().split(/[\s.-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?");

/**
 * A client's logo beside its name (Danny, 26 Nov 2026): its favicon, from /api/dash/logo/<slug>, and initials on a
 * soft tint where there is none or it will not load. No outline on either: the favicon sits on the page as it is.
 */
export default function ClientLogo({ slug, name, src, size = 32 }: { slug: string; name: string; src: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.25), flex: "none" } as const;
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- a same-origin favicon, already sized by the route's cache
    return <img src={`/api/dash/logo/${slug}`} alt="" width={size} height={size} style={{ ...box, objectFit: "contain" }} onError={() => setBroken(true)} />;
  }
  return (
    <span aria-hidden="true" style={{ ...box, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--chip)", color: "var(--soft)", fontSize: Math.round(size * 0.38), fontWeight: 700, letterSpacing: "-0.02em" }}>
      {initialsOf(name)}
    </span>
  );
}
