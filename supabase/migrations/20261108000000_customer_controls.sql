-- Customer controls on the dashboards host (Danny, 7 Nov 2026). Additive only: two columns, two tables, one function.
--
-- 1. Team: a member's first name (required when an owner adds someone) and last name (optional). `name` stays, as
--    the first and last name together, for every reader that already shows it.
-- 2. Swapping the plan cluster: a customer picks one of their tracking-only clusters to take a plan cluster's place.
--    It takes effect on the 1st of next month - work in progress on the old cluster carries on until then - when the
--    old cluster becomes tracking-only and the new one is worked on the plan. One pending swap per client; it can be
--    cancelled until it applies. No billing change: the plan keeps the same number of clusters.
-- 3. Adding a cluster to the plan is a billing step: the customer's request, with the price it would add (from the
--    sector table in sector-prices.json, or this customer's own Stripe order), waits for the CSM to confirm. Nothing
--    is charged automatically.
-- apply_plan_swaps(today) applies every pending swap that is due; the dashboard and the daily check call it.
-- Service role only (RLS on, no policies), like every other table the dashboards host writes through supabaseAdmin.

alter table public.dashboard_members add column if not exists first_name text
  check (first_name is null or char_length(btrim(first_name)) between 1 and 60);
alter table public.dashboard_members add column if not exists last_name text
  check (last_name is null or char_length(btrim(last_name)) between 1 and 60);
-- a name already held becomes the first name, where it is one plausible word or two (backfill of the column just added)
update public.dashboard_members set first_name = split_part(btrim(name), ' ', 1),
       last_name = nullif(btrim(substr(btrim(name), char_length(split_part(btrim(name), ' ', 1)) + 1)), '')
 where first_name is null and name is not null and btrim(name) <> '' and char_length(btrim(name)) <= 120;

create table if not exists public.plan_swap_requests (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  from_cluster_id  uuid not null references public.tracked_clusters(id) on delete cascade,
  to_cluster_id    uuid not null references public.tracked_clusters(id) on delete cascade,
  effective_on     date not null check (extract(day from effective_on) = 1),
  status           text not null default 'pending' check (status in ('pending', 'applied', 'cancelled')),
  requested_by     text not null check (char_length(requested_by) <= 254),
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_by     text check (cancelled_by is null or char_length(cancelled_by) <= 254),
  applied_at       timestamptz,
  check (from_cluster_id <> to_cluster_id)
);
create unique index if not exists plan_swap_requests_one_pending on public.plan_swap_requests (client_domain_id) where status = 'pending';
alter table public.plan_swap_requests enable row level security;

create table if not exists public.plan_upgrade_requests (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  cluster_id       uuid references public.tracked_clusters(id) on delete set null,
  keyword          text check (keyword is null or char_length(keyword) between 2 and 120),
  price_amount     integer check (price_amount is null or price_amount >= 0),   -- minor units a month, as Stripe
  currency         text check (currency is null or currency in ('usd', 'gbp')),
  price_source     text check (price_source is null or price_source in ('sector', 'order', 'call')),
  status           text not null default 'requested' check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  requested_by     text not null check (char_length(requested_by) <= 254),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       text check (decided_by is null or char_length(decided_by) <= 254),
  note             text check (note is null or char_length(note) <= 500),
  check (cluster_id is not null or keyword is not null)
);
create index if not exists plan_upgrade_requests_client on public.plan_upgrade_requests (client_domain_id, status);
alter table public.plan_upgrade_requests enable row level security;

-- Every pending swap due by p_today: the old cluster becomes tracking-only, the new one takes the client's plan tier.
-- Returns how many applied. Idempotent: an applied or cancelled swap is never touched again.
create or replace function public.apply_plan_swaps(p_today date)
returns integer
language plpgsql
as $$
declare
  s record;
  n integer := 0;
begin
  for s in
    select r.id, r.client_domain_id, r.from_cluster_id, r.to_cluster_id, c.tier
      from public.plan_swap_requests r join public.client_domains c on c.id = r.client_domain_id
     where r.status = 'pending' and r.effective_on <= p_today
     for update of r
  loop
    update public.tracked_clusters set tier = 'tracked' where id = s.from_cluster_id and client_domain_id = s.client_domain_id;
    update public.tracked_clusters set tier = s.tier where id = s.to_cluster_id and client_domain_id = s.client_domain_id and stopped_on is null;
    update public.plan_swap_requests set status = 'applied', applied_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.apply_plan_swaps(date) from public, anon, authenticated;
