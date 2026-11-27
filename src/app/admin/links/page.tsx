import type { Metadata } from "next";

import { LINK_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { TEAM } from "@/config/team";
import { type InternalItem, listInternal } from "@/lib/links/override";
import { OVERRIDE_STATUSES } from "@/lib/links/stage";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { ActingProvider, LinkForm } from "./Forms";
import { hint, input, label } from "./styles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Links", robots: { index: false, follow: false } };

const card = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "14px", padding: "16px 18px", marginTop: "12px" } as const;
const small = { fontSize: "13px", color: T.soft } as const;
const pill = (tone: "good" | "warn" | "bad" | "plain") => ({ display: "inline-block", fontSize: "12px", fontWeight: 700, padding: "2px 9px", borderRadius: "999px", background: tone === "good" ? T.goodBg : tone === "warn" ? T.warnBg : tone === "bad" ? T.badBg : T.chip, color: tone === "good" ? T.goodFg : tone === "warn" ? T.warnFg : tone === "bad" ? T.badFg : T.soft }) as const;
const day = (iso: string) => iso.slice(0, 10);

function Item({ slug, it }: { slug: string; it: InternalItem }) {
  const o = it.override?.active ? it.override : null;
  const fixed = { slug, source: it.source, kind: it.kind, key: it.key } as const;
  const c = o?.link_check ?? null;
  return (
    <article style={card}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "15px", flex: "1 1 280px", overflowWrap: "anywhere" }}>{it.title}</h3>
        <span style={pill("plain")}>{it.kind === "insertion" ? "Link insertion" : "Placement"}</span>
        <span style={pill(it.stage === "live" ? "good" : it.stage === "off" ? "bad" : "warn")}>{it.stage === "live" ? "Live" : it.stage === "off" ? "Not live" : "In progress"}</span>
        {o ? <span style={pill("plain")}>Manual override</span> : null}
        {it.differs ? <span style={pill("warn")} title="The sheet does not read this item the way the override does. Only staff see this.">Differs from WLDM sheet</span> : null}
      </div>
      <p style={{ ...small, margin: "6px 0 0" }}>
        {it.source === "progress" ? `${it.key} · from Kev's master sheet` : "From the WLDM tracker"} · sheet says: {it.sheet_status ?? "nothing yet"}
        {it.live_url ? <> · <a href={it.live_url} style={{ color: T.accent }}>{it.live_url}</a></> : null}
        {it.anchor_text ? ` · anchor "${it.anchor_text}"` : ""}{it.live_on ? ` · live ${it.live_on}` : ""}
      </p>
      {o ? (
        <p style={{ ...small, margin: "4px 0 0" }}>
          Set to <b>{o.status}</b> by {o.set_by} on {day(o.set_at)}{o.note ? ` · "${o.note}"` : ""}. The sync will not change it, and clears it once the sheet agrees.
        </p>
      ) : it.override?.cleared_at ? (
        <p style={{ ...small, margin: "4px 0 0" }}>Override cleared {day(it.override.cleared_at)}: {it.override.cleared_reason}.</p>
      ) : null}
      {c ? (
        <p style={{ margin: "6px 0 0", fontSize: "13px", color: c.found ? T.goodFg : T.badFg }}>
          Link check {c.found ? "passed" : "FAILED"} ({day(c.checked_at)}): {c.found ? `${c.href}, anchor "${c.anchor ?? ""}"${c.rel ? `, rel="${c.rel}"` : ""}` : c.error}
        </p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", marginTop: "12px", alignItems: "flex-start" }}>
        {it.stage !== "live" ? (
          <div style={{ flex: "1 1 320px", maxWidth: "460px" }}>
            <LinkForm fixed={{ ...fixed, action: "links_set", status: "Live" }} submit="Mark as live">
              <label style={label}><span>Live URL <span style={hint}>(the page the link is on)</span></span><input name="live_url" type="url" required maxLength={LINK_LIMITS.url} defaultValue={it.live_url ?? ""} placeholder="https://" style={input} /></label>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <label style={{ ...label, flex: "1 1 150px" }}><span>Live date</span><input name="live_on" type="date" required maxLength={LINK_LIMITS.day} defaultValue={new Date().toISOString().slice(0, 10)} style={input} /></label>
                <label style={{ ...label, flex: "1 1 150px" }}><span>Check the link is on the page</span>
                  <select name="check" defaultValue="yes" style={input}><option value="yes">Yes, check it</option><option value="no">No, skip the check</option></select>
                </label>
              </div>
              <label style={label}><span>Note <span style={hint}>(optional, internal only)</span></span><input name="note" maxLength={LINK_LIMITS.note} style={input} /></label>
            </LinkForm>
          </div>
        ) : null}
        <details style={{ flex: "1 1 320px", maxWidth: "460px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>Edit stage, URL or anchor</summary>
          <div style={{ marginTop: "10px" }}>
            <LinkForm primary={false} fixed={{ ...fixed, action: "links_set" }} submit="Save">
              <label style={label}><span>Stage</span>
                <select name="status" defaultValue={o?.status ?? (it.stage === "live" ? "Live" : "Content written")} style={input}>{OVERRIDE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </label>
              <label style={label}><span>Live URL <span style={hint}>(needed for Published and Live)</span></span><input name="live_url" type="url" maxLength={LINK_LIMITS.url} defaultValue={it.live_url ?? ""} style={input} /></label>
              <label style={label}><span>Anchor text</span><input name="anchor_text" maxLength={LINK_LIMITS.anchor} defaultValue={it.anchor_text ?? ""} style={input} /></label>
              <label style={label}><span>Live date <span style={hint}>(blank: today if live)</span></span><input name="live_on" type="date" maxLength={LINK_LIMITS.day} defaultValue={it.live_on ?? ""} style={{ ...input, maxWidth: "200px" }} /></label>
              <label style={label}><span>Note <span style={hint}>(internal only)</span></span><input name="note" maxLength={LINK_LIMITS.note} style={input} /></label>
            </LinkForm>
          </div>
        </details>
        {o?.live_url ? (
          <LinkForm primary={false} fixed={{ ...fixed, action: "links_check" }} submit="Re-check the link" />
        ) : null}
      </div>
    </article>
  );
}

/**
 * /admin/links (25 Nov 2026): mark a placement or link insertion live, change its stage or correct its address and
 * anchor when WLDM's sheet is slow. Behind the /admin Basic auth. The customer's dashboard shows the change at once;
 * the sheet sync does not revert it and clears it when the sheet agrees. The same writes are links_* on
 * /api/hub/agency (docs/link-overrides.md).
 */
export default async function LinksAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const slug = typeof sp.slug === "string" && /^[a-z0-9-]{1,80}$/.test(sp.slug) ? sp.slug : "";
  let customers: { slug: string; domain: string }[] = [];
  let loaded: Awaited<ReturnType<typeof listInternal>> | null = null;
  let problem: string | null = null;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("client_domains").select("id, slug, domain, placements_sheet_url, insertions_sheet_url").order("slug");
    if (error) problem = `Could not read customers: ${error.message}`;
    const rows = (data ?? []) as { id: string; slug: string; domain: string; placements_sheet_url: string | null; insertions_sheet_url: string | null }[];
    customers = rows.filter((r) => r.placements_sheet_url || r.insertions_sheet_url).map((r) => ({ slug: r.slug, domain: r.domain }));
    const c = slug ? rows.find((r) => r.slug === slug) : null;
    if (slug && !c) problem = `No customer has the slug ${slug}.`;
    if (c) loaded = await listInternal(db, { id: c.id, slug: c.slug, domain: c.domain });
  } catch (err) {
    problem = `Could not read: ${err instanceof Error ? err.message : String(err)}`;
  }
  return (
    <div style={{ padding: "32px 24px 80px", maxWidth: "980px", margin: "0 auto", color: T.ink }}>
      <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700 }}>Links</h1>
      <p style={{ margin: "8px 0 20px", fontSize: "15px", color: T.soft, maxWidth: "70ch" }}>
        Placements and link insertions still in progress. When the WLDM sheet is behind, mark one live here and the customer sees it at once. Your change stays until the sheet agrees with it; the sync never reverts it.
      </p>
      <ActingProvider defaultValue={TEAM.danny.email}>
        <form method="get" style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap", marginTop: "16px" }}>
          <label style={{ ...label, flex: "1 1 260px", maxWidth: "360px" }}><span>Customer <span style={hint}>(dashboard slug)</span></span>
            <input name="slug" list="customers" required maxLength={LINK_LIMITS.slug} defaultValue={slug} placeholder="customer-slug" style={input} />
            <datalist id="customers">{customers.map((c) => <option key={c.slug} value={c.slug}>{c.domain}</option>)}</datalist>
          </label>
          <button type="submit" style={{ padding: "8px 16px", border: `1px solid ${T.line}`, borderRadius: "8px", background: T.surface, color: T.ink, font: "inherit", fontSize: "14px", fontWeight: 600 }}>Show</button>
        </form>
        {problem ? <p role="alert" style={{ color: T.badFg, marginTop: "16px" }}>{problem}</p> : null}
        {loaded && !loaded.ok ? <p role="alert" style={{ color: T.badFg, marginTop: "16px" }}>{loaded.message}</p> : null}
        {loaded?.ok ? (
          <>
            <h2 style={{ margin: "28px 0 0", fontSize: "19px" }}>{slug} <span style={{ ...small, fontWeight: 400 }}>· {loaded.items.length} in progress or overridden</span></h2>
            {loaded.items.length === 0 ? <p style={{ ...small, marginTop: "12px" }}>Nothing in progress for this customer.</p> : loaded.items.map((it) => <Item key={`${it.source}:${it.kind}:${it.key}`} slug={slug} it={it} />)}
            {loaded.recent.length ? (
              <details style={{ marginTop: "24px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Recent changes ({loaded.recent.length})</summary>
                <ol style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px", lineHeight: 1.7 }}>
                  {loaded.recent.map((e, i) => <li key={i}>{day(e.at)} · <b>{e.action.replace("link_", "").replace(/_/g, " ")}</b> by {e.by}{e.target ? ` · ${e.target}` : ""}</li>)}
                </ol>
              </details>
            ) : null}
          </>
        ) : null}
      </ActingProvider>
    </div>
  );
}
