-- DIY P3 (13 Oct 2026, spec 10 section 5.8): the Plan's one table. The client
-- sees it as "Actions"; the table, the route and the code keep "Plan".
-- Additive only, under the 19 Sep 2026 authorisation: a new table, its
-- indexes, nothing existing changed, and harmless landing before or after the
-- deploy (the page reads it as a section and says it could not, rather than
-- reading as empty, while the table is absent).
--
-- Every advice engine writes candidate actions here through one contract
-- (src/lib/diy/plan/types.ts Candidate), deduplicated per client on
-- dedupe_key. A member's own task is kind own_task, severity own.
--
-- Beyond the spec's columns, three are the nightly job's own bookkeeping for
-- "a suggestion no longer gathered for 2 consecutive runs is dropped"
-- (section 6.1): seen_on, the last day it was gathered; missed, the runs since
-- that did not gather it; missed_on, the day of the last such run, so a job
-- run twice on one day (the worker's 15-minute stale reclaim) counts once.
--
-- Two more, added after review (13 Oct 2026, before anything was applied):
-- volume and evidence_on, the candidate's tie-breaks (section 6.1: volume
-- high first, then effort, then the newest evidence), so the Suggested column
-- takes the weekly pick's order. Written as add column if not exists below
-- the create, so the file is right whether or not an earlier draft ran.
--
-- The two foreign keys are the spec's DDL as written, with no on delete
-- action (13 Oct 2026, DIY P5: P1's diy_core no longer matches this - its
-- review gave diy_jobs on delete cascade and diy_reads on delete set null -
-- so the two files now differ, and the choice below is still open): a hand
-- delete of a client_domains or
-- tracked_clusters row that has items fails loudly instead of cascading the
-- client's action history away or orphaning it silently. The tracking tables
-- cascade (20260929000000); whether plan_items should follow them is Danny's
-- call before this is applied, and changing it after is a constraint
-- rewrite, not an additive change. No code deletes either row today.
--
-- Service-role reads only, authorisation in the app, as every tracking table:
-- row level security on, no policies.
create table if not exists plan_items (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id),
  cluster_id uuid references tracked_clusters(id),
  kind text not null check (kind in ('unblock_crawler','fix_page_status','add_schema','fix_schema','rework_page',
    'pick_target_page','resolve_split','get_onto_page','claim_profile','answer_thread','publish_own','refresh_own',
    'send_correction','earn_link','ask_for_link','reclaim_link','track_keyword','recover_keyword','recover_prompt','own_task')),
  severity text not null check (severity in ('blocking','slipping','closest','gap','tidy','own')),
  status text not null check (status in ('suggested','todo','doing','done','dropped')),
  title text not null check (char_length(title) between 1 and 200),
  why jsonb not null default '[]'::jsonb,
  grade text check (grade in ('documented','tested','your_data','practice')),
  source_id text,
  effort text check (effort in ('minutes','hour','days')),
  href text check (href is null or char_length(href) <= 500),
  ref_table text, ref_id text,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  week_of date,
  new_since_monday boolean not null default false,
  owner_email text,
  note text check (note is null or char_length(note) <= 200),
  hidden_until date,
  created_by text not null,
  created_at timestamptz not null default now(),
  status_at timestamptz not null default now(), status_by text,
  started_on date, done_on date,
  verified jsonb, readout_base jsonb,
  seen_on date,
  missed smallint not null default 0,
  missed_on date,
  unique (client_domain_id, dedupe_key)
);
alter table plan_items add column if not exists volume integer check (volume is null or volume >= 0);
alter table plan_items add column if not exists evidence_on date;
create index if not exists plan_items_client_status on plan_items (client_domain_id, status);
-- The verifying jobs (P7 watch, P8 key_pages_weekly) find an item by what it refers to (write.ts itemsByRef).
create index if not exists plan_items_client_ref on plan_items (client_domain_id, ref_table, ref_id) where ref_table is not null;
alter table plan_items enable row level security;
