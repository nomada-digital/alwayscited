-- dashboards.alwayscited.com (17 Oct 2026): keyword groups inside a cluster, and the
-- integration data model (GA4, Search Console, Bing Webmaster).
--
-- Additive only: two new tables, three nullable columns, one backfill of a column
-- added here, indexes, RLS on (no policies - every read and write is the service
-- role, as for every other dashboard table).
--
-- A cluster has always held one keyword (tracked_clusters.keyword_id) and its
-- prompts (tracked_questions.cluster_id). Groups split a cluster into the
-- searches that mean the same thing: "staffing agencies" and "recruitment
-- agencies" are one buyer in two vocabularies. A tracked keyword and a prompt
-- may each sit in one group; with no group they are the cluster's own.
-- `terms` is the group's matching rule for keywords the client does not track
-- (the ranking footprint, and Search Console / Bing queries once connected): a
-- query containing any term, lower-cased, falls into the group.
--
-- The daily runner reads prompts and keywords by client (runner.ts), never by
-- cluster or group, so a keyword or prompt added here is read on the next run
-- with no change to the pipeline.

create table if not exists public.keyword_groups (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  cluster_id       uuid not null references public.tracked_clusters(id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  note             text check (note is null or char_length(note) <= 200),
  terms            text[] not null default '{}' check (cardinality(terms) <= 20),
  position         int not null default 0,
  created_by       text,
  created_at       timestamptz not null default now(),
  stopped_on       date,
  stopped_by       text
);
create index if not exists keyword_groups_cluster_live_idx on public.keyword_groups (cluster_id) where stopped_on is null;
create index if not exists keyword_groups_client_idx on public.keyword_groups (client_domain_id);
create unique index if not exists keyword_groups_cluster_live_name_uniq
  on public.keyword_groups (cluster_id, lower(btrim(name))) where stopped_on is null;
alter table public.keyword_groups enable row level security;

-- A keyword's cluster, stated on the keyword. Until now the only link was the
-- cluster's one keyword_id; a cluster with groups holds several.
alter table public.tracked_keywords add column if not exists cluster_id uuid references public.tracked_clusters(id) on delete set null;
alter table public.tracked_keywords add column if not exists group_id uuid references public.keyword_groups(id) on delete set null;
alter table public.tracked_questions add column if not exists group_id uuid references public.keyword_groups(id) on delete set null;
create index if not exists tracked_keywords_cluster_live_idx on public.tracked_keywords (cluster_id) where stopped_on is null;
create index if not exists tracked_keywords_group_idx on public.tracked_keywords (group_id) where group_id is not null;
create index if not exists tracked_questions_group_idx on public.tracked_questions (group_id) where group_id is not null;

-- Backfill the column just added: each cluster's own keyword belongs to it.
update public.tracked_keywords k
   set cluster_id = c.id
  from public.tracked_clusters c
 where c.keyword_id = k.id
   and k.cluster_id is null;

-- One row per client and provider. No token is stored in this table: when the
-- OAuth flow ships, refresh tokens go to Supabase Vault and this row holds the
-- vault secret's id (token_ref) only.
create table if not exists public.integration_connections (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  provider         text not null check (provider in ('ga4', 'gsc', 'bing')),
  status           text not null default 'requested'
    check (status in ('requested', 'pending', 'connected', 'error', 'disconnected')),
  property         text check (property is null or char_length(property) <= 300),
  account_email    text check (account_email is null or char_length(account_email) <= 320),
  scopes           text[] not null default '{}',
  token_ref        uuid,
  requested_by     text,
  requested_at     timestamptz,
  connected_by     text,
  connected_at     timestamptz,
  last_synced_at   timestamptz,
  error            text check (error is null or char_length(error) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_domain_id, provider)
);
alter table public.integration_connections enable row level security;

-- Search Console and Bing Webmaster query rows, one per query (and page, where
-- the provider splits by page) per period. The dashboard sorts them into
-- keyword groups by the groups' terms.
create table if not exists public.search_console_queries (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  provider         text not null check (provider in ('gsc', 'bing')),
  period_start     date not null,
  period_end       date not null,
  query            text not null check (char_length(query) between 1 and 300),
  page             text not null default '' check (char_length(page) <= 500),
  clicks           int not null default 0 check (clicks >= 0),
  impressions      int not null default 0 check (impressions >= 0),
  ctr              numeric(6,4),
  position         numeric(6,2),
  pulled_at        timestamptz not null default now(),
  unique (client_domain_id, provider, period_end, query, page)
);
create index if not exists search_console_queries_client_period_idx on public.search_console_queries (client_domain_id, provider, period_end desc);
alter table public.search_console_queries enable row level security;
