-- Connect your data (2 Nov 2026, Danny, sg-37). GA4 for alwayscited customers who connect it
-- themselves on the dashboard: Check connection marks integration_connections connected, and the
-- 05:00 cron (api/cron/track, lib/dash/connect-io.ts) pulls Windsor's last 28 days into this table
-- every morning. Sessions and conversions by day, source and medium; nothing personal.
-- Additive only. search_console_queries (20261017000000) already takes Search Console and Bing.

create table if not exists public.ga4_daily (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  day              date not null,
  source           text not null default '(none)' check (char_length(source) <= 200),
  medium           text not null default '(none)' check (char_length(medium) <= 200),
  sessions         int not null default 0 check (sessions >= 0),
  conversions      numeric(12,2) not null default 0 check (conversions >= 0),
  pulled_at        timestamptz not null default now(),
  unique (client_domain_id, day, source, medium)
);
create index if not exists ga4_daily_client_day_idx on public.ga4_daily (client_domain_id, day desc);
-- Service role only, like search_console_queries: no policy, so nothing reads it but the server.
alter table public.ga4_daily enable row level security;
