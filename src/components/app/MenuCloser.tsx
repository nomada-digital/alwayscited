"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The phone shell's menus close as menus do (8 Oct 2026, audit mobile-10).
 * More and the client switcher are <details>, so they open with JS off; but a
 * <details> only closes from its own summary, so with More open a tap outside
 * and Escape both left it standing over the page. With JS, a pointer down
 * outside an open one, Escape (focus goes back to its summary) and a move to
 * another page each close it.
 *
 * 13 Oct 2026, DIY P5: and a choice made in it. "+ Add"'s "Add a keyword" goes
 * from Clusters to Clusters with the add panel open, the same path, so the
 * move-to-another-page rule alone left the menu standing over the panel.
 *
 * `selector` names the <details> elements this owns.
 */
export default function MenuCloser({ selector }: { selector: string }) {
  const path = usePathname();

  useEffect(() => {
    const open = () => [...document.querySelectorAll<HTMLDetailsElement>(selector)].filter((d) => d.open);
    const onDown = (e: PointerEvent) => {
      for (const d of open()) if (!(e.target instanceof Node && d.contains(e.target))) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      for (const d of open()) {
        const inside = d.contains(document.activeElement);
        d.open = false;
        if (inside) d.querySelector("summary")?.focus();
      }
    };
    const onChoose = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (link) for (const d of open()) if (d.contains(link)) d.open = false;
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onChoose);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onChoose);
    };
  }, [selector]);

  useEffect(() => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>(selector)) d.open = false;
  }, [path, selector]);

  return null;
}
