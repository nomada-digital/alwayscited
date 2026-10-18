-- Scan hand-off ref (18 Oct 2026). Additive only: one nullable column, which every existing row satisfies, and a
-- partial index for routing. A partner site hands a visitor over with /scan?domain=...&ref=<code> (nomadadigital.co.uk
-- sends ref=nomada); /api/scan/start keeps the checked code here (lib/scan/handoff.ts scanRef: lowercase letters,
-- digits, '-' and '_', at most SCAN_LIMITS.ref = 32), so those leads can be routed to the alwayscited side.
alter table public.scans add column if not exists ref text
  check (ref is null or (char_length(ref) <= 32 and ref ~ '^[a-z0-9][a-z0-9_-]{0,31}$'));
create index if not exists scans_ref_idx on public.scans (ref, created_at desc) where ref is not null;
