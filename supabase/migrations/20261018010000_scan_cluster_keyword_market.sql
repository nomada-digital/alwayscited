-- Scan cluster keyword market (18 Oct 2026). Additive only: two nullable columns; existing rows are null, which every
-- check below accepts. The cluster keyword, its volume and intent were stored with no record of the market and topic
-- they were read for, and reuse compared against scans.market/topic - which only /confirm writes - so switching the
-- market on the questions screen and back reused a keyword picked for the other market, and /confirm could start a
-- scan in one market with a keyword read in the other (target-keyword.ts clusterKeywordFits).
alter table public.scans add column if not exists cluster_keyword_market text check (cluster_keyword_market is null or cluster_keyword_market in ('UK', 'US'));
alter table public.scans add column if not exists cluster_keyword_topic text check (cluster_keyword_topic is null or char_length(cluster_keyword_topic) <= 400);
