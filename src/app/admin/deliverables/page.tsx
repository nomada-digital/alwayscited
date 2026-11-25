import type { Metadata } from "next";

import { DELIVERABLE_LIMITS as LIM } from "@/config/contact";
import { T } from "@/config/tokens";
import { TEAM } from "@/config/team";
import { statusLabel, trailLine } from "@/lib/deliverables/core";
import { type InternalDeliverable, readInternalDeliverables } from "@/lib/deliverables/store";
import { formatDay } from "@/lib/tracking/figures";

import { ActingProvider, DeliverableForm } from "./Forms";
import { hint, input, label } from "./styles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Deliverables", robots: { index: false, follow: false } };

const day = (iso: string) => formatDay(iso.slice(0, 10), true);
const card = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "14px", padding: "16px 18px", marginTop: "12px" } as const;
const pill = (on: boolean, tone: "good" | "warn" | "plain" = "plain") => ({ display: "inline-block", fontSize: "12px", fontWeight: 700, padding: "2px 9px", borderRadius: "999px", background: tone === "good" ? T.goodBg : tone === "warn" ? T.warnBg : T.chip, color: tone === "good" ? T.goodFg : tone === "warn" ? T.warnFg : T.soft, opacity: on ? 1 : 0.7 }) as const;
const small = { fontSize: "13px", color: T.soft } as const;

