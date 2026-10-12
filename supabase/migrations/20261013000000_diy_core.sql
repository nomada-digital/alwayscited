-- DIY P1 core rails (13 Oct 2026; docs/diy-platform-2026-10-12/10-spec.md
-- section 5.8). Additive only, under the 19 Sep 2026 authorisation: three new
-- tables, two indexes on them, one new read-only function with its grants, and
-- nine app_settings rows inserted with on conflict do nothing. No existing
-- table, column, row, constraint or policy is touched. Harmless landing before
-- or after the deploy: nothing reads these until the night dispatch does, and
-- every reader fails closed while they are absent (src/lib/diy/core/ledger.ts
-- refuses a read whose ledger cannot be read; dispatch.ts queues nothing paid
-- while diy_enabled is missing or false).
--
-- diy_reads: the ledger. One row per paid read, written as `reserved` with
-- the request's maximum cost before the read goes out, then settled to ok,
-- partial or failed with what the vendor billed (a failed task keeps its
-- billed cost). A cap refusal is written as `refused` and counts 0. Holds no
-- client text: the endpoint, a hash of the request, counts and dollars.
create table if not exists diy_reads (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid references client_domains(id),
  door text not null check (door in ('labs','backlinks','onpage','content','model')),
  endpoint text not null,
  trigger text not null check (trigger in ('scheduled','on_demand','onboarding')),
  action text,                                  -- 'page_check','example','verify','link_check','log' (on-demand)
  params_hash text not null,
  estimate numeric(10,5) not null,
  cost numeric(10,5),
  rows integer,
  tokens_in integer, tokens_out integer,
  status text not null check (status in ('reserved','ok','partial','failed','refused')),
  code text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists diy_reads_client_created on diy_reads (client_domain_id, created_at desc);
create index if not exists diy_reads_created on diy_reads (created_at);
alter table diy_reads enable row level security;

-- diy_jobs: one row per (client, kind, due day), upserted by the night
-- dispatch from the two existing crons and claimed by the worker with a
-- compare-and-swap. A row is closed by its own worker (done_at, outcome,
-- note); a failure is never swallowed into an empty note.
create table if not exists diy_jobs (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id),
  kind text not null,
  due_on date not null,
  priority smallint not null default 5,
  payload jsonb,
  claimed_at timestamptz, done_at timestamptz,
  attempts smallint not null default 0,
  outcome text check (outcome in ('ok','skipped','deferred','failed')),
  note text,
  created_at timestamptz not null default now(),
  unique (client_domain_id, kind, due_on)
);
create index if not exists diy_jobs_due on diy_jobs (due_on) where done_at is null;
alter table diy_jobs enable row level security;

-- diy_vendor_status: two free vendor reads a UTC day, global, holding no
-- client data: DataForSEO Labs' refresh date (gates the weekly footprint pull)
-- and the Backlinks filter names (confirms the W3 requests' [VERIFY] fields).
create table if not exists diy_vendor_status (
  kind text not null check (kind in ('labs_status','backlinks_filters')),
  read_on date not null,
  google_date date,                                 -- labs_status only
  payload jsonb not null,                           -- labs: the status row; backlinks: the filter names
  primary key (kind, read_on)
);
alter table diy_vendor_status enable row level security;

-- Every sum a reservation checks, in one round trip (section 5.6 item 4).
-- Read-only: it selects and sums, and writes nothing. Refused rows count 0.
create or replace function diy_spend(p_client uuid, p_day_start timestamptz, p_month_start timestamptz)
returns table (global_dfs_today numeric, global_model_today numeric, door_counts jsonb, month_sums jsonb)
language sql stable set search_path = public as $$
  with live as (
    select client_domain_id, door, trigger, created_at, coalesce(cost, estimate) as amount
    from diy_reads
    where status in ('reserved','ok','partial','failed') and created_at >= least(p_day_start, p_month_start)
  )
  select
    coalesce(sum(amount) filter (where door <> 'model' and created_at >= p_day_start), 0),
    coalesce(sum(amount) filter (where door = 'model' and created_at >= p_day_start), 0),
    coalesce((select jsonb_object_agg(k, n) from (
      select trigger || ':' || door as k, count(*) as n from live
      where client_domain_id = p_client and created_at >= p_day_start group by 1) d), '{}'::jsonb),
    coalesce((select jsonb_object_agg(k, a) from (
      select case when door = 'model' then 'model' when trigger = 'on_demand' then 'on_demand' else 'scheduled' end as k,
             sum(amount) as a from live where client_domain_id = p_client and created_at >= p_month_start group by 1) m), '{}'::jsonb)
  from live;
$$;
-- The rule the rest of this directory keeps (20260919161000): PUBLIC's
-- default execute revoked, the service role granted by name.
revoke all on function public.diy_spend(uuid, timestamptz, timestamptz) from public;
grant execute on function public.diy_spend(uuid, timestamptz, timestamptz) to service_role;

-- The switches and caps, seeded off and at the proposed values (section 5.6).
-- Every value here is Danny's to change (section 8.3 Q1); diy_enabled stays
-- false until he sets it. A missing row reads as false or 0, which refuses.
insert into app_settings (key, value) values
  ('diy_enabled','false'::jsonb), ('diy_daily_cost_cap_usd','10'::jsonb), ('diy_daily_model_cap_usd','5'::jsonb),
  ('diy_client_month_scheduled_usd','2.5'::jsonb), ('diy_client_month_ondemand_usd','3'::jsonb), ('diy_client_month_model_usd','2'::jsonb),
  ('diy_trial_month_scheduled_usd','1'::jsonb), ('diy_trial_month_ondemand_usd','1'::jsonb), ('diy_trial_month_model_usd','1'::jsonb)
on conflict (key) do nothing;
