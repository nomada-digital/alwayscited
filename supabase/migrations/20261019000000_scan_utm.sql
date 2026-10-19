-- Scan hand-off campaign tags (19 Oct 2026). Additive only: one nullable column every existing row satisfies. A
-- partner hand-off (scans.ref, 20261018030000) also carries the utm_* its page was opened with; /api/scan/start keeps
-- them here, cleaned by lib/scan/handoff.ts cleanUtm (utm_source/medium/campaign/term/content, each at most 200).
alter table public.scans add column if not exists utm jsonb;
