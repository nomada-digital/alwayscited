-- Deliverables (25 Nov 2026): on-site changes alwayscited recommends and cannot make itself, because it has no access
-- to the customer's site (first use: MOR Talent Boutique). Each one is a short findings summary, a Markdown file the
-- customer pastes into their own tools, an optional evidence link, and a status the customer or Nomada moves:
-- proposed -> delivered -> completed. Additive only, under the 19 Sep 2026 authorisation: new tables, new functions,
-- nothing existing changed, and harmless landing before or after the deploy (the dashboard says the section could not
-- be read while the tables are absent, rather than reading as empty).
--
-- Why not plan_items. plan_items is the Actions engine's table: its kind and status are closed lists (suggested, todo,
-- doing, done, dropped), its title and note stop at 200 characters, and the nightly refresh drops a row it has not
-- gathered for two runs. A deliverable is hand-written, long, needs a status plan_items does not have, and must never
-- be dropped. Widening those checks means dropping and re-adding constraints on a live table, which is not additive.
-- So the deliverable is its own row, and plan_item_id lets it point at the plan_items row it answers when there is one.
--
-- The paper trail is enforced here, not in the app:
--   * deliverable_versions, deliverable_files and deliverable_events can be inserted into and never updated or
--     deleted (deliverable_history_guard). An edit is a new version carrying the whole content again (title,
--     findings, evidence link, files); the earlier versions stay.
--   * deliverables holds no content - only state. What the customer reads is the version current_version names.
--   * every change of status, visibility or version writes an event in the same statement (deliverables_audit), whoever
--     made it: the app, a function, or SQL typed by hand. The actor, note and link of a change are the changed_*
--     columns the writer sets in the same update; nothing writes an event but the trigger.
--   * the foreign keys are on delete restrict. A deliverable, its history, and a customer with deliverables cannot be
--     deleted; a draft that should not be seen stays hidden (visible_to_customer false).
--
-- Draft visibility (Danny): visible_to_customer defaults false, a row cannot be inserted visible, and it is turned on
-- only by an update, which is the internal "Publish to customer" action.
--
-- Status only moves forward. Completing a Nomada-actioned deliverable needs an evidence link (a sheet or a URL). A
-- client-actioned one is completed by the customer's tick, which records who ticked it and when, and a note or a link
-- to the live page if they gave one.
--
-- Service-role only, authorisation in the app, as every tracking table: row level security on, no policies.

create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete restrict,
  plan_item_id uuid references plan_items(id) on delete set null,
  delivered_by text not null check (delivered_by in ('nomada','client')),
  status text not null default 'proposed' check (status in ('proposed','delivered','completed')),
  visible_to_customer boolean not null default false,
  current_version integer not null default 1 check (current_version >= 1),
  created_by text not null check (char_length(created_by) between 1 and 254),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by text,
  status_at timestamptz not null default now(),
  status_by text,
  delivered_at timestamptz,
  completed_at timestamptz,
  completed_by text,
  completion_note text check (completion_note is null or char_length(completion_note) <= 1000),
  completion_url text check (completion_url is null or (char_length(completion_url) <= 1000 and completion_url ~* '^https?://')),
  -- The last change's stamp: who, what kind of person, and the note and link they gave. Read by the triggers only.
  changed_by text not null check (char_length(changed_by) between 1 and 254),
  changed_kind text not null check (changed_kind in ('customer','nomada','system')),
  changed_note text check (changed_note is null or char_length(changed_note) <= 1000),
  changed_url text check (changed_url is null or (char_length(changed_url) <= 1000 and changed_url ~* '^https?://')),
  constraint deliverables_completed_shape check (status <> 'completed' or (completed_at is not null and completed_by is not null)),
  constraint deliverables_nomada_evidence check (status <> 'completed' or delivered_by <> 'nomada' or completion_url is not null)
);
create index if not exists deliverables_client on deliverables (client_domain_id, visible_to_customer, created_at desc);

create table if not exists deliverable_versions (
  deliverable_id uuid not null references deliverables(id) on delete restrict,
  version integer not null check (version >= 1),
  title text not null check (char_length(title) between 1 and 200),
  findings_md text not null check (char_length(findings_md) between 1 and 20000),
  evidence_url text check (evidence_url is null or (char_length(evidence_url) <= 1000 and evidence_url ~* '^https?://')),
  reason text check (reason is null or char_length(reason) <= 1000),
  created_by text not null check (char_length(created_by) between 1 and 254),
  created_at timestamptz not null default now(),
  primary key (deliverable_id, version)
);

