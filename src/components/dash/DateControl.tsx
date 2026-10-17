"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import Icon from "./Icon";

const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Step through every reading since tracking began, and pick one to compare
 * against (17 Oct 2026). The choice lives in the URL (`?date=`, `?vs=`), so
 * a view can be bookmarked or sent, and the back button walks it.
 */
export default function DateControl({ dates, date, vs, compare = true }: { dates: string[]; date: string; vs: string | null; compare?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };
  const i = dates.indexOf(date);
  const older = i > 0 ? dates[i - 1]! : null;
  const newer = i >= 0 && i < dates.length - 1 ? dates[i + 1]! : null;
  const newestFirst = [...dates].reverse();
  return (
    <div className="datectl" role="group" aria-label="Choose a reading">
      <button className="btn sm" onClick={() => older && go({ date: older })} disabled={!older} aria-label="Older reading"><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><Icon name="arrow" size={14} /></span></button>
      <select className="field" value={date} onChange={(e) => go({ date: e.target.value })} aria-label="Reading date">
        {newestFirst.map((d, n) => <option key={d} value={d}>{label(d)}{n === 0 ? " (latest)" : ""}</option>)}
      </select>
      <button className="btn sm" onClick={() => newer && go({ date: newer })} disabled={!newer} aria-label="Newer reading"><Icon name="arrow" size={14} /></button>
      {compare ? (
        <>
          <span className="muted" style={{ fontSize: 12.5, marginLeft: 6 }}>compare with</span>
          <select className="field" value={vs ?? ""} onChange={(e) => go({ vs: e.target.value || null })} aria-label="Compare with">
            <option value="">nothing</option>
            {older ? <option value={older}>the reading before ({label(older)})</option> : null}
            {newestFirst.filter((d) => d !== date && d !== older).map((d) => <option key={d} value={d}>{label(d)}</option>)}
          </select>
        </>
      ) : null}
    </div>
  );
}
