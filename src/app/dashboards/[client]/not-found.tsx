import Link from "next/link";

export default function DashNotFound() {
  return (
    <div className="dash">
      <div className="auth">
        <div className="dash-card empty">
          <b>Nothing here</b>
          That page does not exist, or this account cannot see it.
          <div><Link className="btn primary" style={{ marginTop: 14 }} href="/dashboards">Back to your dashboard</Link></div>
        </div>
      </div>
    </div>
  );
}
