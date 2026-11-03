-- Email before the scan runs (Danny, 3 Nov 2026): "Where should we send your report?" on the confirm step.
--
-- The address itself goes where the report email already reads it: scans.report_email, stamped at
-- scans.report_email_at, and sent on completion by lib/scan/report-mail.ts. A second lead_email column would be
-- a second copy of that fact, so there is none. What is new:
--   lead_name          the optional first name, 80 characters at most
--   marketing_opt_in   the unticked box; false unless ticked. The report email is transactional and needs neither.
--   email_free_domain  gmail.com and the like: accepted, flagged. Null where no address was given.
--   internal           a team scan (an allowlisted email or domain, or a browser marked as team from /admin):
--                      the gate is skipped and the scan is left out of the hub's lead counts.
-- dashboard_scan_leads() exposes them for the hub to decide with (Danny, 3 Nov): each email entry carries name,
-- marketing_ok, free_domain and internal; each domain row carries internal, true when every one of its scans is a
-- team scan. The hub promotes non-internal rows with an email to new_business itself. ingest_scan_leads() reads
-- named keys, so the new ones pass through it untouched until the hub reads them.
--
-- Additive: four columns that existing rows satisfy (nulls and the false defaults), and create or replace of the
-- one function, same signature and grants.

alter table public.scans add column if not exists lead_name text check (lead_name is null or length(lead_name) <= 80);
alter table public.scans add column if not exists marketing_opt_in boolean not null default false;
alter table public.scans add column if not exists email_free_domain boolean;
alter table public.scans add column if not exists internal boolean not null default false;

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
  select domain, market,
         jsonb_agg(jsonb_build_object('email', lower(email), 'kind', kind, 'at', at, 'marketing_ok', marketing_ok, 'verified', verified,
                                    'name', lead_name, 'free_domain', free_domain, 'internal', internal) order by at) emails,
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
