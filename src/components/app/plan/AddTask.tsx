import { APP_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { planAction, type PlanKeep } from "@/lib/diy/plan/paths";

import { DARK, FIELD, H2, LABEL, OFF, SECTION, SMALL } from "./styles";

/**
 * Add a task (13 Oct 2026, DIY P3; spec 10 section 4.6): a title of 1-200
 * characters and an optional cluster, posted to the plan route's `add`. It
 * lands in To do, as "Your task". The "+ Add" menu's "Add a task" links here
 * (`/plan?view=list#new-task`: spec 10 section 3.1 wrote `#add`, which the
 * palette census reads as the colour #aadddd). A viewer sees it disabled with the reason.
 *
 * `compact` (13 Oct 2026, Danny: "keep Add a task easy to find"): the list
 * draws it at the top of In progress, a row under a small heading rather
 * than its own card. The page draws one or the other, never both, so the
 * anchor and the field ids stay unique.
 */
export default function AddTask({ slug, keep, clusters, canWrite, reason, compact = false }: { slug: string; keep: PlanKeep; clusters: readonly { id: string; name: string }[]; canWrite: boolean; reason: string; compact?: boolean }) {
  const off = canWrite ? {} : { disabled: true, "aria-describedby": "new-task-ro" };
  const offStyle = canWrite ? {} : OFF;
  const box = compact
    ? { display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px", borderRadius: "14px", border: `1px dashed ${T.washLine}`, background: T.surface, minWidth: 0, scrollMarginTop: "16px" }
    : { ...SECTION, scrollMarginTop: "16px" };
  return (
    <section id="new-task" aria-labelledby="new-task-h" style={box as React.CSSProperties}>
      <h2 id="new-task-h" style={compact ? { ...H2, fontSize: "14px" } : H2}>
        Add a task
      </h2>
      <form method="post" action={planAction(slug, keep)} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "10px" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "3 1 240px", minWidth: 0 }}>
          <label htmlFor="new-task-title" style={LABEL}>
            Task (up to {APP_LIMITS.task} characters)
          </label>
          <input id="new-task-title" name="title" type="text" required maxLength={APP_LIMITS.task} style={{ ...FIELD, width: "100%", ...offStyle }} {...off} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 180px", minWidth: 0 }}>
          <label htmlFor="new-task-cluster" style={LABEL}>
            Cluster (optional)
          </label>
          <select id="new-task-cluster" name="cluster" defaultValue="" style={{ ...FIELD, width: "100%", ...offStyle }} {...off}>
            <option value="">No cluster</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </span>
        <button type="submit" name="do" value="add" style={{ ...DARK, ...offStyle }} {...off}>
          Add to To do
        </button>
      </form>
      {canWrite ? null : (
        <p id="new-task-ro" style={SMALL}>
          {reason}
        </p>
      )}
    </section>
  );
}
