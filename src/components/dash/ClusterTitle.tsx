"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { NAME_MAX } from "@/lib/dash/ops";

import { InlineText } from "./ClusterEditor";

/** The cluster's name, renamed in place. Saved straight to the ops route, then the page redraws. */
export default function ClusterTitle({ slug, id, name, canWrite, demo = false }: { slug: string; id: string; name: string; canWrite: boolean; demo?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(name);
  const [err, setErr] = useState<string | null>(null);
  if (!canWrite) return <>{shown}</>;
  if (editing) {
    return (
      <span style={{ display: "block", fontSize: 18, maxWidth: 520 }}>
        <InlineText
          initial={shown}
          label="Cluster name"
          max={NAME_MAX}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            setEditing(false);
            const next = v.trim();
            if (!next || next === shown) return;
            const was = shown;
            setShown(next);
            // A demo link keeps the new name on the page only.
            if (demo) return;
            const r = await fetch(`/api/dash/${slug}/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "cluster.rename", id, name: next }) }).catch(() => null);
            const j = (await r?.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
            if (!j?.ok) { setShown(was); setErr(j?.message ?? "That did not save."); } else router.refresh();
          }}
        />
      </span>
    );
  }
  return (
    <>
      <button onClick={() => { setErr(null); setEditing(true); }} title="Rename" style={{ all: "unset", cursor: "text" }}>{shown}</button>
      {err ? <span className="field-err" role="alert" style={{ display: "block", fontSize: 13 }}>{err}</span> : null}
    </>
  );
}
