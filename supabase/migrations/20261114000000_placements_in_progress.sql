-- Placements in progress on the customer's dashboard (Danny, 14 Nov 2026: "make it clear we have the other placements
-- in progress. You could include placement title"). Additive only: one new table. TO BE APPLIED BY DISPATCH.
--
-- placements holds a placement once it has an address (url, url_key and domain are required), so a piece written and
-- waiting for the site to publish has nowhere to go there. It waits here instead, one row per sheet placement_id,
-- written by the hub's morning sheet job through /api/hub/agency placements_sync (lib/agency/sheet-placements.ts):
-- the title (Kev's, from the #alwayscited Slack channel, else "Article on <topic>"), the keyword it supports, the
-- month it is expected. When the sheet gives it an address and marks it live, the live placement goes into placements
-- as before and this row is marked live, so it stops showing as in progress.
--
-- Customer-facing: title, keyword and expected month only. No site, domain, price, DR or vendor is ever stored here.
-- Service-role reads only, as every tracking table: RLS on with no policies.
create table if not exists public.placements_in_progress (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  cluster_id       uuid references public.tracked_clusters(id) on delete set null,
  placement_ref    text not null check (placement_ref ~ '^NOM-[0-9]{4,}$'),
  title            text not null check (char_length(title) between 3 and 300),
  title_source     text not null default 'topic' check (title_source in ('slack', 'topic')),
  keyword          text check (keyword is null or char_length(keyword) <= 200),
  expected_month   date check (expected_month is null or extract(day from expected_month) = 1),
  stage            text not null check (stage in ('written', 'awaiting', 'live', 'dropped')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_domain_id, placement_ref)
);
create index if not exists placements_in_progress_client_idx on public.placements_in_progress (client_domain_id, stage);
alter table public.placements_in_progress enable row level security;
