-- Dashboard speed work (13 Oct 2026): indexes for the reads every dashboard
-- render makes, by the columns they filter on. None of these costs time today -
-- EXPLAIN on production put every read at 0.2-7.7 ms on 13 Oct, at 0-1,260 rows
-- a table - but each table grows with every client and every day, and three of
-- these reads were sequential scans on 13 Oct.
--
-- Additive only, under the 19 Sep 2026 authorisation, and idempotent: five
-- `create index if not exists`, nothing dropped, altered or rewritten. Harmless
-- landing before or after the deploy: a missing index costs a scan, never a
-- wrong answer. Applied by the lead, not by the package that wrote it.
--
-- 1. dashboard_events (client_domain_id, event): setup-data.ts's setup confirm
--    and report-opened reads filter on both, and the table grows with every
--    page view (UsageBeacon). Only (created_at desc) existed; Seq Scan on 13 Oct.
--
-- 2. tracked_questions (client_domain_id), every row: overview-data.ts
--    loadStructure and prompts/origins.ts readOriginRows read stopped prompts
--    too, which the partial index (where stopped_on is null) cannot serve.
--    Seq Scan on 13 Oct.
--
-- 3. plan_items (client_domain_id, week_of): the Actions badge on every page
--    (shell/work.ts readWeekItems). Only (client_domain_id, status) existed.
--
-- 4. orders (client_domain_id, created_at desc): setup-data.ts
--    loadOrderKeyword, on the Overview, Clusters and Setup. orders had no index
--    on the client at all.
--
-- 5. tracking_serp (keyword_id, run_date desc) where top is not null: each
--    keyword's newest stored top 20 - pages/data.ts newestTops and its
--    one-keyword fallback, and keywords/data.ts readTops' second read. Only
--    (client_domain_id, run_date) existed, and top is null on every row before
--    MS-1, so the partial index holds the rows those reads want and no others.

create index if not exists dashboard_events_client_event_idx
  on public.dashboard_events (client_domain_id, event);

create index if not exists tracked_questions_client_all_idx
  on public.tracked_questions (client_domain_id);

create index if not exists plan_items_client_week_idx
  on public.plan_items (client_domain_id, week_of);

create index if not exists orders_client_created_idx
  on public.orders (client_domain_id, created_at desc);

create index if not exists tracking_serp_keyword_top_idx
  on public.tracking_serp (keyword_id, run_date desc)
  where top is not null;
