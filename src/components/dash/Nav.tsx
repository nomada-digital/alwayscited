"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import Icon from "./Icon";

export type NavItem = { href: string; label: string; icon: string; n?: number | null };

/** The sidebar's links. Active by path: the overview only on its own path, the rest on theirs and below. */
export function Nav({ items, root }: { items: NavItem[]; root: string }) {
  const path = usePathname() ?? "";
  return (
    <nav className="dash-nav" aria-label="Dashboard">
      {items.map((it) => {
        const on = it.href === root ? path === root : path === it.href || path.startsWith(`${it.href}/`);
        return (
          <Link key={it.href} href={it.href} aria-current={on ? "page" : undefined} prefetch>
            <Icon name={it.icon} />
            {it.label}
            {it.n ? <span className="n">{it.n}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Switch client, for a member of more than one. */
export function ClientSwitch({ current, others, base }: { current: string; others: { slug: string; domain: string }[]; base: string }) {
  const router = useRouter();
  if (!others.length) return null;
  return (
    <select aria-label="Switch site" value={current} onChange={(e) => router.push(`${base}/${e.target.value}`)}>
      <option value={current}>This site</option>
      {others.map((o) => <option key={o.slug} value={o.slug}>{o.domain}</option>)}
    </select>
  );
}
