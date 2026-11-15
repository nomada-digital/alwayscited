-- Search Console and GA4 connected direct (Danny, 15 Nov 2026; src/lib/dash/google.ts, google-io.ts). The customer
-- adds the hub's Google service account to their own property; alwayscited reads it through the hub's edge function
-- google-data. Additive only: new columns on integration_connections, and the tables the daily pull writes.
-- Like every 17 Oct integration table: RLS on, no policies, read and written by the server alone.

-- How a connection reads (windsor: the 2 Nov route, still Bing's; google: direct), what Search Console says our
-- access is (siteRestrictedUser, siteFullUser, siteOwner - a sitemap submit needs Full), the property's name, and
-- when the 16-month first pull finished.
alter table public.integration_connections add column if not exists via text not null default 'windsor' check (via in ('windsor', 'google'));
alter table public.integration_connections add column if not exists permission text check (permission is null or char_length(permission) <= 40);
alter table public.integration_connections add column if not exists property_name text check (property_name is null or char_length(property_name) <= 300);
alter table public.integration_connections add column if not exists backfilled_at timestamptz;

-- Search Console's site totals by day, 16 months back.
create table if not exists public.gsc_daily (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  day              date not null,
  clicks           int not null default 0 check (clicks >= 0),
  impressions      int not null default 0 check (impressions >= 0),
  ctr              numeric(6,4),
  position         numeric(6,2),
  pulled_at        timestamptz not null default now(),
  unique (client_domain_id, day)
);

-- GA4 sessions and key events by day and default channel group.
create table if not exists public.ga4_channel_days (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  day              date not null,
  channel          text not null check (char_length(channel) between 1 and 100),
  sessions         int not null default 0 check (sessions >= 0),
  key_events       numeric(12,2) not null default 0 check (key_events >= 0),
  pulled_at        timestamptz not null default now(),
  unique (client_domain_id, day, channel)
);

-- GA4 organic landing pages per calendar month.
create table if not exists public.ga4_pages (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  page             text not null check (char_length(page) between 1 and 500),
  sessions         int not null default 0 check (sessions >= 0),
  key_events       numeric(12,2) not null default 0 check (key_events >= 0),
  pulled_at        timestamptz not null default now(),
  unique (client_domain_id, period_end, page)
);

-- GA4 key events by name per calendar month.
create table if not exists public.ga4_events (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  event_name       text not null check (char_length(event_name) between 1 and 100),
  count            numeric(12,2) not null default 0 check (count >= 0),
  pulled_at        timestamptz not null default now(),
  unique (client_domain_id, period_end, event_name)
);

-- URL Inspection's last answer for a key page (staff only at first).
create table if not exists public.gsc_inspections (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  url              text not null check (char_length(url) between 1 and 600),
  verdict          text check (verdict is null or char_length(verdict) <= 40),
  coverage         text check (coverage is null or char_length(coverage) <= 200),
  last_crawl       timestamptz,
  inspected_at     timestamptz not null default now(),
  unique (client_domain_id, url)
);

create index if not exists gsc_daily_client_day_idx on public.gsc_daily (client_domain_id, day desc);
create index if not exists ga4_channel_days_client_day_idx on public.ga4_channel_days (client_domain_id, day desc);

alter table public.gsc_daily enable row level security;
alter table public.ga4_channel_days enable row level security;
alter table public.ga4_pages enable row level security;
alter table public.ga4_events enable row level security;
alter table public.gsc_inspections enable row level security;

revoke all on table public.gsc_daily, public.ga4_channel_days, public.ga4_pages, public.ga4_events, public.gsc_inspections from anon, authenticated;
