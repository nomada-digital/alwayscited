-- The linking site's whole traffic on a synced link row (Danny, 17 Nov 2026: WLDM's trackers carry "Total Traffic"
-- beside "Page Traffic", and the customer's Links page shows it as Domain traffic). Additive: one nullable column,
-- filled by the next sync (src/lib/links/sheet-parse.ts FIELDS domain_traffic, sheet-store.ts).
alter table public.sheet_links add column if not exists domain_traffic integer;
