-- 3 Nov 2026: a scan's cluster keyword position that could not be checked.
--
-- cluster_keyword_rank null has meant "not in Google's top 20". From 30 Oct
-- DataForSEO served degraded pages (most links wrapped as google.com/goto,
-- engines.ts serpFault), and those reads were stored as null too, so the
-- result told prospects they were not in the top 20 when nothing had been
-- measured. True here is "not checked": the result says "Couldn't check" and
-- /api/cron/reap-stalled-scans reads it again daily for 14 days.
--
-- Additive: existing rows take false, which is the meaning they had.

alter table public.scans
  add column if not exists cluster_keyword_rank_unchecked boolean not null default false;

create index if not exists scans_cluster_rank_unchecked_idx
  on public.scans (created_at)
  where cluster_keyword_rank_unchecked;
