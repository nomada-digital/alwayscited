-- The agency view edits a customer, and links reach the dashboard from Google Sheets (Danny, 29 Oct 2026).
--
-- Additive only: new columns (null or defaulted), new tables with RLS on and no policies (the service role is the
-- only reader and writer), indexes, and hub_overview() re-created to leave archived customers out.
--
-- 1. client_domains.archived_at: a customer taken off the books without deleting a row - a test signup, a mistake.
--    An archived customer is left out of the hub's lists and counts (hub_overview below), of the daily check
--    (run-health.ts readTrackable / recordSkips), the DIY nights, the lifecycle sweep and the retention purge, which
--    would otherwise hard-delete it 90 days after it ended. Nothing it holds is removed.
-- 2. client_domains.insertions_sheet_url / placements_sheet_url: the two Google Sheets the agency view keeps per
--    customer - the link insertions tracker WLDM updates, and Kev's placements tracker.
-- 3. tracked_clusters.superseded_by / superseded_on: a cluster whose keyword staff changed. The old cluster is stopped,
--    never deleted, with its keyword and prompts; every reading stays on it, and superseded_by names the cluster that
--    replaced it (lib/agency/edit.ts changeKeyword).
-- 4. agency_edits: every staff edit - who, when, what, the old value and the new.
-- 5. sheet_links / sheet_syncs: the rows read from those sheets, mapped by header name (lib/links/sheet-parse.ts),
--    and each sheet's last sync with its error. Only the columns the dashboard shows are kept: a price, cost or
--    balance column is never read into a row, so it cannot be stored or shown.

alter table public.client_domains add column if not exists archived_at timestamptz;
alter table public.client_domains add column if not exists archived_by text;
alter table public.client_domains add column if not exists archived_reason text;
alter table public.client_domains add column if not exists insertions_sheet_url text;
alter table public.client_domains add column if not exists placements_sheet_url text;

alter table public.tracked_clusters add column if not exists superseded_by uuid references public.tracked_clusters(id) on delete set null;
alter table public.tracked_clusters add column if not exists superseded_on date;

create table if not exists public.agency_edits (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  actor_email      text not null check (char_length(actor_email) between 3 and 320),
  action           text not null check (char_length(action) between 2 and 60),
  target           text,
  old_value        jsonb,
  new_value        jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists agency_edits_client_idx on public.agency_edits (client_domain_id, created_at desc);
alter table public.agency_edits enable row level security;

create table if not exists public.sheet_links (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  kind             text not null check (kind in ('insertion', 'placement')),
  url_key          text not null,
  live_url         text not null,
  linking_domain   text,
  target_keyword   text,
  anchor_text      text,
  target_page      text,
  authority        numeric,
  authority_label  text check (authority_label in ('DR', 'DA')),
  page_traffic     integer,
  status           text,
  live_on          date,
  live_month       text,
  sheet_row        integer,
  on_sheet         boolean not null default true,
  first_seen_at    timestamptz not null default now(),
  synced_at        timestamptz not null default now(),
  unique (client_domain_id, kind, url_key)
);
create index if not exists sheet_links_client_idx on public.sheet_links (client_domain_id, kind, on_sheet);
alter table public.sheet_links enable row level security;

create table if not exists public.sheet_syncs (
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  kind             text not null check (kind in ('insertion', 'placement')),
  sheet_url        text,
  attempted_at     timestamptz,
  synced_at        timestamptz,
  source           text,
  read_on          date,
  rows_kept        integer,
  rows_skipped     integer,
  columns          jsonb,
  error            text,
  primary key (client_domain_id, kind)
);
alter table public.sheet_syncs enable row level security;

create or replace function public.hub_overview()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
select jsonb_build_object(
  'generated_at', now(),
  -- an account whose every site is archived is archived with them; one with no site yet is still listed
  'accounts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'email', lower(a.email), 'agency_name', a.agency_name, 'agency_domain', a.agency_domain,
      'created_at', a.created_at,
      'members', (select count(*) from dashboard_members m where m.account_id = a.id and m.removed_at is null),
      'last_login_at', (select max(m.last_login_at) from dashboard_members m where m.account_id = a.id)
    ) order by a.created_at desc) from accounts a
    where not exists (select 1 from client_domains x where x.account_id = a.id)
       or exists (select 1 from client_domains x where x.account_id = a.id and x.archived_at is null)), '[]'::jsonb),
  'domains', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'account_id', d.account_id, 'domain', d.domain, 'brand_name', d.brand_name, 'market', d.market,
      'slug', d.slug, 'tier', d.tier, 'status', d.status, 'started_on', d.started_on, 'created_at', d.created_at,
      'trial_ends_at', d.trial_ends_at, 'trial_cancelled_at', d.trial_cancelled_at,
      'payment_status', d.payment_status, 'payment_status_at', d.payment_status_at,
      'payment_retry_at', d.payment_retry_at, 'payment_ended_at', d.payment_ended_at,
      'payment_invoice_url', d.payment_invoice_url,
      'last_run_on', (select max(t.run_date) from tracking_runs t where t.client_domain_id = d.id)
    ) order by d.created_at desc) from client_domains d where d.archived_at is null), '[]'::jsonb),
  'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'client_domain_id', o.client_domain_id, 'email', lower(o.email), 'tier', o.tier,
      'quantity', o.quantity, 'market', o.market, 'amount_total', o.amount_total, 'currency', o.currency,
      'created_at', o.created_at, 'trial_ends_at', o.trial_ends_at,
      'stripe_customer_id', o.stripe_customer_id, 'stripe_subscription_id', o.stripe_subscription_id,
      'monthly_amount', o.monthly_amount, 'sector', o.sector
    ) order by o.created_at desc) from orders o
    where not exists (select 1 from client_domains x where x.id = o.client_domain_id and x.archived_at is not null)), '[]'::jsonb),
  'stripe_events', jsonb_build_object('total', (select count(*) from stripe_events),
                                      'last_at', (select max(received_at) from stripe_events))
)
$function$;

revoke all on function public.hub_overview() from public;
revoke all on function public.hub_overview() from anon, authenticated;
grant execute on function public.hub_overview() to service_role;
