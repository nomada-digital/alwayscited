-- DIY P8, Your pages (13 Oct 2026; docs/diy-platform-2026-10-12/10-spec.md
-- sections 4.9, 6.4, 6.5 and 5.8). Additive only, under the 19 Sep 2026
-- authorisation: five new tables and their indexes. No existing table,
-- column, row, constraint or policy is touched, and no app_settings row is
-- added. Harmless landing before or after the deploy: the pages read each
-- table as a section and say it could not be read rather than reading it as
-- empty, and the two night jobs are registered by the shell (P9) only.
--
-- Foreign keys (decided 13 Oct 2026, before anything was applied): every
-- client_domain_id cascades, as diy_jobs, plan_items and every tracking table
-- do, so a hand delete of a client takes its pages with it rather than
-- failing; every cluster_id is set null, so a row outlives a deleted cluster;
-- every read_id to the diy_reads ledger is set null, as the ledger's own row
-- outlives what it paid for. key_page_id on page_checks is set null too: a
-- removed key page is a removed_on date, never a delete, and its checks are
-- its history.
--
-- One table beyond the spec's four, top_structures: the top 3 organic results'
-- structure for each cluster keyword, read monthly through content_parsing
-- (section 6.5, "structure only: title, h1, h2/h3, a date pattern found, word
-- count; no body text stored"). The spec says where they are read and not
-- where they are kept; the diagnostics table and the drafted example's input
-- both read them, so they are stored once here. Headings only, each at most
-- 120 characters and at most 40 a page, as page_reads holds them (P7): no
-- third-party prose is kept.
--
-- Service-role reads only, authorisation in the app, as every tracking table:
-- RLS on with no policies.

-- key_pages: at most 10 live per client (allowances.ts key_pages), picked
-- by the weekly job or added by a member. A member-removed page keeps its row
-- with removed_on, so an auto page the member removed is never added again.
create table if not exists key_pages (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  url text not null check (char_length(url) <= 500),
  url_key text not null,
  origin text not null check (origin in ('homepage','ranking','cited_own','relevant','member')),
  cluster_ids uuid[],
  added_by text not null,
  added_on date not null,
  removed_on date,
  removed_by text
);
create unique index if not exists key_pages_live on key_pages (client_domain_id, url_key) where removed_on is null;
alter table key_pages enable row level security;

-- page_checks: one row per read of one key page - our own weekly fetch
-- (via own, free) or the monthly or on-demand read with JavaScript and the
-- validator (via instant_pages, paid). Summaries only, never HTML. The two
-- schema payloads hold types, property names, and per-result a level and a
-- message of at most 160 characters (at most 40 results), never a value;
-- the writer (src/lib/diy/pages/own-parse.ts capSchemaPayload) trims them to
-- that before insert, and the checks are the backstop.
create table if not exists page_checks (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  key_page_id uuid references key_pages(id) on delete set null,
  url text not null check (char_length(url) <= 500),
  url_key text not null,
  checked_at timestamptz not null,
  via text not null check (via in ('own','instant_pages')),
  trigger text not null check (trigger in ('scheduled','on_demand','onboarding')),
  status text not null check (status in ('ok','unreadable')),
  http_status integer,
  final_url text check (final_url is null or char_length(final_url) <= 500),
  basics jsonb,
  fix jsonb,
  schema_found jsonb check (schema_found is null or pg_column_size(schema_found) <= 16384),
  schema_results jsonb check (schema_results is null or pg_column_size(schema_results) <= 16384),
  content_hash text,
  word_count integer,
  rendered_word_count integer,
  read_id uuid references diy_reads(id) on delete set null
);
create index if not exists page_checks_client_url on page_checks (client_domain_id, url_key, checked_at desc);
alter table page_checks enable row level security;

-- bot_checks: the weekly robots.txt and llms.txt read, and each key page's
-- status, noindex and canonical. robots holds each crawler's verdict and the
-- line that decides it (each at most 200 characters), never the whole file.
create table if not exists bot_checks (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  checked_at timestamptz not null,
  robots_status integer,
  robots jsonb,
  llms_txt_status integer,
  pages jsonb
);
create index if not exists bot_checks_client_checked on bot_checks (client_domain_id, checked_at desc);
alter table bot_checks enable row level security;

-- reopt_examples: one drafted re-optimisation example, written in after() by
-- the pages route (on demand, 10 a month). A row still pending 10 minutes
-- after requested_at is read as failed (the function that was writing it
-- died) and is not counted. Only ready rows count against the allowance
-- (usage-meter.ts). inputs holds what the example was built from by name
-- (the keyword, the prompts, the top 3 URLs, the diagnostics): never the
-- client page's text and never a third party's.
create table if not exists reopt_examples (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  cluster_id uuid references tracked_clusters(id) on delete set null,
  url text not null check (char_length(url) <= 500),
  url_key text not null,
  status text not null check (status in ('pending','ready','failed')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  inputs jsonb,
  example jsonb,
  guard_hits jsonb,
  error text check (error is null or char_length(error) <= 300),
  read_id uuid references diy_reads(id) on delete set null
);
create index if not exists reopt_examples_client_requested on reopt_examples (client_domain_id, requested_at desc);
alter table reopt_examples enable row level security;

-- top_structures: the structure of the top 3 organic results for a cluster
-- keyword, read monthly (content_parsing, $0.00015 a page). Headings and
-- flags only; no body text, and the title and h1 cut to what a heading is.
create table if not exists top_structures (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  cluster_id uuid references tracked_clusters(id) on delete set null,
  keyword_id uuid,
  read_on date not null,
  rank smallint not null check (rank between 1 and 20),
  url text not null check (char_length(url) <= 500),
  url_key text not null,
  status text not null check (status in ('ok','unreadable')),
  title text check (title is null or char_length(title) <= 300),
  h1 text check (h1 is null or char_length(h1) <= 200),
  headings jsonb,
  date_shown boolean,
  word_count integer,
  read_id uuid references diy_reads(id) on delete set null
);
create index if not exists top_structures_client_read on top_structures (client_domain_id, read_on desc);
alter table top_structures enable row level security;
