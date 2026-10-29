-- Jamaica as a free-scan market (29 Oct 2026, Danny): The LAB's partner page (/partners/the-lab) offers US and Jamaica.
-- Only `scans` widens. client_domains, campaigns, walkthrough_requests, orders and keyword_research stay UK/US: the
-- code keeps JM to the free scan's own doors (domain.ts isScanMarket, handoff.ts partnerMayUse), and a signup from a
-- JM scan is tracked in the market paid for (webhook.ts signupMarket), never JM.
--
-- Widening a check means replacing it, so this drops and re-adds both constraints in one transaction. Every existing
-- row is UK or US and satisfies the new check. Applied by Danny, not by an agent: AGENTS.md keeps every drop off
-- an agent's list.

begin;

alter table scans drop constraint if exists scans_market_check;
alter table scans add constraint scans_market_check check (market in ('UK', 'US', 'JM'));

alter table scans drop constraint if exists scans_cluster_keyword_market_check;
alter table scans add constraint scans_cluster_keyword_market_check
  check (cluster_keyword_market is null or cluster_keyword_market in ('UK', 'US', 'JM'));

commit;
