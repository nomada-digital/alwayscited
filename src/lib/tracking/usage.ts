import { APP_PREFIX } from "../app-host.ts";

/**
 * Dashboard usage events - BRIEF-2 T10 (R98, 30 Sep 2026). The UX loop's
 * signal: which /app features are used, recorded in `dashboard_events` with no
 * third party and no content - an event name, the route's shape, and a few
 * short ids. Never a prompt, a keyword, a note or anything a member typed.
 *
 * Pure, so the rules run under node --test: which events exist, what a props
 * value may be, how a path is reduced to its route, and the weekly counts
 * /admin/tracking/usage shows. The writer is usage-record.ts.
 */

/** The brief's list, in its order. `keyword_checked` (check-keyword.ts) is the spend cap's own row, not a usage event. */
export const USAGE_EVENTS = [
  "view",
  "range_change",
  "compare_change",
  "engine_toggle",
  "add_open",
  "add_save",
  "add_abandon",
  "stop",
  "undo",
  "detail_open",
  "csv",
  "placement_select",
  "cta_shown",
  "cta_click",
  "cta_ask",
  "cta_hide",
  // 13 Oct 2026, DIY P5 (spec 10 section 7.6): wave 1's. The plan route records an item moved (Start, Accept, a
  // status, Drop), a task added and a suggestion hidden for 14 days (Not now); AI visibility's sort and filter
  // links carry ai_filter. Names only, as every event here: never a title, a note or a search.
  "plan_move",
  "plan_task_added",
  "plan_hidden",
  "ai_filter",
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

export const isUsageEvent = (v: unknown): v is UsageEvent => typeof v === "string" && (USAGE_EVENTS as readonly string[]).includes(v);

/** Per member per day, across every event: a cap on rows, not a spend. */
export const EVENTS_PER_MEMBER_PER_DAY = 500;

/** The props a usage event may carry, each a short id: a preset, an engine, a cta, a placement type. */
export const PROP_KEYS = ["preset", "engine", "cta", "type", "on"] as const;
const ID = /^[a-z0-9_-]{1,24}$/;

/** Only the known keys, only id-shaped values; anything else is dropped, never stored. */
export function usageProps(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of PROP_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && ID.test(v)) out[k] = v;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The route a path is on, without the client slug, the query or any id:
 * `/app/acme/clusters/<uuid>?prompt=x` -> `/clusters/[cluster]`. Null for a
 * path outside one client's dashboard.
 */
export function usagePath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const bare = path.split(/[?#]/)[0]!;
  const parts = bare.split("/").filter(Boolean);
  if (parts[0] !== "app" || !parts[1] || ["login", "auth", "parity"].includes(parts[1])) return null;
  const rest = parts.slice(2);
  if (rest.length === 0) return "/";
  if (rest[0] === "clusters" && rest.length === 2) return "/clusters/[cluster]";
  if (rest.length > 2 || rest.some((s) => UUID.test(s) || !/^[a-z-]{1,32}$/.test(s))) return null;
  return `/${rest.join("/")}`;
}

/**
 * A dashboard path in its `/app` form, whichever host it was read on (9 Oct
 * 2026). On the dashboard's own host (APP_HOST, M1) the browser's path drops
 * the prefix - `/tallyroo/clusters` - and usageSlug and usagePath read only
 * the `/app` form, so every event there was silently dropped. The beacon is
 * mounted only in the `/app` layout, so a path without the prefix is always
 * the app host's form of a dashboard path; the proxy sends `/app/*` on the
 * app host to the unprefixed path, so no client slug there is "app".
 */
export function dashPath(path: string): string {
  return path === APP_PREFIX || path.startsWith(`${APP_PREFIX}/`) ? path : `${APP_PREFIX}${path === "/" ? "" : path}`;
}

/** The client slug a dashboard path is under, or null. */
export function usageSlug(path: string): string | null {
  const m = /^\/app\/([A-Za-z0-9-]{1,64})(?:[/?#]|$)/.exec(path);
  return m && !["login", "auth", "parity"].includes(m[1]!) ? m[1]! : null;
}

/** A POSTed event, or null when any part is not one we record. */
export function readUsage(body: unknown): { event: UsageEvent; path: string | null; props: Record<string, string> } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!isUsageEvent(b.event)) return null;
  return { event: b.event, path: usagePath(b.path), props: usageProps(b.props) };
}

/** The Monday (UTC) of the week a timestamp falls in, YYYY-MM-DD. */
export function weekOf(at: string): string {
  const d = new Date(at);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export type UsageRow = { client_domain_id: string | null; event: string; created_at: string };
export type WeekCounts = { week: string; client: string; counts: Partial<Record<UsageEvent, number>>; total: number };

/** Weekly counts per client and event, newest week first, clients by their order in `clients`. Unknown events are left out. */
export function weeklyUsage(rows: UsageRow[], clients: readonly string[]): WeekCounts[] {
  const map = new Map<string, WeekCounts>();
  for (const r of rows) {
    if (!r.client_domain_id || !isUsageEvent(r.event)) continue;
    const week = weekOf(r.created_at);
    const key = `${week}|${r.client_domain_id}`;
    const w = map.get(key) ?? { week, client: r.client_domain_id, counts: {}, total: 0 };
    w.counts[r.event] = (w.counts[r.event] ?? 0) + 1;
    w.total++;
    map.set(key, w);
  }
  const rank = (c: string) => (clients.indexOf(c) === -1 ? clients.length : clients.indexOf(c));
  return [...map.values()].sort((a, b) => b.week.localeCompare(a.week) || rank(a.client) - rank(b.client));
}
