/**
 * Deliverables (25 Nov 2026): on-site changes alwayscited recommends and cannot make itself, because it has no access
 * to the customer's site. The tables and the rules the database enforces are supabase/migrations/20261125000000_
 * deliverables.sql; this file is the rules the app applies before it writes, and the words the customer reads.
 *
 * Plain module, one relative import, so node --test loads it and the dashboard, the hub route and the admin page share one
 * copy of each rule.
 */

import { DELIVERABLE_LIMITS as LIMITS } from "../../config/contact.ts";

export const DELIVERED_BY = ["nomada", "client"] as const;
export type DeliveredBy = (typeof DELIVERED_BY)[number];

export const STATUSES = ["proposed", "delivered", "completed"] as const;
export type Status = (typeof STATUSES)[number];

/** Bounds: config/contact.ts DELIVERABLE_LIMITS, the same numbers the migration's checks carry. */
export { LIMITS };

export const FILE_TYPES: Record<string, string> = { md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json" };
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,110}\.(md|txt|csv|json)$/;

export type DeliverableFile = { filename: string; contentType: string; body: string };

/** An https or http address, or null. Anything else (javascript:, data:, a bare word) is refused, never stored. */
export function cleanUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > LIMITS.url || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
}

export function cleanTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= LIMITS.title ? s : null;
}

export function cleanFindings(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r\n?/g, "\n").trim();
  return s && s.length <= LIMITS.findings ? s : null;
}

/** An optional note; empty is null, over the bound is refused (undefined) rather than cut. */
export function cleanNote(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  return s.length <= LIMITS.note ? s : undefined;
}

/** A file of text: its name's extension decides the type, and a name that could climb out of a folder is refused. */
export function cleanFile(v: unknown): DeliverableFile | string {
  if (!v || typeof v !== "object") return "A file could not be read.";
  const o = v as Record<string, unknown>;
  const filename = typeof o.filename === "string" ? o.filename.trim() : "";
  if (!FILENAME.test(filename)) return `"${filename.slice(0, 60)}" is not an allowed file name: letters, numbers, dots, dashes and spaces, ending .md, .txt, .csv or .json.`;
  const body = typeof o.body === "string" ? o.body.replace(/\r\n?/g, "\n") : "";
  if (!body.trim()) return `${filename} is empty.`;
  if (body.length > LIMITS.fileBody) return `${filename} is over ${Math.round(LIMITS.fileBody / 1000)}KB.`;
  if (body.includes("\u0000")) return `${filename} is not text.`;
  const contentType = FILE_TYPES[filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()]!;
  return { filename, contentType, body };
}

/** The files of one version: at most LIMITS.files, no duplicate names, one Markdown first when there is one. */
export function cleanFiles(v: unknown): DeliverableFile[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return "Files must be a list.";
  if (v.length > LIMITS.files) return `At most ${LIMITS.files} files.`;
  const out: DeliverableFile[] = [];
  for (const raw of v) {
    const f = cleanFile(raw);
    if (typeof f === "string") return f;
    if (out.some((x) => x.filename.toLowerCase() === f.filename.toLowerCase())) return `${f.filename} is named twice.`;
    out.push(f);
  }
  if (out.reduce((n, f) => n + f.body.length, 0) > LIMITS.filesTotal) return `The files are over ${Math.round(LIMITS.filesTotal / 1000)}KB together.`;
  // The first file is the one the customer copies; make it the Markdown when there is one.
  out.sort((a, b) => Number(!a.filename.toLowerCase().endsWith(".md")) - Number(!b.filename.toLowerCase().endsWith(".md")));
  return out;
}

export const statusRank = (s: Status): number => STATUSES.indexOf(s);

/** The customer may tick it: theirs to do, shown to them, and not done. Role is the caller's (owner or editor). */
export function canTick(d: { deliveredBy: DeliveredBy; status: Status; visible: boolean }): boolean {
  return d.visible && d.deliveredBy === "client" && d.status !== "completed";
}

/** Why a status change is refused, or null. `evidence` is the link a Nomada completion must carry. */
export function refuseStatus(d: { deliveredBy: DeliveredBy; status: Status }, to: Status, evidence: string | null): string | null {
  if (statusRank(to) <= statusRank(d.status)) return `It is already ${d.status}; a status only moves forward.`;
  if (to === "completed" && d.deliveredBy === "nomada" && !evidence) return "Completing a deliverable we make needs an evidence link: a Google Sheet or a page URL.";
  return null;
}

/** What the customer reads for a status. */
export function statusLabel(status: Status, deliveredBy: DeliveredBy): string {
  if (status === "completed") return "Completed";
  if (status === "delivered") return deliveredBy === "client" ? "Ready for you" : "Delivered";
  return deliveredBy === "client" ? "Proposed" : "In progress";
}

