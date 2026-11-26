-- Copilot citations on the customer dashboard (26 Nov 2026).
-- Bing Webmaster Tools > AI Performance (how often Microsoft Copilot cites the site) is held in the hub; staff push one
-- snapshot per client here (/api/hub/agency copilot_publish). The snapshot has the hub's own shape (generators/bing_ai_export.py):
--   asOf, firstDay, window, from, total, prev, pct, days [[day, citations, cited pages]], pages {from, to, n, total, top [[page, citations]]}
-- A client with no row (or an empty one) shows "First numbers coming soon". Service role only: RLS on, no policies.
create table if not exists public.client_copilot (
  client_domain_id uuid primary key references public.client_domains(id) on delete cascade,
  snapshot         jsonb not null,
  as_of            date,
  updated_by       text,
  updated_at       timestamptz not null default now()
);
alter table public.client_copilot enable row level security;
