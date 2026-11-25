import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { LIMITS, canTick, cleanFiles, cleanNote, cleanTitle, cleanUrl, customerEvent, downloadName, filesOf, groupOf, markdownName, parseInline, parseMarkdown, refuseStatus, statusLabel, tickNotice, trailLine } from "./core.ts";
import { sampleDeliverables } from "./sample.ts";

/**
 * Deliverables (25 Nov 2026): the rules the app applies (core.ts), the sample the demo draws, and the migration's
 * promises - read as text, because the paper trail is only as permanent as the SQL that says so.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SQL = readFileSync(path.join(ROOT, "supabase/migrations/20261125000000_deliverables.sql"), "utf8");
const code = SQL.replace(/--[^\n]*/g, "");

test("links: only http and https, no spaces, bounded", () => {
  assert.equal(cleanUrl("https://docs.google.com/spreadsheets/d/1"), "https://docs.google.com/spreadsheets/d/1");
  assert.equal(cleanUrl("  https://a.co/x  "), "https://a.co/x");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://a.co", "a.co/x", "https://a.co/a b", "", `https://a.co/${"x".repeat(LIMITS.url)}`, 5, null]) assert.equal(cleanUrl(bad), null, String(bad));
});

test("title, note", () => {
  assert.equal(cleanTitle("  Add   FAQ  schema "), "Add FAQ schema");
  assert.equal(cleanTitle(""), null);
  assert.equal(cleanTitle("x".repeat(201)), null);
  assert.equal(cleanNote(undefined), null);
  assert.equal(cleanNote("  "), null);
  assert.equal(cleanNote("ok"), "ok");
  assert.equal(cleanNote("x".repeat(1001)), undefined, "over the bound is refused, never cut");
});

test("files: allowed names, types, no path climbing, markdown first, no duplicates, bounded", () => {
  const ok = cleanFiles([{ filename: "data.csv", body: "a,b" }, { filename: "prompts.md", body: "# hi" }]);
  assert.ok(Array.isArray(ok));
  assert.deepEqual((ok as { filename: string }[]).map((f) => f.filename), ["prompts.md", "data.csv"], "the Markdown is first: it is the one with the Copy button");
  assert.equal((ok as { contentType: string }[])[0]!.contentType, "text/markdown");
  for (const filename of ["../x.md", "a/b.md", "x.exe", "x.md.exe", ".md", "x", "a\\b.md", "x\u0000.md", `${"a".repeat(120)}.md`]) assert.equal(typeof cleanFiles([{ filename, body: "x" }]), "string", filename);
  assert.equal(typeof cleanFiles([{ filename: "a.md", body: "  " }]), "string", "empty");
  assert.equal(typeof cleanFiles([{ filename: "a.md", body: "x" }, { filename: "A.MD", body: "y" }]), "string", "a name twice");
  assert.equal(typeof cleanFiles([{ filename: "a.md", body: "x".repeat(LIMITS.fileBody + 1) }]), "string");
  assert.equal(typeof cleanFiles(Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ filename: `f${i}.md`, body: "x" }))), "string");
  assert.deepEqual(cleanFiles(undefined), []);
  assert.equal(downloadName("a/b c.md"), "a_b c.md");
});

test("status: only forward; completing what Nomada makes needs evidence; the tick is the customer's, on their own items", () => {
  const c = { deliveredBy: "client" as const, status: "proposed" as const };
  assert.equal(refuseStatus(c, "delivered", null), null);
  assert.equal(refuseStatus(c, "completed", null), null, "the customer's tick carries no evidence");
  assert.match(refuseStatus({ deliveredBy: "client", status: "completed" }, "delivered", null) ?? "", /only moves forward/);
  assert.match(refuseStatus({ deliveredBy: "client", status: "delivered" }, "delivered", null) ?? "", /only moves forward/);
  assert.match(refuseStatus({ deliveredBy: "nomada", status: "delivered" }, "completed", null) ?? "", /evidence link/);
  assert.equal(refuseStatus({ deliveredBy: "nomada", status: "delivered" }, "completed", "https://x.co/sheet"), null);
  assert.equal(canTick({ deliveredBy: "client", status: "delivered", visible: true }), true);
  assert.equal(canTick({ deliveredBy: "client", status: "proposed", visible: true }), true);
  assert.equal(canTick({ deliveredBy: "client", status: "completed", visible: true }), false);
  assert.equal(canTick({ deliveredBy: "nomada", status: "delivered", visible: true }), false, "ours to do");
  assert.equal(canTick({ deliveredBy: "client", status: "delivered", visible: false }), false, "a draft");
});

test("the customer's words: statuses, trail, grouping, the notice to the CSM", () => {
  assert.equal(statusLabel("completed", "client"), "Completed");
  assert.equal(statusLabel("delivered", "client"), "Ready for you");
  assert.equal(statusLabel("proposed", "nomada"), "In progress");
  assert.equal(trailLine({ at: "", actor: "amara@x.com", actorKind: "customer", event: "status", toStatus: "completed", version: null, note: null, url: null }), "Marked as done by amara@x.com");
  assert.equal(trailLine({ at: "", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "edited", toStatus: null, version: 2, note: null, url: null }), "Updated to version 2 by the alwayscited team", "staff addresses are not shown to a customer");
  assert.equal(customerEvent({ event: "created" }), false, "the drafting is not the customer's");
  assert.equal(groupOf({ deliveredBy: "client", status: "delivered" }), "you");
  assert.equal(groupOf({ deliveredBy: "nomada", status: "delivered" }), "us");
  assert.equal(groupOf({ deliveredBy: "nomada", status: "completed" }), "done");
  const n = tickNotice({ domain: "a.com", title: "T", by: "m@a.com", note: "done\nnow", url: "https://a.com/p", adminUrl: "https://x/admin/deliverables#1" });
  assert.match(n, /a\.com\* marked a deliverable as done: "T", by m@a\.com/);
  assert.match(n, /Note: done now/);
  assert.match(n, /Live page: https:\/\/a\.com\/p/);
});