export const byLabel = (by: DeliveredBy) => (by === "client" ? "You make this change" : "We make this change");

/** One line of the trail, in the customer's words. Staff are "the alwayscited team"; a customer's own action is named. */
export type TrailEvent = { at: string; actor: string; actorKind: "customer" | "nomada" | "system"; event: string; toStatus: string | null; version: number | null; note: string | null; url: string | null };

export function trailLine(e: TrailEvent): string {
  const who = e.actorKind === "customer" ? e.actor : "the alwayscited team";
  if (e.event === "status") {
    if (e.toStatus === "completed") return `Marked as done by ${who}`;
    if (e.toStatus === "delivered") return `Handed over by ${who}`;
    return `Status changed by ${who}`;
  }
  if (e.event === "edited") return `Updated to version ${e.version ?? "?"} by ${who}`;
  if (e.event === "published") return `Shared with you by ${who}`;
  return `Added by ${who}`;
}

/** Events the customer is shown: not the drafting. A deliverable's life starts for them when it is shared. */
export const customerEvent = (e: Pick<TrailEvent, "event">): boolean => e.event === "status" || e.event === "edited" || e.event === "published";

/** What the customer sees of a deliverable: its current version, and the trail from when it was shared. */
export type CustomerDeliverable = {
  id: string;
  title: string;
  findingsMd: string;
  evidenceUrl: string | null;
  deliveredBy: DeliveredBy;
  status: Status;
  version: number;
  visible: true;
  createdAt: string;
  publishedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completedByKind: "customer" | "nomada" | "system" | null;
  completionNote: string | null;
  completionUrl: string | null;
  files: DeliverableFile[];
  trail: TrailEvent[];
};

/** The group a list draws a deliverable under. */
export function groupOf(d: Pick<CustomerDeliverable, "deliveredBy" | "status">): "you" | "us" | "done" {
  if (d.status === "completed") return "done";
  return d.deliveredBy === "client" ? "you" : "us";
}

/** Notice for the customer success manager when a customer ticks one: one plain line, no markup beyond Slack's own. */
export function tickNotice(p: { domain: string; title: string; by: string; note: string | null; url: string | null; adminUrl: string }): string {
  const bits = [`*${p.domain}* marked a deliverable as done: "${p.title}", by ${p.by}.`];
  if (p.note) bits.push(`Note: ${p.note.replace(/\s+/g, " ").slice(0, 300)}`);
  if (p.url) bits.push(`Live page: ${p.url}`);
  bits.push(p.adminUrl);
  return bits.join("\n");
}

/* ---- markdown: the small subset findings use ---- */

export type Inline = { t: "text"; v: string } | { t: "b"; v: string } | { t: "code"; v: string } | { t: "a"; v: string; href: string };
export type Block = { t: "h"; level: 3 | 4; inl: Inline[] } | { t: "p"; inl: Inline[] } | { t: "ul"; items: Inline[][] } | { t: "ol"; items: Inline[][] } | { t: "pre"; v: string };

/** Bold, code and links, and nothing else. A link is kept only when its address passes cleanUrl. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ t: "text", v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else {
      const href = cleanUrl(m[4]);
      out.push(href ? { t: "a", v: m[3]!, href } : { t: "text", v: m[3]! });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push({ t: "p", inl: parseInline(para.join(" ")) });
    para = [];
    if (list) out.push({ t: list.kind, items: list.items.map(parseInline) });
    list = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]!); i += 1) code.push(lines[i]!);
      out.push({ t: "pre", v: code.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      flush();
      // The page owns h1 and the card h2, so a heading in findings is h3, or h4 for anything deeper.
      out.push({ t: "h", level: h[1]!.length === 1 ? 3 : 4, inl: parseInline(h[2]!.trim()) });
      continue;
    }
    const li = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (li) {
      const kind = li[1] ? "ul" : "ol";
      if (para.length || (list && list.kind !== kind)) flush();
      list = list ?? { kind, items: [] };
      list.items.push(li[3]!);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return out;
}

/** The filename a download carries: the stored name, cut to what every file system takes. */
export const downloadName = (filename: string): string => filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120);

/** "Add schema to /about" as "add-schema-to-about.md". */
export function markdownName(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base || "deliverable"}.md`;
}

/** The files of a request: `files` as sent, or one Markdown file from `markdown` (named by `filename`, else by the title). */
export function filesOf(b: Record<string, unknown>): unknown {
  if (Array.isArray(b.files)) return b.files;
  if (typeof b.markdown === "string") {
    const filename = typeof b.filename === "string" && b.filename.trim() ? b.filename.trim() : markdownName(typeof b.title === "string" ? b.title : "");
    return [{ filename, body: b.markdown }];
  }
  return undefined;
}

