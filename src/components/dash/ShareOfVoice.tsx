import EngineLogo from "@/components/EngineLogo";
import type { SovScope } from "@/lib/dash/share";
import type { Engine } from "@/lib/scan/engines";

import { engineLabel, pct } from "./Figures";

/**
 * Share of voice (Danny, 15 Nov 2026): for all clusters and each one, the customer and its top competitors by the
 * share of answers naming them over the latest 7 days, per engine with its mark, and the change on a week and a month
 * before. The customer's row is highlighted with its rank. From the brands each answer already names (share.ts).
 */
function Pts({ d }: { d: number | null }) {
  if (d === null) return <span className="faint num">-</span>;
  const n = Math.round(d * 100);
  if (n === 0) return <span className="faint num">0</span>;
  return <span className={`num ${n > 0 ? "up" : "down"}`} title={`${Math.abs(n)} percentage point${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "up" : "down"}`}>{n > 0 ? "▲" : "▼"} {Math.abs(n)}</span>;
}

function Table({ s, engines }: { s: SovScope; engines: readonly Engine[] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Brand</th>
            <th className="r">All engines</th>
            {engines.map((e) => <th key={e} className="r" title={engineLabel(e)}><span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><EngineLogo engine={e} size={13} />{engineLabel(e)}</span></th>)}
            <th className="r">7 days</th>
            <th className="r">30 days</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.key} className={r.you ? "you" : undefined}>
              <td>{r.you ? <strong>{r.name} (you)</strong> : r.name}</td>
              <td className="r num"><strong>{pct(r.share)}</strong></td>
              {engines.map((e) => <td key={e} className="r num">{pct(r.engines[e] ?? null)}</td>)}
              <td className="r"><Pts d={r.d7} /></td>
              <td className="r"><Pts d={r.d30} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rankLine = (s: SovScope) => (s.rank ? `You're #${s.rank} of ${s.of} brands named` : "No answers yet");

export default function ShareOfVoice({ scopes, engines }: { scopes: SovScope[]; engines: readonly Engine[] }) {
  const [all, ...each] = scopes;
  // One cluster is the same table as all of them: drawn once.
  const clusters = each.length > 1 ? each : [];
  return (
    <div className="dash-card" style={{ marginTop: 16 }}>
      <div className="dash-card-head">
        <div>
          <h2>Share of voice</h2>
          <p className="intro">The share of AI answers that name each brand, over the last 7 days. The changes compare with the same 7 days a week and a month earlier, in percentage points.</p>
        </div>
      </div>
      {all ? (
        <>
          <p style={{ margin: "0 0 10px" }}><span className="pill accent">{rankLine(all)}</span> <span className="muted" style={{ fontSize: 13 }}>across all clusters, from {all.answers.toLocaleString("en-GB")} answers</span></p>
          <Table s={all} engines={engines} />
          {clusters.map((s) => (
            <details key={s.id} style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer" }}><strong>{s.name}</strong> <span className="muted" style={{ fontSize: 13 }}>· {rankLine(s)} · {s.answers.toLocaleString("en-GB")} answers</span></summary>
              <div style={{ marginTop: 8 }}><Table s={s} engines={engines} /></div>
            </details>
          ))}
        </>
      ) : <p className="faint" style={{ margin: 0 }}>Share of voice shows once your first answers are in.</p>}
    </div>
  );
}
