-- Data retention after a plan ends (Danny, 18 Oct 2026: "customer data should be kept for 90 days"). Additive only.
--
-- 1. client_domains.ended_at: when the client last became ended. Kept by a trigger rather than by each writer, so
--    every path that ends a client (a cancellation in signup.ts, an unpaid or paused end in payment.ts, an admin)
--    starts the clock, and a client brought back clears it. payment_ended_at stays what it was: an end for payment.
-- 2. retention_purges: one row per client the nightly retention pass purged - what, when, and whether its account
--    went too - so the record outlives the data.
-- 3. app_settings: retention_days (90) and retention_purge_enabled (false). The pass is a dry run until the switch
--    holds jsonb true (lib/tracking/retention-purge.ts).
alter table public.client_domains add column if not exists ended_at timestamptz;

create or replace function public.client_domains_ended_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    new.ended_at := coalesce(new.ended_at, now());
  elsif new.status is distinct from 'ended' and old.status = 'ended' then
    new.ended_at := null;
  end if;
  return new;
end $$;

-- A trigger function is never called directly; revoked from PUBLIC and granted only to the service role, as every
-- function here is (function-grants.test.mts).
revoke all on function public.client_domains_ended_at() from public, anon, authenticated;
grant execute on function public.client_domains_ended_at() to service_role;

create or replace trigger client_domains_ended_at
  before update of status on public.client_domains
  for each row execute function public.client_domains_ended_at();

-- Clients already ended before this ran: their end as the payment record has it, else today (none on 18 Oct 2026).
update public.client_domains set ended_at = coalesce(payment_ended_at, now()) where status = 'ended' and ended_at is null;

create table if not exists public.retention_purges (
  id               bigint generated always as identity primary key,
  client_domain_id uuid not null,
  slug             text,
  domain           text,
  ended_at         timestamptz,
  account_removed  boolean not null default false,
  purged_at        timestamptz not null default now()
);
alter table public.retention_purges enable row level security;

insert into public.app_settings (key, value) values
  ('retention_days', '90'::jsonb),
  ('retention_purge_enabled', 'false'::jsonb)
on conflict (key) do nothing;
