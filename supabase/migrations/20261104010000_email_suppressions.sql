-- Unsubscribe and follow-up consent for free-scan leads (Danny, 3 Nov 2026).
--
-- email_suppressions: one row per address that unsubscribed, from the link in every report email and follow-up
-- (/scan/<report token>/unsubscribe, or the List-Unsubscribe one-click POST to /api/unsubscribe/<report token>). Stored
-- lower case. Service role only, as every table here: RLS on, no policies.
--
-- dashboard_scan_leads() adds two keys to each email entry, for the hub to send by:
--   suppressed     the address is in email_suppressions.
--   follow_up_ok   not suppressed, and either not a free-mail address (B2B follow-up on the report requested,
--                  legitimate interests) or a free-mail address whose owner ticked the tips box. False otherwise.
--                  An entry with no free_domain reading (unlock, walkthrough, order) counts as not free.
--
-- Additive: a new table, and create or replace of the export with the same signature and grants.

create table if not exists public.email_suppressions (
  email text primary key check (email = lower(email) and length(email) <= 254),
  created_at timestamptz not null default now(),
  source text not null default 'unsubscribe_link' check (length(source) <= 40),
  scan_id uuid references public.scans(id) on delete set null
);
alter table public.email_suppressions enable row level security;

create or replace function public.dashboard_scan_leads()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
with s as (
  select * from scans where campaign_id is null and not is_tracking_run
),
latest as (
  select distinct on (domain, coalesce(market,'UK')) domain, coalesce(market,'UK') market,
         public_token, engine_results
  from s where status = 'complete' order by domain, coalesce(market,'UK'), created_at desc
),
named as (
  select domain, market,
         (select sum((e->>'answered')::int) from jsonb_array_elements(engine_results) e) answered,
         (select sum((e->>'named')::int) from jsonb_array_elements(engine_results) e) named,
         public_token
  from latest
),
em as (
  select s.domain, coalesce(s.market,'UK') market, l.email, 'unlock' kind, l.created_at at, l.marketing_ok, l.verified_at is not null verified,
         null::text lead_name, null::boolean free_domain, s.internal
    from leads l join s on s.id = l.scan_id
  union all
  select s.domain, coalesce(s.market,'UK'), s.report_email, 'report', coalesce(s.report_email_at, s.created_at), s.marketing_opt_in, null,
         s.lead_name, s.email_free_domain, s.internal
    from s where s.report_email is not null
  union all
  select s.domain, coalesce(s.market,'UK'), w.email, w.kind, w.created_at, null, null, null, null, s.internal
    from walkthrough_requests w join s on s.id = w.scan_id
  union all
  select s.domain, coalesce(s.market,'UK'), o.email, 'order', o.created_at, null, null, null, null, s.internal
    from orders o join s on s.public_token = o.scan_token
),
emails as (
  select em.domain, em.market,
         jsonb_agg(jsonb_build_object('email', lower(em.email), 'kind', em.kind, 'at', em.at, 'marketing_ok', em.marketing_ok, 'verified', em.verified,
                                    'name', em.lead_name, 'free_domain', em.free_domain, 'internal', em.internal,
                                    'suppressed', x.email is not null,
                                    'follow_up_ok', x.email is null and (not coalesce(em.free_domain, false) or coalesce(em.marketing_ok, false)))
                   order by em.at) emails,
         min(em.at) email_at
  from em left join email_suppressions x on x.email = lower(em.email)
  group by em.domain, em.market
),
agg as (
  select domain, coalesce(market,'UK') market,
         (array_agg(brand_name order by created_at desc) filter (where brand_name is not null))[1] brand_name,
         (array_agg(topic order by created_at desc) filter (where topic is not null))[1] topic,
         count(*) scans, count(distinct ip_hash) visitors, count(*) filter (where status='complete') finished,
         min(created_at) first_at, max(created_at) last_at,
         (array_agg(case status::text when 'pending_topic' then 'abandoned' when 'queued' then 'running' else status::text end order by created_at desc))[1] last_status,
         (array_agg(ref order by created_at desc) filter (where ref is not null))[1] ref,
         (array_agg(utm order by created_at desc) filter (where utm is not null))[1] utm,
         bool_and(internal) internal
  from s group by domain, coalesce(market,'UK')
)
select coalesce(jsonb_agg(jsonb_build_object(
  'domain', a.domain, 'market', a.market, 'brand_name', a.brand_name, 'topic', a.topic,
  'scans', a.scans, 'visitors', a.visitors, 'finished', a.finished,
  'first_at', a.first_at, 'last_at', a.last_at, 'last_status', a.last_status,
  'report_token', n.public_token, 'answered', n.answered, 'named', n.named,
  'emails', coalesce(e.emails, '[]'::jsonb), 'email_at', e.email_at,
  'ref', a.ref, 'utm', a.utm, 'internal', a.internal)), '[]'::jsonb)
from agg a left join named n using (domain, market) left join emails e using (domain, market);
$function$;
