export default function DashNotFound() {
  return (
    <div className="dash">
      <div className="auth">
        <div className="dash-card empty">
          <b>Nothing here</b>
          That page does not exist, or this account cannot see it.
          <div><a className="btn primary" style={{ marginTop: 14 }} href="/dashboards">Back to your dashboard</a></div>
        </div>
      </div>
    </div>
  );
}
