-- Customer success, batch A (Danny, 5 Nov 2026): phases 1-4 of the CSM build. From 1 Dec Kev is customer success
-- manager for every alwayscited client. Reviewed and applied by Danny; never applied from a session.
--
-- THE RULE: Fatgrid data, prices, DR and relevance scores, and our placement costs never reach the client view, the
-- client API or this public repo. Every table marked AGENCY-ONLY below has row level security on and no policy, and
-- anon and authenticated hold no grant on it, so only the service role reads it - and in the code only
-- src/lib/csm/ does (csm-isolation.test.mts fails the build if a client route reaches one).
--
-- Additive only: new tables, and nullable columns (or columns with checks every existing row satisfies) on
-- sheet_links and client_domains.

-- ---------------------------------------------------------------- phase 1: the placement shortlist

-- AGENCY-ONLY. One Fatgrid read per domain, reused for LISTING_TTL_DAYS (config/csm.ts) so a re-read costs no unit.
create table if not exists public.fatgrid_listings (
  domain          text primary key check (domain = lower(domain) and char_length(domain) between 3 and 253),
  dr              numeric,
  traffic         bigint,
  best_price_usd  numeric check (best_price_usd is null or best_price_usd >= 0),
  offers          jsonb not null default '[]'::jsonb,
  categories      text[] not null default '{}',
  language        text check (language is null or char_length(language) <= 16),
  sponsored       boolean,
  link_follow     text check (link_follow is null or char_length(link_follow) <= 16),
  fetched_at      timestamptz not null default now()
);

-- AGENCY-ONLY. Each shortlist build: why it ran, the DR floor it used and where that came from, the units it spent.
create table if not exists public.shortlist_runs (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  cluster_id       uuid references public.tracked_clusters(id) on delete set null,
  keyword          text check (keyword is null or char_length(keyword) <= 120),
  reason           text not null check (reason in ('onboarded', 'cluster_changed', 'month_end', 'manual')),
  dr_floor         integer check (dr_floor is null or dr_floor between 0 and 100),
  dr_floor_source  text check (dr_floor_source is null or dr_floor_source in ('serp', 'default')),
  serp_read_on     date,
  units_used       integer not null default 0 check (units_used >= 0),
  outcome          text not null check (outcome in ('ok', 'capped', 'no_key', 'failed')),
  note             text check (note is null or char_length(note) <= 500),
  created_at       timestamptz not null default now()
);
create index if not exists shortlist_runs_client_idx on public.shortlist_runs (client_domain_id, created_at desc);
create index if not exists shortlist_runs_day_idx on public.shortlist_runs (created_at);

