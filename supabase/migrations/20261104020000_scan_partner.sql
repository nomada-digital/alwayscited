-- Partner scans (Danny, 4 Nov 2026: "make sure the email gate doesn't affect the partner links").
--
-- A scan from an outside partner's page (lib/scan/handoff.ts EXTERNAL_PARTNERS - today 'thelab', /partners/the-lab)
-- skips the report gate and belongs to the partner's prospect, never Nomada's new business. scans.ref cannot say so
-- on its own: it also carries our own entry points ('nomada', 'blog-<slug>'), whose scans are ours.
--   scans.partner   the outside partner's code, set by /api/scan/[token]/confirm; null for every other scan.
-- Backfilled for scans already run from The LAB's page. dashboard_scan_leads() carries `partner` on each domain row
-- (the latest) and on each email entry, and an email on a partner scan is never follow_up_ok.
--
-- Additive: a nullable column with a check existing rows satisfy, a backfill of that column, and create or replace
-- of the export with the same signature and grants. Needs 20261104010000 (email_suppressions) applied first.

alter table public.scans add column if not exists partner text check (partner is null or length(partner) <= 32);
update public.scans set partner = ref where partner is null and ref = 'thelab';

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
         null::text lead_name, null::boolean free_domain, s.internal, s.partner
    from leads l join s on s.id = l.scan_id
  union all
  select s.domain, coalesce(s.market,'UK'), s.report_email, 'report', coalesce(s.report_email_at, s.created_at), s.marketing_opt_in, null,
         s.lead_name, s.email_free_domain, s.internal, s.partner
    from s where s.report_email is not null
  union all
  select s.domain, coalesce(s.market,'UK'), w.email, w.kind, w.created_at, null, null, null, null, s.internal, s.partner
    from walkthrough_requests w join s on s.id = w.scan_id
  union all
  select s.domain, coalesce(s.market,'UK'), o.email, 'order', o.created_at, null, null, null, null, s.internal, s.partner
    from orders o join s on s.public_token = o.scan_token
),
emails as (
  select em.domain, em.market,
         jsonb_agg(jsonb_build_object('email', lower(em.email), 'kind', em.kind, 'at', em.at, 'marketing_ok', em.marketing_ok, 'verified', em.verified,
                                    'name', em.lead_name, 'free_domain', em.free_domain, 'internal', em.internal,
                                    'suppressed', x.email is not null, 'partner', em.partner,
                                    'follow_up_ok', x.email is null and em.partner is null
                                                    and (not coalesce(em.free_domain, false) or coalesce(em.marketing_ok, false)))
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
         bool_and(internal) internal,
         (array_agg(partner order by created_at desc) filter (where partner is not null))[1] partner
  from s group by domain, coalesce(market,'UK')
)
select coalesce(jsonb_agg(jsonb_build_object(
  'domain', a.domain, 'market', a.market, 'brand_name', a.brand_name, 'topic', a.topic,
  'scans', a.scans, 'visitors', a.visitors, 'finished', a.finished,
  'first_at', a.first_at, 'last_at', a.last_at, 'last_status', a.last_status,
  'report_token', n.public_token, 'answered', n.answered, 'named', n.named,
  'emails', coalesce(e.emails, '[]'::jsonb), 'email_at', e.email_at,
  'ref', a.ref, 'utm', a.utm, 'internal', a.internal, 'partner', a.partner)), '[]'::jsonb)
from agg a left join named n using (domain, market) left join emails e using (domain, market);
$function$;
