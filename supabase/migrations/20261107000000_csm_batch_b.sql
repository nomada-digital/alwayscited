-- CSM batch B (7 Nov 2026): the placement shortlist's quality gates. Additive only: two columns tables already have
-- room for, one new agency-only table. Kev's first shortlist for Common (6 Nov 2026) was three sites he could not use -
-- two with US traffic that Fatgrid labelled UK, one about music. lib/csm/host-gates.ts is the rule; this is where its
-- readings and Kev's reasons are kept.

-- What a host was found to be, per client: its traffic share in the client's market (DataForSEO Labs, every location
-- in one read) and whether it covers the client's topic (one model call over the homepage's headlines). Read again
-- after HOST_CHECK_TTL_DAYS. Cut out of shortlist_items so a host that failed - and so has no item - is still known,
-- and a rerun pays nothing to fail it again.
-- AGENCY-ONLY. A host's market share and topical fit for one client.
create table if not exists public.shortlist_host_checks (
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  domain           text not null check (domain = lower(domain) and char_length(domain) between 3 and 253),
  market           text check (market is null or char_length(market) <= 8),
  market_share     numeric check (market_share is null or (market_share >= 0 and market_share <= 1)),
  market_etv       numeric check (market_etv is null or market_etv >= 0),
  total_etv        numeric check (total_etv is null or total_etv >= 0),
  geo_read_on      timestamptz,
  fits             boolean,
  fit_reason       text check (fit_reason is null or char_length(fit_reason) <= 300),
  fit_read_on      timestamptz,
  primary key (client_domain_id, domain)
);

-- Each suggestion carries what it was let through on, and a rejection carries why. A domain rejected once is not
-- suggested to that client again, whatever the cluster or kind (shortlist.ts reads state = 'rejected').
alter table public.shortlist_items add column if not exists market_share numeric
  check (market_share is null or (market_share >= 0 and market_share <= 1));
alter table public.shortlist_items add column if not exists market text
  check (market is null or char_length(market) <= 8);
alter table public.shortlist_items add column if not exists fit_reason text
  check (fit_reason is null or char_length(fit_reason) <= 300);
alter table public.shortlist_items add column if not exists reject_reason text
  check (reject_reason is null or reject_reason in ('wrong_market', 'off_topic', 'low_quality', 'other'));

-- Where the inventory pull got to, so a rerun reads the next page rather than paying again for the one it has seen:
-- {"sig": filter signature, "page_size": n, "guest_post": next page, "link_insertion": next page}.
alter table public.shortlist_runs add column if not exists inventory_cursor jsonb;

alter table public.shortlist_host_checks enable row level security;

revoke all on table public.shortlist_host_checks from anon, authenticated;
