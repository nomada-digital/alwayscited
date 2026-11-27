/**
 * The stages of a placement or link insertion, and how a manual override sits over the sheet (25 Nov 2026).
 *
 * `stageOf` is the customer page's own rule (it lived in links/page.tsx): the sheet's status in three plain stages. An
 * override carries one of OVERRIDE_STATUSES, which `stageOf` reads the same way, so a manual "Live" and WLDM's "Live"
 * are the same thing to every reader. Pure; one relative import so node --test loads it.
 */
import { urlKey } from "./sheet-parse.ts";

export type Stage = "live" | "progress" | "off";

export function stageOf(status: string | null | undefined): Stage {
  const s = (status ?? "").trim();
  if (/^(live|published|indexed|done|complete[d]?)\b/i.test(s)) return "live";
  if (/\b(lost|removed|deleted|declined|rejected|cancel(l)?ed|dropped|dead|not live)\b/i.test(s)) return "off";
  return "progress";
}

/** What the team may set, in the order the form lists them. `stage` is what the customer's pill reads. */
export const OVERRIDE_STATUSES = ["Content written", "Awaiting publication", "Published", "Live", "Not live"] as const;
export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number];
export const isOverrideStatus = (s: unknown): s is OverrideStatus => typeof s === "string" && (OVERRIDE_STATUSES as readonly string[]).includes(s);

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

type Row = { kind: string; url_key: string; live_url: string; anchor_text: string | null; status: string | null; live_on: string | null };

/** The sheet's row with the override over it: status, address, anchor and live date. The key stays the sheet's, so it still matches. */
export function applyOverride<T extends Row>(row: T, o: Override): T {
  return { ...row, status: o.status, live_url: o.live_url ?? row.live_url, anchor_text: o.anchor_text ?? row.anchor_text, live_on: o.live_on ?? row.live_on };
}

/** The sheet has caught up: it reads the same stage the override sets, and for a live item the same page. */
export function sheetAgrees(row: Pick<Row, "status" | "live_url"> | null, o: Pick<Override, "status" | "live_url">): boolean {
  if (!row) return false;
  const want = stageOf(o.status);
  if (stageOf(row.status) !== want) return false;
  return want !== "live" || !o.live_url || urlKey(row.live_url) === urlKey(o.live_url);
}
