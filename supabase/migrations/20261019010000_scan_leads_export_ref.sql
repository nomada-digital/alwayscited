-- dashboard_scan_leads(): the hub's read of free scans (nomada-dashboards supabase/2026-10-05_scan_leads.md), which
-- was applied to production on 5 Oct and never committed here. Recorded now, with two additions (19 Oct 2026): the
-- latest `ref` and `utm` a domain's scans carry (scans.ref 20261018030000, scans.utm 20261019000000), so the hub can
-- route a partner hand-off to the alwayscited workspace instead of Nomada's pipeline. Same signature, same grants:
-- create or replace only.
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
  select s.domain, coalesce(s.market,'UK') market, l.email, 'unlock' kind, l.created_at at, l.marketing_ok, l.verified_at is not null verified
    from leads l join s on s.id = l.scan_id
  union all
  select s.domain, coalesce(s.market,'UK'), s.report_email, 'report', coalesce(s.report_email_at, s.created_at), null, null
    from s where s.report_email is not null
  union all
  select s.domain, coalesce(s.market,'UK'), w.email, w.kind, w.created_at, null, null
    from walkthrough_requests w join s on s.id = w.scan_id
  union all
  select s.domain, coalesce(s.market,'UK'), o.email, 'order', o.created_at, null, null
    from orders o join s on s.public_token = o.scan_token
),
emails as (
  select domain, market,
         jsonb_agg(jsonb_build_object('email', lower(email), 'kind', kind, 'at', at, 'marketing_ok', marketing_ok, 'verified', verified) order by at) emails,
         min(at) email_at
  from em group by domain, market
),
agg as (
  select domain, coalesce(market,'UK') market,
         (array_agg(brand_name order by created_at desc) filter (where brand_name is not null))[1] brand_name,
         (array_agg(topic order by created_at desc) filter (where topic is not null))[1] topic,
         count(*) scans, count(distinct ip_hash) visitors, count(*) filter (where status='complete') finished,
         min(created_at) first_at, max(created_at) last_at,
         (array_agg(case status::text when 'pending_topic' then 'abandoned' when 'queued' then 'running' else status::text end order by created_at desc))[1] last_status,
         (array_agg(ref order by created_at desc) filter (where ref is not null))[1] ref,
         (array_agg(utm order by created_at desc) filter (where utm is not null))[1] utm
  from s group by domain, coalesce(market,'UK')
)
select coalesce(jsonb_agg(jsonb_build_object(
  'domain', a.domain, 'market', a.market, 'brand_name', a.brand_name, 'topic', a.topic,
  'scans', a.scans, 'visitors', a.visitors, 'finished', a.finished,
  'first_at', a.first_at, 'last_at', a.last_at, 'last_status', a.last_status,
  'report_token', n.public_token, 'answered', n.answered, 'named', n.named,
  'emails', coalesce(e.emails, '[]'::jsonb), 'email_at', e.email_at,
  'ref', a.ref, 'utm', a.utm)), '[]'::jsonb)
from agg a left join named n using (domain, market) left join emails e using (domain, market);
$function$;
