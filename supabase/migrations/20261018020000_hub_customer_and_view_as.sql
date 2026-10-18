-- The agency hub's customer view and "What the customer sees" (18 Oct 2026). Additive only: one table, two read/mint
-- functions. RLS on, no policies; both functions are service role only and security invoker (the service role
-- bypasses RLS, so definer would buy nothing - function-grants.test.mts). The hub reaches them through the
-- nomada-dashboards edge function alwayscited-admin, which first checks the caller is an agency user with the
-- alwayscited workspace (can_see_workspace), exactly as for hub_overview().

-- A view-as token: lets one agency user open one client's real dashboard read-only at
-- dashboards.alwayscited.com/view/<token>/<slug>, for 30 minutes. Only the sha256 of the token is stored (the same
-- hash as dashboard_sessions / dashboard_login_tokens, tracking/session.ts hashToken). Every mint and every use is
-- kept here: who asked, for which client, when it was first and last used, and how many pages it served.
create table if not exists public.dashboard_view_tokens (
  token_hash        text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  client_domain_id  uuid not null references public.client_domains(id) on delete cascade,
  slug              text not null,
  created_by        text not null check (char_length(created_by) between 3 and 254),
  -- the owner whose dashboard it shows, read at mint time; the dashboards host re-checks their membership on every page
  as_email          text not null check (char_length(as_email) between 3 and 254),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  first_used_at     timestamptz,
  last_used_at      timestamptz,
  uses              integer not null default 0,
  revoked_at        timestamptz
);
create index if not exists dashboard_view_tokens_client_idx on public.dashboard_view_tokens (client_domain_id, created_at desc);
alter table public.dashboard_view_tokens enable row level security;
-- as_email was added after the table's first apply (same day, before any row existed).
alter table public.dashboard_view_tokens add column if not exists as_email text not null check (char_length(as_email) between 3 and 254);

-- Mint one: a 64-hex token (the shape tracking/session.ts isTokenShape accepts), returned once, stored hashed.
create or replace function public.hub_view_as(p_slug text, p_by text)
returns jsonb language plpgsql volatile set search_path = public, extensions as $$
declare c record; owner_email text; t text; exp timestamptz := now() + interval '30 minutes';
begin
  select id, slug, account_id into c from client_domains where slug = p_slug;
  if c.id is null then return jsonb_build_object('error', 'no_client'); end if;
  if coalesce(trim(p_by), '') = '' then return jsonb_build_object('error', 'no_caller'); end if;
  select lower(m.email) into owner_email from dashboard_members m
   where m.account_id = c.account_id and m.removed_at is null order by (m.role = 'owner') desc, m.created_at limit 1;
  if owner_email is null then return jsonb_build_object('error', 'no_owner'); end if;
  t := encode(extensions.gen_random_bytes(32), 'hex');
  insert into dashboard_view_tokens (token_hash, client_domain_id, slug, created_by, as_email, expires_at)
  values (encode(extensions.digest(t, 'sha256'), 'hex'), c.id, c.slug, lower(trim(p_by)), owner_email, exp);
  return jsonb_build_object('token', t, 'slug', c.slug, 'expires_at', exp);
end $$;

-- One customer, everything the agency view shows: the client and its billing state, the account and who signs in,
-- each cluster with its target page (a live member key page listing it, dash/target.ts), groups, keywords and
-- prompts, placements for delivery against the package, tracking runs and the checkout orders.
create or replace function public.hub_customer(p_slug text)
returns jsonb language sql stable set search_path = public as $$
with c as (
  select id, account_id, slug, domain, brand_name, topic, market, tier, status, started_on, created_at, cluster_limit,
         question_limit, keyword_limit, trial_ends_at, trial_cancelled_at, payment_status, payment_status_at,
         payment_retry_at, payment_ended_at, payment_invoice_url
    from client_domains where slug = p_slug)