-- AGENCY-ONLY. The ranked shortlist and its 3-month queue. One row per (client, cluster, domain, kind), kept across
-- runs: first_run_id says when it appeared, state 'dropped' when a later run no longer finds it. Kev approves;
-- nothing is bought by code.
create table if not exists public.shortlist_items (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  cluster_id       uuid references public.tracked_clusters(id) on delete set null,
  domain           text not null check (char_length(domain) between 3 and 253),
  page_url         text check (page_url is null or char_length(page_url) <= 2048),
  kind             text not null check (kind in ('link_insertion', 'new_listicle', 'guest_post')),
  queue_month      smallint not null check (queue_month between 1 and 3),
  price_usd        numeric check (price_usd is null or price_usd >= 0),
  dr               numeric,
  traffic          bigint,
  cited_by         integer not null default 0 check (cited_by >= 0),
  score            numeric,
  opportunity_id   uuid references public.opportunities(id) on delete set null,
  client_visible   boolean not null default false,
  own_site         boolean not null default false,
  state            text not null default 'proposed' check (state in ('proposed', 'approved', 'rejected', 'bought', 'dropped')),
  first_run_id     uuid references public.shortlist_runs(id) on delete set null,
  last_run_id      uuid references public.shortlist_runs(id) on delete set null,
  decided_by       text check (decided_by is null or char_length(decided_by) <= 254),
  decided_at       timestamptz,
  note             text check (note is null or char_length(note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique nulls not distinct (client_domain_id, cluster_id, domain, kind)
);
create index if not exists shortlist_items_client_idx on public.shortlist_items (client_domain_id, state, queue_month);

-- AGENCY-ONLY. The global monthly cap on what all clients' placements may cost together, in USD (Danny, 5 Nov 2026).
-- One row. The amount is set in the database, never written in this repository: the repository is public and the
-- cap is our cost. Null until it is set, and nothing is allocated while it is null.
create table if not exists public.placement_budget_settings (
  id             boolean primary key default true check (id),
  global_cap_usd numeric check (global_cap_usd is null or global_cap_usd >= 0),
  updated_by     text check (updated_by is null or char_length(updated_by) <= 254),
  updated_at     timestamptz not null default now()
);

-- AGENCY-ONLY. Each client's share of the cap is weighted by its plan price (orders.monthly_amount). A row here
-- replaces that weight, or leaves the client out of the split altogether; no row is the plan price.
create table if not exists public.placement_budgets (
  client_domain_id uuid primary key references public.client_domains(id) on delete cascade,
  weight_override  numeric check (weight_override is null or weight_override >= 0),
  excluded         boolean not null default false,
  note             text check (note is null or char_length(note) <= 300),
  updated_by       text check (updated_by is null or char_length(updated_by) <= 254),
  updated_at       timestamptz not null default now()
);

-- AGENCY-ONLY. A client's own placement budget, set deliberately for a run of months (Danny, 5 Nov 2026: front-loading
-- is context added client by client, not a rule - e.g. a 12-month commitment whose first three months get more).
-- start_month and end_month are optional: no start is "from now", no end is "until cleared". It may exceed the
-- client's share and the cap: that is shown as "over cap by $X, approved by <name>", never refused. The others share
-- what is left of the cap by weight. Ranges for one client do not overlap (lib/csm, at save).
create table if not exists public.placement_budget_overrides (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  start_month      date check (start_month is null or extract(day from start_month) = 1),
  end_month        date check (end_month is null or extract(day from end_month) = 1),
  monthly_usd      numeric not null check (monthly_usd >= 0),
  reason           text not null check (char_length(reason) between 3 and 300),
  approved_by      text not null check (char_length(approved_by) <= 254),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (start_month is null or end_month is null or end_month >= start_month)
);
create index if not exists placement_budget_overrides_client_idx on public.placement_budget_overrides (client_domain_id, start_month);

-- AGENCY-ONLY. The commercial context Kev or Danny keeps on a client: what was agreed, in their words ("12-month
-- commitment at 2k/mo; front-load ~4k/mo placements months 1-3"). Who wrote it and when ride with it.
create table if not exists public.client_commercial_context (
  client_domain_id uuid primary key references public.client_domains(id) on delete cascade,
  notes            text not null default '' check (char_length(notes) <= 4000),
  updated_by       text not null check (char_length(updated_by) <= 254),
  updated_at       timestamptz not null default now()
);

-- AGENCY-ONLY. What was actually spent on placements, in USD, recorded by Kev when he marks an item bought.
create table if not exists public.placement_spend (
  id                uuid primary key default gen_random_uuid(),
  client_domain_id  uuid not null references public.client_domains(id) on delete cascade,
  month             date not null check (extract(day from month) = 1),
  shortlist_item_id uuid references public.shortlist_items(id) on delete set null,
  amount_usd        numeric not null check (amount_usd >= 0),
  description       text not null check (char_length(description) between 2 and 300),
  recorded_by       text not null check (char_length(recorded_by) <= 254),
  created_at        timestamptz not null default now()
);
create index if not exists placement_spend_client_month_idx on public.placement_spend (client_domain_id, month);

-- AGENCY-ONLY. Every Fatgrid unit spent, whoever spent it: the shortlist, and the free scan's difficulty score,
-- which already reads Fatgrid. On the Pro plan units are the bill, so the monthly cap (FATGRID_MONTHLY_UNIT_CAP)
-- is checked against this before any read, and the agency view shows it.
create table if not exists public.fatgrid_usage (
  id               uuid primary key default gen_random_uuid(),
  used_at          timestamptz not null default now(),
  source           text not null check (source in ('shortlist', 'scan_difficulty', 'manual')),
  client_domain_id uuid references public.client_domains(id) on delete set null,
  run_id           uuid references public.shortlist_runs(id) on delete set null,
  units            integer not null check (units >= 0)
);
create index if not exists fatgrid_usage_at_idx on public.fatgrid_usage (used_at);

-- ---------------------------------------------------------------- phase 2: WLDM link insertions

-- sheet_links (20261029000000) already holds WLDM's insertions sheet. The status column is WLDM's own free text;
-- `state` is ours, one of four, and is what the client view shows. The daily audit writes the last two.
alter table public.sheet_links add column if not exists state text
  check (state is null or state in ('in_progress', 'in_review', 'live', 'removed'));
alter table public.sheet_links add column if not exists last_checked_on date;
alter table public.sheet_links add column if not exists link_present boolean;
alter table public.sheet_links add column if not exists dropped_alerted_on date;

alter table public.client_domains add column if not exists wldm_contact text
  check (wldm_contact is null or char_length(wldm_contact) <= 200);

-- AGENCY-ONLY. The column mapping step for an uploaded sheet whose headers do not match ours (WLDM's format varies).
create table if not exists public.sheet_column_maps (
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  kind             text not null check (kind in ('insertion', 'placement')),
  mapping          jsonb not null,
  updated_by       text not null check (char_length(updated_by) <= 254),
  updated_at       timestamptz not null default now(),
  primary key (client_domain_id, kind)
);

-- ---------------------------------------------------------------- phase 3: the trial-ending flow

-- A one-off project marked complete in the hub starts a month of free alwaystracked (trial_ends_at, 20261008010000).
alter table public.client_domains add column if not exists trial_source text
  check (trial_source is null or trial_source in ('project'));
alter table public.client_domains add column if not exists project_ref text
  check (project_ref is null or char_length(project_ref) <= 120);

-- AGENCY-ONLY. Kev's tasks: the trial-ending email draft written as from him, a dropped link to chase, a client
-- message to answer. dedupe_key stops the daily job making the same task twice.
create table if not exists public.csm_tasks (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  kind             text not null check (kind in ('trial_ending', 'link_dropped', 'client_message', 'shortlist_review', 'other')),
  title            text not null check (char_length(title) between 2 and 200),
  due_on           date,
  draft            text check (draft is null or char_length(draft) <= 8000),
  status           text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  dedupe_key       text unique check (dedupe_key is null or char_length(dedupe_key) <= 200),
  created_at       timestamptz not null default now(),
  done_by          text check (done_by is null or char_length(done_by) <= 254),
  done_at          timestamptz
);
create index if not exists csm_tasks_open_idx on public.csm_tasks (status, due_on);

-- ---------------------------------------------------------------- phase 4: message your account manager

-- AGENCY-ONLY to read. Written by the client's support form (through the server, never the browser).
create table if not exists public.client_messages (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  member_email     text not null check (char_length(member_email) between 3 and 254),
  body             text not null check (char_length(body) between 2 and 4000),
  tier             text check (tier is null or char_length(tier) <= 20),
  status           text not null default 'open' check (status in ('open', 'answered')),
  emailed          boolean not null default false,
  slacked          boolean not null default false,
  answered_by      text check (answered_by is null or char_length(answered_by) <= 254),
  answered_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists client_messages_client_idx on public.client_messages (client_domain_id, created_at desc);

-- ---------------------------------------------------------------- the lock on every new table

alter table public.fatgrid_listings enable row level security;
alter table public.shortlist_runs enable row level security;
alter table public.shortlist_items enable row level security;
alter table public.placement_budget_settings enable row level security;
alter table public.placement_budgets enable row level security;
alter table public.placement_budget_overrides enable row level security;
alter table public.client_commercial_context enable row level security;
alter table public.placement_spend enable row level security;
alter table public.sheet_column_maps enable row level security;
alter table public.csm_tasks enable row level security;
alter table public.client_messages enable row level security;
alter table public.fatgrid_usage enable row level security;

revoke all on table public.fatgrid_listings, public.shortlist_runs, public.shortlist_items,
  public.placement_budget_settings, public.placement_budgets, public.placement_budget_overrides,
  public.client_commercial_context, public.placement_spend,
  public.fatgrid_usage, public.sheet_column_maps, public.csm_tasks, public.client_messages from anon, authenticated;
