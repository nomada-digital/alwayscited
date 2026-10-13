-- DIY P6 (13 Oct 2026; docs/diy-platform-2026-10-12/10-spec.md sections 5.8,
-- 6.6 and 7.7): the Google footprint and the gaining-ground dismissals.
-- Additive only, under the 19 Sep 2026 authorisation: two new tables, nothing
-- existing changed, no row written. Harmless landing before or after the
-- deploy: the Google page reads both as sections and says it could not read
-- them, rather than reading as empty, while they are absent; the footprint job
-- is not registered until the wave 2 shell wires it (src/lib/diy/wiring.ts),
-- and its paid read stays dark behind diy_enabled and the caps either way.
--
-- Departures from the spec's SQL, made before this file was ever applied
-- (13 Oct 2026, decided for every DIY table): each foreign key says what a
-- delete does. client_domain_id cascades, as diy_jobs, plan_items and every
-- tracking table do, so a hand delete of a client takes its footprint and
-- dismissals with it rather than failing; read_id is set null, so a footprint
-- outlives the ledger row it was paid from (diy_reads rows are never deleted
-- by code, but a NO ACTION key would make one undeletable). Neither table
-- needs an index of its own: every read is one client's, which the unique key
-- and the primary key each lead with.
--
-- keyword_footprints: one row per weekly pull of DataForSEO Labs'
-- ranked_keywords for the client's domain (spec 5.2), only when Labs' Google
-- date has moved since the last pull and at most once a week, plus the
-- onboarding pull. `rows` is compacted to named fields: keyword, organic
-- position (rank_group: what our own daily read stores and every page shows),
-- url path, volume, intent, estimated traffic, the position on the whole
-- results page (rank_absolute), DataForSEO's previous rank_absolute, its
-- is_new flag and that previous reading's day (previous_updated_time). The
-- two positions were split, and the day added, on 13 Oct 2026 (review of the
-- P6 handoff), before this file was applied. No keyword_difficulty: the
-- parser never reads it (spec 2.3). About 105 KB a pull at 1000 rows (spec
-- 5.9 said 80 KB before the two fields). Old pulls are never deleted; readers
-- take the latest two.
create table if not exists keyword_footprints (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  pulled_on date not null,
  labs_date date,
  total_count integer,
  etv numeric,
  rows jsonb not null,             -- [{k,p,u,v,i,e,a,pr,n,pd}] keyword, organic position, url path, volume, intent, etv, page position, dfs previous rank_absolute, dfs is_new, its day (no kd)
  read_id uuid references diy_reads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (client_domain_id, pulled_on)
);
alter table keyword_footprints enable row level security;

-- diy_dismissals: a member's "Dismiss" on a gaining-ground keyword, so the
-- momentum rule leaves it out until `until`. Restore sets `until` to the day
-- before, so the row and who dismissed it stay; nothing is deleted. The key is
-- DataForSEO's keyword as the latest pull holds it (the route refuses any
-- other), at most 120 characters, as the pull's own field is cut.
create table if not exists diy_dismissals (
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  kind text not null check (kind in ('gaining_keyword')),
  key text not null check (char_length(key) between 1 and 120),
  until date not null,
  by_email text not null,
  created_at timestamptz not null default now(),
  primary key (client_domain_id, kind, key)
);
alter table diy_dismissals enable row level security;
