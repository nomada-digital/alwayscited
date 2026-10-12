-- DIY P2 (13 Oct 2026; docs/diy-platform-2026-10-12/10-spec.md sections 5.8, 6.7 and 7.3):
-- where each tracked prompt came from, and the placement allowance.
--
-- Additive only, under the 19 Sep 2026 authorisation: three nullable columns,
-- each check satisfied by every existing row (null), one partial index, and
-- one app_settings row inserted with on conflict do nothing. Nothing dropped,
-- renamed or retyped; tracked_questions.source keeps its check, RLS is
-- untouched.
--
-- - origin_kind: setup, client, nomada (legacy admin adds), scan (legacy),
--   placement, opportunity, momentum. Null is a legacy row; its chip is derived
--   from source (src/lib/diy/prompts/origins.ts originOf).
-- - origin_ref: the placement's or the opportunity's id. No foreign key, so a
--   prompt never blocks or follows a placement or opportunity row.
-- - allowance: 'placement' for a prompt added from a live placement. Those sit
--   outside the 5 angle slots and cluster_limit x 5, and are capped at 10 live
--   per client (limits.ts PLACEMENT_PROMPTS_PER_CLIENT).
-- - placement_prompts_enabled: seeded false. While it is false no placement
--   prompt is fetched or added (placement-prompt.ts reads it first; a missing
--   or unreadable row is off). Danny turns it on (spec 8.3 Q1), after
--   Supabase Pro and a placed run measured under 240 s.

alter table tracked_questions add column if not exists origin_kind text
  check (origin_kind is null or origin_kind in ('setup','client','nomada','scan','placement','opportunity','momentum'));
alter table tracked_questions add column if not exists origin_ref uuid;
alter table tracked_questions add column if not exists allowance text
  check (allowance is null or allowance = 'placement');

create index if not exists tracked_questions_placement_live on tracked_questions (client_domain_id)
  where stopped_on is null and allowance = 'placement';

insert into app_settings (key, value) values ('placement_prompts_enabled', 'false'::jsonb)
on conflict (key) do nothing;