-- Text files only (Markdown first), kept in the row: the storage schema is not touched. The first file of a version is
-- the one the customer sees a Copy and a Download button for.
create table if not exists deliverable_files (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null,
  version integer not null,
  position smallint not null default 0 check (position >= 0),
  filename text not null check (filename ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,110}\.(md|txt|csv|json)$'),
  content_type text not null check (content_type in ('text/markdown','text/plain','text/csv','application/json')),
  body text not null check (char_length(body) between 1 and 400000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (deliverable_id, version) references deliverable_versions(deliverable_id, version) on delete restrict,
  unique (deliverable_id, version, filename)
);
create index if not exists deliverable_files_version on deliverable_files (deliverable_id, version, position);

create table if not exists deliverable_events (
  id bigint generated always as identity primary key,
  deliverable_id uuid not null references deliverables(id) on delete restrict,
  at timestamptz not null default now(),
  actor text not null,
  actor_kind text not null check (actor_kind in ('customer','nomada','system')),
  event text not null check (event in ('created','published','unpublished','edited','status')),
  from_status text,
  to_status text,
  version integer,
  note text,
  url text
);
create index if not exists deliverable_events_deliverable on deliverable_events (deliverable_id, at, id);

alter table deliverables enable row level security;
alter table deliverable_versions enable row level security;
alter table deliverable_files enable row level security;
alter table deliverable_events enable row level security;

-- History is permanent: no update and no delete, on all three tables, for anyone.
create or replace function public.deliverable_history_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'deliverable history is permanent: % on % is not allowed', tg_op, tg_table_name;
end $$;
revoke all on function public.deliverable_history_guard() from public;
grant execute on function public.deliverable_history_guard() to service_role;

drop trigger if exists deliverable_versions_guard on deliverable_versions;
create trigger deliverable_versions_guard before update or delete on deliverable_versions for each row execute function public.deliverable_history_guard();
drop trigger if exists deliverable_files_guard on deliverable_files;
create trigger deliverable_files_guard before update or delete on deliverable_files for each row execute function public.deliverable_history_guard();
drop trigger if exists deliverable_events_guard on deliverable_events;
create trigger deliverable_events_guard before update or delete on deliverable_events for each row execute function public.deliverable_history_guard();

-- The rules of a change, applied before it is written.
create or replace function public.deliverables_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  rank_old integer;
  rank_new integer;
begin
  if tg_op = 'INSERT' then
    if new.visible_to_customer then raise exception 'a deliverable starts hidden: publish it with an update'; end if;
    if new.status <> 'proposed' or new.current_version <> 1 then raise exception 'a deliverable starts proposed, at version 1'; end if;
    new.status_by := new.created_by;
    return new;
  end if;

  if new.client_domain_id is distinct from old.client_domain_id
     or new.delivered_by is distinct from old.delivered_by
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a deliverable''s customer, who delivers it, and who made it never change';
  end if;
  if new.current_version < old.current_version then raise exception 'a deliverable''s version only moves forward'; end if;
  new.updated_at := now();

  if new.visible_to_customer and not old.visible_to_customer then
    new.published_at := now();
    new.published_by := new.changed_by;
  end if;

  if new.status is distinct from old.status then
    rank_old := case old.status when 'proposed' then 1 when 'delivered' then 2 else 3 end;
    rank_new := case new.status when 'proposed' then 1 when 'delivered' then 2 else 3 end;
    if rank_new < rank_old then raise exception 'a deliverable''s status only moves forward (% to %)', old.status, new.status; end if;
    new.status_at := now();
    new.status_by := new.changed_by;
    if new.status = 'delivered' then new.delivered_at := now(); end if;
    if new.status = 'completed' then
      if new.delivered_at is null then new.delivered_at := now(); end if;
      new.completed_at := now();
      new.completed_by := new.changed_by;
      new.completion_note := new.changed_note;
      new.completion_url := new.changed_url;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.deliverables_guard() from public;
grant execute on function public.deliverables_guard() to service_role;

drop trigger if exists deliverables_guard on deliverables;
create trigger deliverables_guard before insert or update on deliverables for each row execute function public.deliverables_guard();

-- The audit trail: one event per thing that changed, written in the same statement as the change.
create or replace function public.deliverables_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into deliverable_events (deliverable_id, actor, actor_kind, event, to_status, version, note)
    values (new.id, new.changed_by, new.changed_kind, 'created', new.status, new.current_version, new.changed_note);
    return null;
  end if;
  if new.visible_to_customer is distinct from old.visible_to_customer then
    insert into deliverable_events (deliverable_id, actor, actor_kind, event, note)
    values (new.id, new.changed_by, new.changed_kind, case when new.visible_to_customer then 'published' else 'unpublished' end, new.changed_note);
  end if;
  if new.status is distinct from old.status then
    insert into deliverable_events (deliverable_id, actor, actor_kind, event, from_status, to_status, note, url)
    values (new.id, new.changed_by, new.changed_kind, 'status', old.status, new.status, new.changed_note, new.changed_url);
  end if;
  if new.current_version is distinct from old.current_version then
    insert into deliverable_events (deliverable_id, actor, actor_kind, event, version, note)
    values (new.id, new.changed_by, new.changed_kind, 'edited', new.current_version, new.changed_note);
  end if;
  return null;
end $$;
revoke all on function public.deliverables_audit() from public;
grant execute on function public.deliverables_audit() to service_role;

drop trigger if exists deliverables_audit on deliverables;
create trigger deliverables_audit after insert or update on deliverables for each row execute function public.deliverables_audit();

-- Make one: the deliverable, version 1 and its files, all or nothing. p_files is a json array of
-- {filename, content_type, body, sha256}; the first is the Markdown the customer copies.
create or replace function public.deliverable_create(
  p_client uuid, p_delivered_by text, p_by text, p_kind text, p_title text, p_findings text, p_evidence_url text, p_files jsonb, p_plan_item uuid
) returns uuid language plpgsql set search_path = public as $$
declare d uuid;
begin
  insert into deliverables (client_domain_id, plan_item_id, delivered_by, created_by, changed_by, changed_kind)
  values (p_client, p_plan_item, p_delivered_by, p_by, p_by, p_kind) returning id into d;
  insert into deliverable_versions (deliverable_id, version, title, findings_md, evidence_url, created_by)
  values (d, 1, p_title, p_findings, p_evidence_url, p_by);
  insert into deliverable_files (deliverable_id, version, position, filename, content_type, body, sha256)
  select d, 1, (t.ord - 1)::smallint, t.f->>'filename', t.f->>'content_type', t.f->>'body', t.f->>'sha256'
    from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) with ordinality as t(f, ord);
  return d;