select case when not exists (select 1 from c) then jsonb_build_object('error', 'no_client') else jsonb_build_object(
  'generated_at', now(),
  'client', (select jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'domain', c.domain, 'brand_name', c.brand_name, 'topic', c.topic, 'market', c.market,
      'tier', c.tier, 'status', c.status, 'started_on', c.started_on, 'created_at', c.created_at,
      'cluster_limit', c.cluster_limit, 'question_limit', c.question_limit, 'keyword_limit', c.keyword_limit,
      'trial_ends_at', c.trial_ends_at, 'trial_cancelled_at', c.trial_cancelled_at,
      'payment_status', c.payment_status, 'payment_status_at', c.payment_status_at, 'payment_retry_at', c.payment_retry_at,
      'payment_ended_at', c.payment_ended_at, 'payment_invoice_url', c.payment_invoice_url) from c),
  'account', (select jsonb_build_object('email', lower(a.email), 'agency_name', a.agency_name, 'created_at', a.created_at)
      from accounts a join c on c.account_id = a.id),
  'members', coalesce((select jsonb_agg(jsonb_build_object('email', lower(m.email), 'role', m.role, 'last_login_at', m.last_login_at) order by m.created_at)
      from dashboard_members m join c on c.account_id = m.account_id where m.removed_at is null), '[]'::jsonb),
  'clusters', coalesce((select jsonb_agg(jsonb_build_object(
      'id', tc.id, 'name', tc.name, 'tier', tc.tier, 'started_on', tc.started_on, 'stopped_on', tc.stopped_on,
      'keyword', (select k.keyword from tracked_keywords k where k.id = tc.keyword_id),
      'target', (select kp.url from key_pages kp where kp.client_domain_id = tc.client_domain_id and kp.removed_on is null
                   and kp.origin = 'member' and tc.id = any(kp.cluster_ids) order by kp.added_on desc limit 1),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'note', g.note, 'terms', g.terms) order by g.position)
          from keyword_groups g where g.cluster_id = tc.id and g.stopped_on is null), '[]'::jsonb),
      'keywords', coalesce((select jsonb_agg(jsonb_build_object('keyword', k.keyword, 'volume', k.search_volume, 'intent', k.intent,
          'group_id', k.group_id, 'added_on', k.added_on) order by k.added_on, k.keyword)
          from tracked_keywords k where k.cluster_id = tc.id and k.stopped_on is null), '[]'::jsonb),
      'prompts', coalesce((select jsonb_agg(jsonb_build_object('text', q.text, 'angle', q.angle, 'origin', coalesce(q.origin_kind, q.source),
          'group_id', q.group_id, 'added_on', q.added_on) order by q.added_on, q.text)
          from tracked_questions q where q.cluster_id = tc.id and q.stopped_on is null), '[]'::jsonb)
    ) order by tc.started_on, tc.name) from tracked_clusters tc join c on c.id = tc.client_domain_id where tc.stopped_on is null), '[]'::jsonb),
  'placements', coalesce((select jsonb_agg(jsonb_build_object('cluster_id', p.cluster_id, 'kind', p.kind, 'status', p.status, 'url', p.url,
      'domain', p.domain, 'anchor_text', p.anchor_text, 'scheduled_on', p.scheduled_on, 'live_on', p.live_on, 'internal_note', p.internal_note) order by p.created_at desc)
      from placements p join c on c.id = p.client_domain_id where p.status <> 'removed'), '[]'::jsonb),
  'runs', (select jsonb_build_object('count', count(*), 'first', min(r.run_date), 'last', max(r.run_date),
      'last_status', (select r2.status from tracking_runs r2 join c on c.id = r2.client_domain_id order by r2.run_date desc limit 1))
      from tracking_runs r join c on c.id = r.client_domain_id),
  'orders', coalesce((select jsonb_agg(jsonb_build_object('tier', o.tier, 'quantity', o.quantity, 'market', o.market, 'amount_total', o.amount_total,
      'currency', o.currency, 'created_at', o.created_at, 'trial_ends_at', o.trial_ends_at,
      'stripe_customer_id', o.stripe_customer_id, 'stripe_subscription_id', o.stripe_subscription_id) order by o.created_at desc)
      from orders o join c on c.id = o.client_domain_id), '[]'::jsonb),
  'view_as', (select jsonb_build_object('count', count(*), 'last_at', max(v.created_at), 'last_by', (array_agg(v.created_by order by v.created_at desc))[1])
      from dashboard_view_tokens v join c on c.id = v.client_domain_id)
) end
$$;

revoke all on function public.hub_view_as(text, text) from public, anon, authenticated;
revoke all on function public.hub_customer(text) from public, anon, authenticated;
grant execute on function public.hub_view_as(text, text) to service_role;
grant execute on function public.hub_customer(text) to service_role;
