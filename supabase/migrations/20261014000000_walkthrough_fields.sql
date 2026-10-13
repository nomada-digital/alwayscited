-- Project: alwayscited (ref bhvjmlrekrwlrabpysja). NOT nomada-dashboards.
--
-- The walkthrough ask's three required fields (Danny, 13 Oct 2026): "name,
-- category and market are included in order for them to submit the form for
-- a loom with luke or demo with danny. These should be required fields."
--
-- Additive only, under the 19 Sep 2026 authorisation: three nullable columns,
-- nothing existing changed, re-runnable. Every row before this has none of
-- the three, which is why they are nullable; both routes refuse an ask
-- without them from now on (src/lib/scan/walkthrough-fields.ts).
--
-- Harmless before or after the deploy. Until this is applied, a write naming
-- the columns is refused and src/lib/scan/walkthrough-store.ts writes the ask
-- again without them, so nothing is lost: the alert to Luke and Danny carries
-- all three either way. /admin/funnel reads the ask's market and falls back
-- to its scan's while the column is missing.
--
--   name      the person's name as typed, whitespace tidied, at most 120
--             characters (WALKTHROUGH_LIMITS.name).
--   category  a sector id from src/config/sector-prices.json - "technology",
--             "other" - checked against that list by the routes. Not
--             constrained here: the list is config and can grow.
--   market    UK or US, the scan's spelling, as scans.market and
--             campaigns.market are checked.
--
-- RLS is already on with no policies; the service role is the only writer.

alter table walkthrough_requests add column if not exists name text;
alter table walkthrough_requests add column if not exists category text;
alter table walkthrough_requests add column if not exists market text check (market in ('UK', 'US'));
