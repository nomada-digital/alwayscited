import { T } from "@/config/tokens";

/** The admin deliverables page's field styles. A plain module: the page (a server component) and Forms (a client one) both read them. */
export const input = { font: "inherit", fontSize: "14px", padding: "8px 10px", border: `1px solid ${T.line}`, borderRadius: "8px", background: T.surface, color: T.ink, width: "100%", boxSizing: "border-box" } as const;
export const label = { display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px", fontWeight: 600 } as const;
export const hint = { fontWeight: 400, color: T.soft } as const;
