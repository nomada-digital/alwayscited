-- Where the client features in an answer, not only whether (Danny, 18 Nov 2026: "their ai visibility might be 100% but
-- the prompts may all be lists where they rank 10/10 ... it should make it clear whether the client is being
-- recognised as the best or not").
--
-- 1. A prompt's type: list ("best X", "top X", "which X would you recommend"), comparison ("X vs Y", "is X better
--    than", "alternatives to") or other. `prompt_type_auto` is derived from the wording (prompt_type_of below, the same
--    rule as nomada-daily generators/ai_positions.py TYPE_RULE); `prompt_type` is staff's override, null when the
--    wording's type stands. lib/tracking/prompt-type.ts reads coalesce(prompt_type, prompt_type_auto).
-- 2. An answer's position (tracking_answers.list_pos of list_of), set by a trigger whenever an answer's text, brands
--    or named are written, so a new answer and the backfill below are worked out by the same code. Only for an answer
--    that names the client. Where the answer has a numbered list, the client's position is the number of the first
--    item naming it, of the list's length; otherwise its order of first mention among the brands the answer names
--    (brands holds the rivals, so of = rivals named + 1).
-- 3. A comparison answer's verdict (verdict client / neutral / rival, verdict_rival the brand recommended over the
--    client), read once per answer by Haiku (lib/tracking/verdicts.ts) and kept.
-- 4. prompt_positions(p_slug, p_days): per live prompt over its last p_days readings, for the agency views - named,
--    first, top 3, the average position, the #1 / 2-3 / 4-10 / 11+ split, the verdict counts, and "never top 3"
--    (named, never in the top 3: a listicle refresh or re-brief target).
--
-- Additive only: columns (one stored generated), a check every row meets, functions, a trigger, and a backfill of the
-- columns added here.

