-- The monthly price of each order, for the agency hub's book value (Danny, 23 Oct 2026).
--
-- orders.amount_total is the first payment: with VAT, after any discount, and 0 on a trial or a 100% code, so it
-- cannot say what a customer is worth a month. monthly_amount is the plan's price a month before VAT and before
-- discounts, in the smallest unit, as checkout priced it (session.ts and hub-offer.ts put it on the Session's
-- metadata; webhook.ts orderRow writes it). Null on an order made before this.
--
-- Additive only: a column, a check existing rows satisfy (null), the backfill of that column for the two orders
-- made before it, and hub_overview() returning it with the order's sector.

alter table public.orders add column if not exists monthly_amount integer;

do $$ begin
  alter table public.orders add constraint orders_monthly_amount_check check (monthly_amount is null or monthly_amount >= 0);
exception when duplicate_object then null; end $$;

-- The two orders before this, priced as checkout priced them (config/sector-prices.json, UK, marketing):
-- alwaysmentioned GBP 1,295 and the alwayscited plan GBP 2,795 a month, one cluster each. Stripe's next invoice for
-- the first reads GBP 1,295 + VAT (checked in the Stripe dashboard, 23 Oct 2026); the second's first payment was
-- GBP 3,354.00, which is 2,795 + 20% VAT.
update public.orders set monthly_amount = 129500
 where monthly_amount is null and tier = 'mentioned' and sector = 'marketing' and market = 'uk' and quantity = 1 and currency = 'gbp'
   and client_domain_id = '6ea41701-3041-4bdc-ba9f-6533800beb04';
update public.orders set monthly_amount = 279500
 where monthly_amount is null and tier = 'cited' and sector = 'marketing' and market = 'uk' and quantity = 1 and currency = 'gbp'
   and amount_total = 335400;

create or replace function public.hub_overview()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
select jsonb_build_object(
  'generated_at', now(),
  'accounts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'email', lower(a.email), 'agency_name', a.agency_name, 'agency_domain', a.agency_domain,
      'created_at', a.created_at,
      'members', (select count(*) from dashboard_members m where m.account_id = a.id and m.removed_at is null),
      'last_login_at', (select max(m.last_login_at) from dashboard_members m where m.account_id = a.id)
    ) order by a.created_at desc) from accounts a), '[]'::jsonb),
  'domains', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'account_id', d.account_id, 'domain', d.domain, 'brand_name', d.brand_name, 'market', d.market,
      'slug', d.slug, 'tier', d.tier, 'status', d.status, 'started_on', d.started_on, 'created_at', d.created_at,
      'trial_ends_at', d.trial_ends_at, 'trial_cancelled_at', d.trial_cancelled_at,
      'payment_status', d.payment_status, 'payment_status_at', d.payment_status_at,
      'payment_retry_at', d.payment_retry_at, 'payment_ended_at', d.payment_ended_at,
      'payment_invoice_url', d.payment_invoice_url,
      'last_run_on', (select max(t.run_date) from tracking_runs t where t.client_domain_id = d.id)
    ) order by d.created_at desc) from client_domains d), '[]'::jsonb),
  'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'client_domain_id', o.client_domain_id, 'email', lower(o.email), 'tier', o.tier,
      'quantity', o.quantity, 'market', o.market, 'amount_total', o.amount_total, 'currency', o.currency,
      'created_at', o.created_at, 'trial_ends_at', o.trial_ends_at,
      'stripe_customer_id', o.stripe_customer_id, 'stripe_subscription_id', o.stripe_subscription_id,
      'monthly_amount', o.monthly_amount, 'sector', o.sector
    ) order by o.created_at desc) from orders o), '[]'::jsonb),
  'stripe_events', jsonb_build_object('total', (select count(*) from stripe_events),
                                      'last_at', (select max(received_at) from stripe_events))
)
$function$;

revoke all on function public.hub_overview() from public;
revoke all on function public.hub_overview() from anon, authenticated;
grant execute on function public.hub_overview() to service_role;
