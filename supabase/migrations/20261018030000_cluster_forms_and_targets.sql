-- Phase 2 of the 18 Oct 2026 brief (alwayscited-claude-code-brief.md, 2a / 2b / 2c / 2e).
--
-- Additive only: four nullable or defaulted columns, one default changed, one backfill of
-- columns added here, indexes, and one settings row seeded false. Nothing is dropped.
--
-- 2a. Every plan's limits are 10 clusters, 50 prompts, 10 keywords. limits.ts derives them
--     from cluster_limit (5 prompts and one primary keyword per cluster) and has not read
--     question_limit since 30 Sep, but the hub and the admin pages still show it, so it says
--     50 to match the site rather than the 20 it was seeded with.
--
-- 2c. A cluster's keyword may have its plural (or singular) beside it: same cluster, same
--     target page, no allowance used. `form` says which a row is; `pair_of` points a plural or
--     singular at the primary it belongs to, and goes with it. The keyword allowance counts
--     form = 'primary' only (limits.ts). One live pair per primary.
--
-- 2b. A placement states the page it links to and the keyword form its anchor is for. Both
--     default from the cluster in the writer (target.ts / placement-target.ts), not here: the
--     cluster's target page is a live key_pages row (origin 'member', 20261018 target pages),
--     which a column default cannot read.
--
-- 2e. email_payment_failed_enabled, seeded false like every lifecycle flag. It is switched on
--     with the others only after Danny approves the test sends.

alter table public.client_domains alter column question_limit set default 50;
update public.client_domains set question_limit = 50 where question_limit < 50;

alter table public.tracked_keywords add column if not exists form text not null default 'primary';
alter table public.tracked_keywords add column if not exists pair_of uuid references public.tracked_keywords(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tracked_keywords_form_check') then
    alter table public.tracked_keywords add constraint tracked_keywords_form_check
      check (form in ('primary', 'plural', 'singular') and ((form = 'primary') = (pair_of is null)));
  end if;
end $$;
create unique index if not exists tracked_keywords_one_live_pair on public.tracked_keywords (pair_of) where pair_of is not null and stopped_on is null;

-- Backfill: the two comped clients were set up (18 Oct) with each cluster's plural as a second
-- live keyword. A live keyword in the same cluster that is exactly the cluster keyword's plural
-- (+s, or y -> ies) becomes that keyword's pair. Group keywords that are other words stay primary.
update public.tracked_keywords k
   set form = 'plural', pair_of = c.keyword_id
  from public.tracked_clusters c
  join public.tracked_keywords p on p.id = c.keyword_id
 where k.cluster_id = c.id and k.id <> c.keyword_id and k.stopped_on is null and p.stopped_on is null
   and k.form = 'primary' and p.form = 'primary'
   and lower(k.keyword) in (lower(p.keyword) || 's', regexp_replace(lower(p.keyword), 'y$', 'ies'));

alter table public.placements add column if not exists target_page_id uuid references public.key_pages(id) on delete set null;
alter table public.placements add column if not exists target_keyword_id uuid references public.tracked_keywords(id) on delete set null;

insert into app_settings (key, value) values ('email_payment_failed_enabled', 'false'::jsonb)
on conflict (key) do nothing;
