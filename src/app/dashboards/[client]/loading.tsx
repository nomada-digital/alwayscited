/** Drawn while a page on the dashboards host is read: the page's shape, so the switch is instant and nothing jumps. */
export default function DashLoading() {
  const block = (h: number) => <div className="dash-card" style={{ height: h, background: "var(--surface)" }} />;
  return (
    <div aria-busy="true" aria-label="Loading">
      <div style={{ height: 14, width: 160, borderRadius: 6, background: "var(--chip)", marginBottom: 12 }} />
      <div style={{ height: 30, width: 320, borderRadius: 8, background: "var(--chip)", marginBottom: 28 }} />
      <div className="dash-grid k4" style={{ marginBottom: 16 }}>{block(118)}{block(118)}{block(118)}{block(118)}</div>
      {block(260)}
    </div>
  );
}