function Row({ d }: { d: InternalDeliverable }) {
  const cur = d.versions.find((v) => v.version === d.version) ?? d.versions.at(-1);
  return (
    <article id={d.id} style={card}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "16px", flex: "1 1 260px" }}>{cur?.title ?? "(no version)"}</h3>
        <span style={pill(true, d.status === "completed" ? "good" : "plain")}>{statusLabel(d.status, d.deliveredBy)}</span>
        <span style={pill(true)}>{d.deliveredBy === "client" ? "Client makes it" : "Nomada makes it"}</span>
        <span style={pill(d.visible, d.visible ? "good" : "warn")}>{d.visible ? "Shown to customer" : "Draft: hidden"}</span>
      </div>
      <p style={{ ...small, margin: "6px 0 0" }}>
        Version {d.version} · created {day(d.createdAt)} by {d.createdBy}
        {d.publishedAt ? ` · shared ${day(d.publishedAt)}` : ""}
        {d.completedAt ? ` · completed ${day(d.completedAt)} by ${d.completedBy}` : ""}
        {" · "}<a href={`/admin/deliverables/preview/${d.id}`} style={{ color: T.accent }}>Preview as the customer sees it</a>
      </p>
      {d.completionUrl ? <p style={{ ...small, margin: "4px 0 0" }}>{d.deliveredBy === "nomada" ? "Evidence" : "Live page"}: <a href={d.completionUrl} style={{ color: T.accent }}>{d.completionUrl}</a>{d.completionNote ? ` · "${d.completionNote}"` : ""}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "12px" }}>
        {d.visible ? (
          <DeliverableForm compact fixed={{ action: "deliverable_unpublish", slug: d.slug, id: d.id }} submit="Back to draft">
          </DeliverableForm>
        ) : (
          <DeliverableForm compact fixed={{ action: "deliverable_publish", slug: d.slug, id: d.id }} submit="Publish to customer">
          </DeliverableForm>
        )}
        {d.status === "proposed" ? (
          <DeliverableForm compact fixed={{ action: "deliverable_deliver", slug: d.slug, id: d.id }} submit="Mark delivered (handed over)">
          </DeliverableForm>
        ) : null}
        {d.status !== "completed" && d.deliveredBy === "nomada" ? (
          <DeliverableForm compact fixed={{ action: "deliverable_complete", slug: d.slug, id: d.id }} submit="Mark completed">
            <label style={label}><span>Evidence link <span style={hint}>(required: a sheet or a page)</span></span><input name="evidence_url" type="url" required maxLength={LIM.url} placeholder="https://" style={{ ...input, minWidth: "260px" }} /></label>
            <label style={label}><span>Note <span style={hint}>(optional)</span></span><input name="note" maxLength={LIM.note} style={input} /></label>
          </DeliverableForm>
        ) : null}
      </div>

      <details style={{ marginTop: "12px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>Edit as a new version</summary>
        <p style={{ ...small, margin: "6px 0 10px" }}>Nothing is overwritten: this saves version {d.version + 1} and keeps every earlier one. Leave the files empty to keep the current files.</p>
        <DeliverableForm fixed={{ action: "deliverable_edit", slug: d.slug, id: d.id, expect: d.version }} submit={`Save as version ${d.version + 1}`}>
          <label style={label}><span>Title</span><input name="title" required maxLength={LIM.title} defaultValue={cur?.title} style={input} /></label>
          <label style={label}><span>Findings <span style={hint}>(Markdown)</span></span><textarea name="findings" required rows={6} maxLength={LIM.findings} defaultValue={cur?.findingsMd} style={input} /></label>
          <label style={label}><span>Evidence link <span style={hint}>(optional)</span></span><input name="evidence_url" type="url" maxLength={LIM.url} defaultValue={cur?.evidenceUrl ?? ""} style={input} /></label>
          <label style={label}><span>New files <span style={hint}>(optional; .md, .txt, .csv or .json)</span></span><input id={`dlv-edit-files-${d.id}`} name="files" type="file" multiple accept=".md,.txt,.csv,.json" /></label>
          <label style={label}><span>What changed, and why <span style={hint}>(kept with the version)</span></span><input name="reason" required maxLength={LIM.note} style={input} /></label>
        </DeliverableForm>
      </details>

      <details style={{ marginTop: "8px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>Paper trail: {d.versions.length} version{d.versions.length === 1 ? "" : "s"}, {d.events.length} event{d.events.length === 1 ? "" : "s"}</summary>
        <ol style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px", lineHeight: 1.6 }}>
          {d.events.map((e, i) => (
            <li key={i}>
              {day(e.at)} · <b>{e.event === "status" ? `${e.fromStatus} to ${e.toStatus}` : e.event}</b> by {e.actor} ({e.actorKind}){e.version ? ` · v${e.version}` : ""}
              {e.note ? ` · "${e.note}"` : ""}{e.url ? <> · <a href={e.url} style={{ color: T.accent }}>link</a></> : null}
              {" "}<span style={{ color: T.soft }}>({trailLine(e)})</span>
            </li>
          ))}
        </ol>
        {d.versions.map((v) => (
          <div key={v.version} style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${T.hair}`, fontSize: "13px" }}>
            <b>Version {v.version}</b> · {day(v.createdAt)} by {v.createdBy}{v.reason ? ` · "${v.reason}"` : ""}
            <div style={small}>{v.title}{v.evidenceUrl ? " · evidence link kept" : ""} · files: {v.files.map((f) => `${f.filename} (${f.bytes} bytes, sha256 ${f.sha256.slice(0, 10)}…)`).join(", ") || "none"}</div>
          </div>
        ))}
      </details>
    </article>
  );
}

/**
 * /admin/deliverables (25 Nov 2026): the internal create path for deliverables - on-site changes alwayscited
 * recommends and cannot make itself. Behind the /admin Basic auth. A deliverable is created hidden; "Publish to
 * customer" is the approval step. The same writes are the hub route's deliverable_* actions (docs/deliverables.md),
 * which is what Dispatch and Noma call.
 */
export default async function DeliverablesAdmin() {
  const read = await readInternalDeliverables();
  const items = read.ok ? read.items : [];
  const byCustomer = new Map<string, InternalDeliverable[]>();
  for (const d of items) byCustomer.set(d.domain || d.slug, [...(byCustomer.get(d.domain || d.slug) ?? []), d]);
  return (
    <div style={{ padding: "32px 24px 80px", maxWidth: "980px", margin: "0 auto", color: T.ink }}>
      <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700 }}>Deliverables</h1>
      <p style={{ margin: "8px 0 20px", fontSize: "15px", color: T.soft, maxWidth: "70ch" }}>
        On-site changes we recommend and cannot make ourselves. New ones start hidden; nothing reaches the customer until you press Publish to customer. Every edit is a new version and every status change is kept with who and when.
      </p>
      <ActingProvider defaultValue={TEAM.danny.email}>
        <section id="new" style={{ ...card, marginTop: "20px" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: "18px" }}>Create a deliverable</h2>
          <DeliverableForm fixed={{ action: "deliverable_create" }} submit="Create (hidden from the customer)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
              <label style={label}><span>Customer slug <span style={hint}>(the dashboard address, e.g. mortalentboutique-com)</span></span><input name="slug" required pattern="[a-z0-9-]+" maxLength={LIM.slug} style={input} placeholder="customer-slug" /></label>
              <label style={label}><span>Who makes the change</span>
                <select name="delivered_by" required defaultValue="client" style={input}>
                  <option value="client">The customer (we have no access to their site)</option>
                  <option value="nomada">Nomada</option>
                </select>
              </label>
            </div>
            <label style={label}><span>Title</span><input name="title" required maxLength={LIM.title} style={input} /></label>
            <label style={label}><span>Findings summary <span style={hint}>(short Markdown)</span></span><textarea name="findings" required rows={6} maxLength={LIM.findings} style={input} /></label>
            <label style={label}><span>Evidence link <span style={hint}>(optional: a Google Sheet, doc or page)</span></span><input name="evidence_url" type="url" maxLength={LIM.url} placeholder="https://" style={input} /></label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
              <label style={label}><span>Markdown file(s) <span style={hint}>(.md, .txt, .csv or .json; the first .md is the one they copy)</span></span><input id="dlv-create-files" name="files" type="file" multiple accept=".md,.txt,.csv,.json" /></label>
              <label style={label}><span>Or paste the Markdown</span><textarea name="markdown" rows={4} maxLength={LIM.fileBody} style={input} placeholder="Used when no file is chosen" /></label>
            </div>
            <label style={label}><span>File name for pasted Markdown <span style={hint}>(optional)</span></span><input name="filename" maxLength={LIM.filename} style={{ ...input, maxWidth: "320px" }} placeholder="prompts.md" /></label>
          </DeliverableForm>
        </section>

        {!read.ok ? (
          <p role="alert" style={{ color: T.badFg, marginTop: "20px" }}>Could not read the deliverables: {read.message}</p>
        ) : items.length === 0 ? (
          <p style={{ ...small, marginTop: "24px" }}>No deliverables yet. If this should not be empty, the migration 20261125000000_deliverables.sql has not been applied.</p>
        ) : (
          [...byCustomer.entries()].map(([name, list]) => (
            <section key={name} style={{ marginTop: "32px" }}>
              <h2 style={{ margin: 0, fontSize: "19px" }}>{name} <span style={{ ...small, fontWeight: 400 }}>· {list.length}</span></h2>
              {list.map((d) => <Row key={d.id} d={d} />)}
            </section>
          ))
        )}
      </ActingProvider>
    </div>
  );
}
