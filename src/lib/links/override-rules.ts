/**
 * How a manual override sits over the sheet (25 Nov 2026; merged with stage.ts, 26 Nov 2026, when "Mark as live" on
 * `sheet_links.state` landed). The customer's stage is, in order: an active override (this file), then `state`
 * (stage.ts: staff and the daily audit), then the sheet's free-text status. An override therefore sets `state` too, so
 * a state the audit wrote cannot outrank what the team has just said. Pure; relative imports so node --test loads it.
 */
import { urlKey } from "./sheet-parse.ts";
import { type Stage, stageOfStatus } from "./stage.ts";

/** What the team may set, in the order the form lists them. The customer's pill reads the stage each one has. */
export const OVERRIDE_STATUSES = ["Content written", "Awaiting publication", "Published", "Live", "Not live"] as const;
export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number];
export const isOverrideStatus = (s: unknown): s is OverrideStatus => typeof s === "string" && (OVERRIDE_STATUSES as readonly string[]).includes(s);

/** The stage an override status shows as. */
export const stageOfOverride = (status: string): Stage => stageOfStatus(status);

/** The `state` value that says the same as an override status (stage.ts STATES). */
export function stateOfOverride(status: string): "in_progress" | "live" | "removed" {
  const st = stageOfStatus(status);
  return st === "live" ? "live" : st === "off" ? "removed" : "in_progress";
}

export type Override = {
  source: "sheet_link" | "progress";
  kind: "insertion" | "placement";
  item_key: string;
  status: string;
  live_url: string | null;
  anchor_text: string | null;
  live_on: string | null;
  active: boolean;
};

type Row = { kind: string; url_key: string; live_url: string; anchor_text: string | null; status: string | null; live_on: string | null; state?: string | null };

/** The sheet's row with the override over it: status, state, address, anchor and live date. The key stays the sheet's, so it still matches. */
export function applyOverride<T extends Row>(row: T, o: Override): T {
  return { ...row, status: o.status, state: stateOfOverride(o.status), live_url: o.live_url ?? row.live_url, anchor_text: o.anchor_text ?? row.anchor_text, live_on: o.live_on ?? row.live_on };
}

/** The sheet has caught up: its own status reads the same stage the override sets, and for a live item the same page. */
export function sheetAgrees(row: Pick<Row, "status" | "live_url"> | null, o: Pick<Override, "status" | "live_url">): boolean {
  if (!row) return false;
  const want = stageOfStatus(o.status);
  if (stageOfStatus(row.status) !== want) return false;
  return want !== "live" || !o.live_url || urlKey(row.live_url) === urlKey(o.live_url);
}
