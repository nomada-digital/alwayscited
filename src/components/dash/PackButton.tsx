/**
 * Straight to Stripe Checkout for an extra tracking pack (17 Oct 2026), from
 * wherever an allowance runs out. A plain form post, so it works before the
 * page has hydrated; the route answers with Stripe's page. Owners only; a
 * demo or anyone else is told why not.
 */
export default function PackButton({ slug, owner, demo, label, small = false }: { slug: string; owner: boolean; demo: boolean; label: string; small?: boolean }) {
  if (demo) return <span className="muted" style={{ fontSize: 12.5 }}>Adding a pack is not available in a read-only view.</span>;
  if (!owner) return <span className="muted" style={{ fontSize: 12.5 }}>The account owner can add more.</span>;
  return (
    <form action={`/api/dash/${slug}/pack`} method="post" style={{ display: "inline" }}>
      <button type="submit" className={`btn primary${small ? " sm" : ""}`}>{label}</button>
    </form>
  );
}
