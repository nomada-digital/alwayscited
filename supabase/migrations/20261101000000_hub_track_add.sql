-- hub_track_add (1 Nov 2026, Danny): when an alwayscited.com blog post goes live, the hub's blog-track function adds its
-- keywords and buyer prompts to our own alwayscited.com profile (client_domains slug alwayscited-com). Called with the
-- service role through PostgREST; refuses every other profile, so a client's tracking is never touched.
--
-- p_topic is the post's content-plan cluster: the live cluster of that name is used, or a new one is started (its first
-- primary keyword becomes the cluster keyword). Keywords already live (any cluster, case blind) come back "already";
-- a plural whose singular is live goes in as its pair (form 'plural', free under the limits). Prompts: source and
-- origin 'nomada', at most PROMPTS_PER_CLUSTER (5) live per cluster and cluster_limit x 5 per profile, as limits.ts
-- counts them. The profile is comped and in-house, so its cluster_limit goes to 40 for the blog's topics.
-- Security invoker: the service role bypasses RLS already (function-grants.test.mts).

update public.client_domains set cluster_limit = greatest(cluster_limit, 40) where slug = 'alwayscited-com';

create or replace function public.hub_track_add(p_slug text, p_topic text, p_keywords jsonb, p_prompts jsonb, p_by text)
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  c public.client_domains;
  cl uuid;
  k jsonb; q jsonb;
  t text; id uuid; pair uuid;
  kout jsonb := '[]'::jsonb; qout jsonb := '[]'::jsonb;
  today date := current_date;
begin
  if p_slug is distinct from 'alwayscited-com' then return jsonb_build_object('error', 'not_in_house'); end if;
  select * into c from public.client_domains where slug = p_slug;
  if c.id is null then return jsonb_build_object('error', 'no_client'); end if;
  if coalesce(btrim(p_topic), '') = '' then return jsonb_build_object('error', 'no_topic'); end if;

  select tc.id into cl from public.tracked_clusters tc
   where tc.client_domain_id = c.id and tc.stopped_on is null and lower(tc.name) = lower(btrim(p_topic)) limit 1;
  if cl is null then
    if (select count(*) from public.tracked_clusters where client_domain_id = c.id and stopped_on is null) >= c.cluster_limit then
      return jsonb_build_object('error', 'cluster_limit');
    end if;
    insert into public.tracked_clusters (client_domain_id, name, tier, started_on)
    values (c.id, left(btrim(p_topic), 120), c.tier, today) returning tracked_clusters.id into cl;
  end if;

  for k in select * from jsonb_array_elements(coalesce(p_keywords, '[]'::jsonb)) loop
    t := lower(regexp_replace(btrim(k->>'text'), '\s+', ' ', 'g'));
    if t is null or char_length(t) < 2 or char_length(t) > 120 then
      kout := kout || jsonb_build_object('text', t, 'status', 'skipped'); continue;
    end if;
    if exists (select 1 from public.tracked_keywords where client_domain_id = c.id and stopped_on is null and lower(keyword) = t) then
      kout := kout || jsonb_build_object('text', t, 'status', 'already'); continue;
    end if;
    pair := null;
    if k->>'plural_of' is not null then
      select tk.id into pair from public.tracked_keywords tk
       where tk.client_domain_id = c.id and tk.stopped_on is null and tk.form = 'primary' and lower(tk.keyword) = lower(k->>'plural_of')
         and not exists (select 1 from public.tracked_keywords x where x.pair_of = tk.id and x.stopped_on is null)
       limit 1;
    end if;
    insert into public.tracked_keywords (client_domain_id, keyword, added_on, added_by, cluster_id, form, pair_of, search_volume)
    values (c.id, t, today, p_by, cl, case when pair is null then 'primary' else 'plural' end, pair,
            nullif(k->>'volume', '')::int)
    returning tracked_keywords.id into id;
    if pair is null then
      update public.tracked_clusters set keyword_id = id where tracked_clusters.id = cl and keyword_id is null;
    end if;
    kout := kout || jsonb_build_object('text', t, 'status', 'added');
  end loop;

  for q in select * from jsonb_array_elements(coalesce(p_prompts, '[]'::jsonb)) loop
    t := btrim(q->>'text');
    if t is null or char_length(t) < 8 or char_length(t) > 300 then
      qout := qout || jsonb_build_object('text', t, 'status', 'skipped'); continue;
    end if;
    if exists (select 1 from public.tracked_questions where client_domain_id = c.id and stopped_on is null and lower(btrim(text)) = lower(t)) then
      qout := qout || jsonb_build_object('text', t, 'status', 'already'); continue;
    end if;
    if (select count(*) from public.tracked_questions where cluster_id = cl and stopped_on is null) >= 5
       or (select count(*) from public.tracked_questions where client_domain_id = c.id and stopped_on is null) >= c.cluster_limit * 5 then
      qout := qout || jsonb_build_object('text', t, 'status', 'skipped'); continue;
    end if;
    insert into public.tracked_questions (client_domain_id, text, source, added_on, added_by, cluster_id, angle, origin_kind)
    values (c.id, t, 'nomada', today, p_by, cl,
            case when q->>'angle' in ('category','positioning','sector','outcome','comparison') then q->>'angle' end, 'nomada');
    qout := qout || jsonb_build_object('text', t, 'status', 'added');
  end loop;

  return jsonb_build_object('cluster_id', cl, 'keywords', kout, 'prompts', qout);
end $$;
revoke all on function public.hub_track_add(text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.hub_track_add(text, text, jsonb, jsonb, text) to service_role;