test("markdown: headings start at h3, links must pass cleanUrl, code fences are literal, no raw html path", () => {
  const b = parseMarkdown("# Title\n\nSome **bold** and `code` and [ok](https://a.co) and [bad](javascript:alert(1)).\n\n- one\n- two\n\n1. a\n2. b\n\n```\n<script>alert(1)</script>\n```\n");
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "ul", "ol", "pre"]);
  assert.equal((b[0] as { level: number }).level, 3);
  const inl = parseInline("[ok](https://a.co) [bad](javascript:alert(1))");
  assert.deepEqual(inl.filter((i) => i.t === "a").map((i) => (i as { href: string }).href), ["https://a.co"]);
  assert.equal(inl.some((i) => i.t === "text" && i.v === "bad"), true, "a refused link keeps its words, not its address");
  assert.equal((b[4] as { v: string }).v, "<script>alert(1)</script>", "kept as text; React escapes it");
});

test("requests: files or one markdown, named by the title", () => {
  assert.equal(markdownName("Add schema to /about!"), "add-schema-to-about.md");
  assert.equal(markdownName(""), "deliverable.md");
  assert.deepEqual(filesOf({ files: [{ filename: "a.md", body: "x" }] }), [{ filename: "a.md", body: "x" }]);
  assert.deepEqual(filesOf({ markdown: "# x", title: "Fix title" }), [{ filename: "fix-title.md", body: "# x" }]);
  assert.deepEqual(filesOf({ markdown: "# x", filename: "p.md" }), [{ filename: "p.md", body: "# x" }]);
  assert.equal(filesOf({}), undefined);
});

test("the sample shows every state, with no real customer in it", () => {
  const s = sampleDeliverables();
  assert.deepEqual(new Set(s.map((d) => groupOf(d))), new Set(["you", "us", "done"]));
  assert.ok(s.some((d) => d.deliveredBy === "client" && d.status === "completed" && d.completionUrl), "a tick, with the live page");
  assert.ok(s.some((d) => d.deliveredBy === "nomada" && d.status === "completed" && d.completionUrl), "ours, with evidence");
  for (const d of s) {
    assert.ok(d.files[0]!.filename.endsWith(".md"));
    assert.ok(cleanFiles(d.files) instanceof Array, d.id);
    assert.doesNotMatch(JSON.stringify(d), /mortalent|O'Riordan/i, "a public repository holds no real customer's findings");
  }
});

/* ---- the migration ---- */

test("migration: the history tables cannot be updated or deleted, and the parents restrict", () => {
  for (const t of ["deliverable_versions", "deliverable_files", "deliverable_events"]) assert.match(code, new RegExp(`create trigger ${t}_guard before update or delete on ${t} for each row execute function public\\.deliverable_history_guard\\(\\)`), t);
  assert.match(code, /raise exception 'deliverable history is permanent/);
  assert.equal((code.match(/on delete cascade/g) ?? []).length, 0, "no cascade anywhere: a delete must fail, not take the history with it");
  for (const fk of ["references client_domains(id) on delete restrict", "references deliverables(id) on delete restrict", "references deliverable_versions(deliverable_id, version) on delete restrict"]) assert.ok(code.includes(fk), fk);
});

test("migration: draft visibility, forward-only status, nomada evidence, one event per change", () => {
  assert.match(code, /visible_to_customer boolean not null default false/);
  assert.match(code, /if new\.visible_to_customer then raise exception 'a deliverable starts hidden/);
  assert.match(code, /rank_new < rank_old then raise exception/);
  assert.match(code, /constraint deliverables_nomada_evidence check \(status <> 'completed' or delivered_by <> 'nomada' or completion_url is not null\)/);
  assert.match(code, /status in \('proposed','delivered','completed'\)/);
  assert.match(code, /delivered_by in \('nomada','client'\)/);
  assert.match(code, /create trigger deliverables_audit after insert or update on deliverables/);
  for (const e of ["'created'", "'published'", "'unpublished'", "'edited'", "'status'"]) assert.ok(code.includes(e), e);
  assert.match(code, /new\.completed_by := new\.changed_by/, "who ticked it is stamped by the database, not trusted from a column the app fills");
  assert.match(code, /new\.completed_at := now\(\)/);
});

test("migration: additive only, service role only, every function revoked from public and granted by signature", () => {
  assert.doesNotMatch(code, /\bdrop (table|column|constraint|policy|function|schema)\b|\btruncate\b|\balter table [a-z_]+ (drop|alter|rename)\b|\bdelete from\b/i);
  assert.match(code, /drop trigger if exists/, "re-runnable");
  for (const t of ["deliverables", "deliverable_versions", "deliverable_files", "deliverable_events"]) assert.match(code, new RegExp(`alter table ${t} enable row level security`), t);
  assert.doesNotMatch(code, /create policy/);
  const fns = [...code.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)];
  assert.equal(fns.length, 5);
  for (const [, name] of fns) {
    assert.match(code, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public`), `${name} revoke`);
    assert.match(code, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role`), `${name} grant`);
  }
});

test("the next migration number is free and the file sorts after every earlier one", () => {
  const all = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(all.filter((f) => f.startsWith("20261125000000")).length, 1);
  assert.equal(all.at(-1), "20261125000000_deliverables.sql");
});