create or replace function public.prompt_type_of(p_text text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_text ~* '\m(vs\.?|versus|better than|compared? (to|with)|comparison|alternatives?|instead of|which is better|switch(ing)? from)\M'
      then 'comparison'
    when p_text ~* '\m(best|top|leading|recommend(ed|ations?)?|shortlist|list (of|the))\M' or p_text ~* '^\s*(which|who|where can)\M'
      then 'list'
    else 'other'
  end
$$;
revoke all on function public.prompt_type_of(text) from public, anon, authenticated;
grant execute on function public.prompt_type_of(text) to service_role;

alter table public.tracked_questions add column if not exists prompt_type text;
alter table public.tracked_questions add column if not exists prompt_type_auto text generated always as (public.prompt_type_of(text)) stored;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tracked_questions_prompt_type_check') then
    alter table public.tracked_questions add constraint tracked_questions_prompt_type_check check (prompt_type is null or prompt_type in ('list', 'comparison', 'other'));
  end if;
end $$;

alter table public.tracking_answers add column if not exists list_pos smallint;
alter table public.tracking_answers add column if not exists list_of smallint;
alter table public.tracking_answers add column if not exists verdict text;
alter table public.tracking_answers add column if not exists verdict_rival text;
alter table public.tracking_answers add column if not exists verdict_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tracking_answers_verdict_check') then
    alter table public.tracking_answers add constraint tracking_answers_verdict_check check (verdict is null or verdict in ('client', 'neutral', 'rival'));
  end if;
end $$;

-- The client's position in one answer: (pos, of), or nulls when it is not found.
create or replace function public.answer_position(p_text text, p_brands jsonb, p_names text[], p_exact boolean)
returns table (pos int, total int) language plpgsql immutable set search_path = public as $$
declare
  pat text;
  rx text;
  item record;
  n int := 0;
  hit int;
  first_at int;
  rival_at int;
  b text;
  before int := 0;
  rivals int := 0;
begin
  if p_text is null or coalesce(array_length(p_names, 1), 0) = 0 then return query select null::int, null::int; return; end if;
  -- the client's names as one alternation, regex characters escaped, matched on word boundaries
  select string_agg(regexp_replace(x, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|') into pat
    from unnest(p_names) x where length(btrim(x)) >= 2;
  if pat is null then return query select null::int, null::int; return; end if;
  rx := '\m(' || pat || ')\M';
  -- a numbered list: the first item naming the client, of the list's length
  for item in select m[2] t from regexp_matches(p_text, '^\s*\**\s*(\d{1,2})[.)]\s*(.+)$', 'gn') m loop
    n := n + 1;
    if hit is null and (case when p_exact then item.t ~ rx else item.t ~* rx end) then hit := n; end if;
  end loop;
  if hit is not null and n >= 2 then return query select hit, n; return; end if;
  -- otherwise its order of first mention among the brands the answer names
  first_at := case when p_exact then regexp_instr(p_text, rx) else regexp_instr(p_text, rx, 1, 1, 0, 'i') end;
  if coalesce(first_at, 0) = 0 then return query select null::int, null::int; return; end if;
  for b in select distinct jsonb_array_elements_text(coalesce(p_brands, '[]'::jsonb)) loop
    if length(btrim(b)) < 2 then continue; end if;
    rival_at := regexp_instr(p_text, '\m' || regexp_replace(b, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M', 1, 1, 0, 'i');
    if rival_at > 0 then
      rivals := rivals + 1;
      if rival_at < first_at then before := before + 1; end if;
    end if;
  end loop;
  return query select before + 1, rivals + 1;
end $$;
revoke all on function public.answer_position(text, jsonb, text[], boolean) from public, anon, authenticated;
grant execute on function public.answer_position(text, jsonb, text[], boolean) to service_role;

-- The client's names for an answer: its brand, its aliases and its domain (as namesSubject reads them).
create or replace function public.client_names(p_client uuid)
returns text[] language sql stable set search_path = public as $$
  select array_remove(array[c.brand_name, regexp_replace(c.domain, '^www\.', '')] || coalesce(c.brand_aliases, '{}'), null)
    from public.client_domains c where c.id = p_client
$$;
revoke all on function public.client_names(uuid) from public, anon, authenticated;
grant execute on function public.client_names(uuid) to service_role;

create or replace function public.tracking_answers_position()
returns trigger language plpgsql set search_path = public as $$
declare r record; exact boolean;
begin
  if new.answered and new.named then
    select coalesce(c.brand_case_sensitive, false) into exact from public.client_domains c where c.id = new.client_domain_id;
    select * into r from public.answer_position(new.response_text, new.brands, public.client_names(new.client_domain_id), coalesce(exact, false));
    new.list_pos := r.pos; new.list_of := r.total;
  else
    new.list_pos := null; new.list_of := null;
  end if;
  return new;
end $$;
revoke all on function public.tracking_answers_position() from public, anon, authenticated;
grant execute on function public.tracking_answers_position() to service_role;

create or replace trigger tracking_answers_position before insert or update of response_text, brands, named, answered on public.tracking_answers
  for each row execute function public.tracking_answers_position();

-- Per live prompt, over its last p_days readings. Types and figures for the agency views (lib/agency/edit.ts readAgency,
-- /admin/tracking); the customer's dashboard works out the same from its own rows (lib/dash/model.ts).
create or replace function public.prompt_positions(p_slug text, p_days int)
returns jsonb language sql stable set search_path = public as $$
  with c as (select id from public.client_domains where slug = p_slug),
  q as (
    select tq.id, tq.text, coalesce(tq.prompt_type, tq.prompt_type_auto) ptype, tq.prompt_type is not null overridden
      from public.tracked_questions tq join c on c.id = tq.client_domain_id
     where (tq.stopped_on is null or tq.stopped_on > current_date) and tq.allowance is null
  ),
  a as (
    select ta.question_id qid, ta.engine, ta.named, ta.list_pos, ta.list_of, ta.verdict, ta.verdict_rival
      from public.tracking_answers ta join q on q.id = ta.question_id
     where ta.answered and ta.run_date > current_date - p_days
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'text', q.text, 'type', q.ptype, 'type_set', q.overridden,
      'answers', s.answers, 'named', s.named, 'placed', s.placed,
      'first', s.first, 'top3', s.top3, 'avg_pos', s.avg_pos,
      'dist', jsonb_build_object('1', s.first, '2-3', s.top3 - s.first, '4-10', s.d410, '11+', s.d11),
      'never_top3', s.named > 0 and s.top3 = 0,
      'verdicts', jsonb_build_object('client', s.v_client, 'neutral', s.v_neutral, 'rival', s.v_rival, 'unread', s.v_unread),
      'rivals', s.rivals
    ) order by q.text), '[]'::jsonb)
    from q
    cross join lateral (
      select count(a.qid) answers,
             count(*) filter (where a.named) named,
             count(*) filter (where a.list_pos is not null) placed,
             count(*) filter (where a.list_pos = 1) first,
             count(*) filter (where a.list_pos <= 3) top3,
             count(*) filter (where a.list_pos between 4 and 10) d410,
             count(*) filter (where a.list_pos > 10) d11,
             round(avg(a.list_pos), 1) avg_pos,
             count(*) filter (where a.verdict = 'client') v_client,
             count(*) filter (where a.verdict = 'neutral') v_neutral,
             count(*) filter (where a.verdict = 'rival') v_rival,
             count(*) filter (where a.verdict is null) v_unread,
             (select jsonb_agg(x order by (x->>'n')::int desc) from (
                select jsonb_build_object('name', a2.verdict_rival, 'n', count(*)) x from a a2
                 where a2.qid = q.id and a2.verdict = 'rival' and a2.verdict_rival is not null group by a2.verdict_rival limit 3) r) rivals
        from a where a.qid = q.id
    ) s
$$;
revoke all on function public.prompt_positions(text, int) from public, anon, authenticated;
grant execute on function public.prompt_positions(text, int) to service_role;

-- Backfill: every stored answer that names the client, worked out by the trigger's own function.
update public.tracking_answers ta
   set list_pos = p.pos, list_of = p.total
  from (
    select x.id, (public.answer_position(x.response_text, x.brands, public.client_names(c.id), coalesce(c.brand_case_sensitive, false))).*
      from public.tracking_answers x join public.client_domains c on c.id = x.client_domain_id
     where x.answered and x.named and x.list_pos is null
  ) p
 where p.id = ta.id;
