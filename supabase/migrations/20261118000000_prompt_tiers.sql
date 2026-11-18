-- Prompt tiers and "ready to broaden" (Danny, 18 Nov 2026: "yep love it"; nomada-daily docs/handbook/prompt-expansion-
-- playbook.md). Prompts start narrow and widen once the narrow ones are won:
--   1 exact service · 2 category · 3 category + market · 4 adjacent
-- Every prompt already tracked is tier 1 (the column default). Staff set a prompt's tier from the agency view
-- (lib/agency/edit.ts setPromptTier, logged in agency_edits).
--
-- prompt_broaden(p_slug) is the one place the rule is worked out. The hub's alwayscited customer view (/ac/<slug>),
-- /admin/tracking and Kev's My week (alwayscited-admin month_work) all read it, so they cannot disagree.
--
-- A tier is won when, on each of its last 2 readings (the last 2 days its live prompts were answered), across that
-- tier's live prompts:
--   * the brand is named in at least 50% of the answers, and
--   * at least 2 engines name it in at least 50% of their own answers.
-- A customer is ready to broaden when the highest tier it has live prompts in is won. Free slots are the 50-prompt
-- pool (cluster_limit x 5, limits.ts) less the live prompts that count against it (placement prompts sit outside).
-- lib/tracking/prompt-tiers.ts holds the same three numbers and its test reads them back out of this file.
--
-- Additive only: a column with a default, a check every row already meets, and a new function.

alter table public.tracked_questions add column if not exists prompt_tier smallint not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tracked_questions_prompt_tier_check') then
    alter table public.tracked_questions add constraint tracked_questions_prompt_tier_check check (prompt_tier between 1 and 4);
  end if;
end $$;

create or replace function public.prompt_broaden(p_slug text)
returns jsonb language sql stable set search_path = public as $$
  with c as (
    select cd.id, cd.slug, cd.domain, cd.brand_name, cd.tier, cd.cluster_limit
      from public.client_domains cd
     where cd.archived_at is null and cd.status <> 'ended' and (p_slug is null or cd.slug = p_slug)
  ),
  q as (
    select tq.id, tq.client_domain_id cid, tq.text, tq.prompt_tier t, tq.allowance
      from public.tracked_questions tq join c on c.id = tq.client_domain_id
     where tq.stopped_on is null or tq.stopped_on > current_date
  ),
  a as (
    select ta.client_domain_id cid, q.t, ta.question_id qid, ta.run_date, ta.engine, ta.named
      from public.tracking_answers ta join q on q.id = ta.question_id
     where ta.answered and ta.run_date > current_date - 60
  ),
  d as (   -- each tier's last 2 readings
    select cid, t, run_date from (
      select cid, t, run_date, row_number() over (partition by cid, t order by run_date desc) rn
        from (select distinct cid, t, run_date from a) x) y
     where rn <= 2
  ),
  e as (
    select a.cid, a.t, a.run_date, a.engine, count(*) n, count(*) filter (where a.named) named
      from a join d using (cid, t, run_date) group by 1, 2, 3, 4
  ),
  r as (
    select cid, t, run_date, sum(n) n, sum(named) named,
           count(*) filter (where named * 2 >= n) engines_won,
           jsonb_agg(jsonb_build_object('engine', engine, 'answers', n, 'named', named,
                                        'share', round(named::numeric / n, 3)) order by engine) engines
      from e group by 1, 2, 3
  ),
  rt as (
    select cid, t,
           count(*) readings,
           bool_and(named * 2 >= n and engines_won >= 2) all_won,
           jsonb_agg(jsonb_build_object('run_date', run_date, 'answers', n, 'named', named,
                                        'share', round(named::numeric / n, 3), 'engines_won', engines_won,
                                        'engines', engines) order by run_date desc) readings_json
      from r group by 1, 2
  ),
  pq as (   -- each prompt's share over its tier's last 2 readings
    select q.cid, q.t, q.id, q.text, count(a.qid) n, count(a.qid) filter (where a.named) named
      from q left join d on d.cid = q.cid and d.t = q.t
             left join a on a.qid = q.id and a.run_date = d.run_date
     group by 1, 2, 3, 4
  ),
  tiers as (
    select q.cid, q.t,
           count(distinct q.id) prompts,
           coalesce(rt.readings, 0) readings,
           coalesce(rt.readings = 2 and rt.all_won, false) won,
           coalesce(rt.readings_json, '[]'::jsonb) readings_json,
           (select jsonb_agg(jsonb_build_object('id', pq.id, 'text', pq.text, 'answers', pq.n, 'named', pq.named,
                                                'share', case when pq.n > 0 then round(pq.named::numeric / pq.n, 3) end)
                             order by pq.named::numeric / nullif(pq.n, 0) desc nulls last, pq.text)
              from pq where pq.cid = q.cid and pq.t = q.t) prompts_json
      from q left join rt on rt.cid = q.cid and rt.t = q.t
     group by q.cid, q.t, rt.readings, rt.all_won, rt.readings_json
  )
  select coalesce(jsonb_agg(x order by x->>'slug'), '[]'::jsonb) from (
    select jsonb_build_object(
      'slug', c.slug, 'domain', c.domain, 'brand', coalesce(c.brand_name, c.domain), 'plan', c.tier,
      'top_tier', top.t,
      'ready', coalesce(top.won, false),
      'next_tier', case when top.won then least(top.t + 1, 4) end,
      'pool', jsonb_build_object('size', c.cluster_limit * 5, 'live', pool.live, 'free', greatest(c.cluster_limit * 5 - pool.live, 0)),
      'rule', jsonb_build_object('share', 0.5, 'engines', 2, 'readings', 2),
      'tiers', coalesce((select jsonb_agg(jsonb_build_object('tier', ti.t, 'prompts', ti.prompts, 'readings', ti.readings, 'won', ti.won,
                                                              'by_reading', ti.readings_json, 'by_prompt', ti.prompts_json) order by ti.t)
                           from tiers ti where ti.cid = c.id), '[]'::jsonb)
    ) x
      from c
      left join lateral (select ti.t, ti.won from tiers ti where ti.cid = c.id order by ti.t desc limit 1) top on true
      left join lateral (select count(*) live from q where q.cid = c.id and q.allowance is null) pool on true
  ) s;
$$;
revoke all on function public.prompt_broaden(text) from public, anon, authenticated;
grant execute on function public.prompt_broaden(text) to service_role;