end $$;
revoke all on function public.deliverable_create(uuid, text, text, text, text, text, text, jsonb, uuid) from public;
grant execute on function public.deliverable_create(uuid, text, text, text, text, text, text, jsonb, uuid) to service_role;

-- Edit one: never an overwrite. A new version carries the whole content again; the files are the new ones in p_files, or
-- the previous version's when p_files is null. p_expect is the version the editor was looking at; if someone else
-- edited meanwhile it is refused rather than overwritten.
create or replace function public.deliverable_edit(
  p_id uuid, p_expect integer, p_by text, p_kind text, p_title text, p_findings text, p_evidence_url text, p_files jsonb, p_reason text
) returns integer language plpgsql set search_path = public as $$
declare cur integer; nxt integer;
begin
  select current_version into cur from deliverables where id = p_id for update;
  if cur is null then raise exception 'no such deliverable'; end if;
  if cur <> p_expect then raise exception 'this deliverable changed while you were editing it (now version %)', cur; end if;
  nxt := cur + 1;
  insert into deliverable_versions (deliverable_id, version, title, findings_md, evidence_url, reason, created_by)
  values (p_id, nxt, p_title, p_findings, p_evidence_url, p_reason, p_by);
  if p_files is null then
    insert into deliverable_files (deliverable_id, version, position, filename, content_type, body, sha256)
    select deliverable_id, nxt, position, filename, content_type, body, sha256 from deliverable_files where deliverable_id = p_id and version = cur;
  else
    insert into deliverable_files (deliverable_id, version, position, filename, content_type, body, sha256)
    select p_id, nxt, (t.ord - 1)::smallint, t.f->>'filename', t.f->>'content_type', t.f->>'body', t.f->>'sha256'
      from jsonb_array_elements(p_files) with ordinality as t(f, ord);
  end if;
  update deliverables set current_version = nxt, changed_by = p_by, changed_kind = p_kind, changed_note = p_reason, changed_url = null where id = p_id;
  return nxt;
end $$;
revoke all on function public.deliverable_edit(uuid, integer, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.deliverable_edit(uuid, integer, text, text, text, text, text, jsonb, text) to service_role;
