"use client";

import { usePathname } from "next/navigation";

import AppLink from "./AppLink";

/**
 * A sidebar nav link (13 Oct 2026, dashboard speed work; fresh.ts has the
 * design): rendered whole as it comes into view, so the click makes no
 * request - except the link to the page already on screen.
 *
 * Review of the same day, measured on the fixture: the Overview's load sent
 * 12 Full prefetches and one was the Overview itself, a second render of the
 * page just drawn, again on every FreshGuard purge and on every first click
 * of a range. Here, by path, not by the Sidebar's `current`: on a cluster, an
 * opportunity or a page's own screen, `current` names the list above it, and
 * that list is a page away, so it stays prefetched. The query is left out of
 * the test, so a chip that only changes the range does not prefetch the page
 * it is on. Server and client can disagree on the path behind a rewrite; the
 * prop draws nothing, so that is no hydration mismatch, and the browser's
 * path decides.
 *
 * Used at exactly the Sidebar's three nav sites; prefetch.test.mts holds both.
 */
export default function NavLink(props: React.ComponentProps<typeof AppLink> & { href: string }) {
  const here = usePathname() === props.href.split("?")[0];
  return <AppLink {...props} prefetch={here ? false : true} />;
}
