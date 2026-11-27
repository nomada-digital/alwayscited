-- Your tasks, round 2 (27 Nov 2026, Danny): two ways to do each task (steps, or a prompt for their AI), "Let us do it for you"
-- direct access, the site platform we detected, and fortnightly connection reminders merged into the tasks email.
alter table public.client_tasks add column if not exists onsite boolean not null default false;     -- an on-site change: "We'll handle this" once we have access
alter table public.client_tasks add column if not exists ai_prompt text check (ai_prompt is null or char_length(ai_prompt) <= 8000);
alter table public.client_tasks drop constraint if exists client_tasks_kind_check;
alter table public.client_tasks add constraint client_tasks_kind_check check (kind in ('manual','connect_gsc','connect_ga4','connect_bing','page_check','access'));

alter table public.client_domains add column if not exists site_platform text check (site_platform is null or site_platform in ('shopify','wordpress','webflow','squarespace','wix','framer','custom'));
alter table public.client_domains add column if not exists site_platform_at timestamptz;

-- Direct access we have been given (or been told about), per customer and kind. Staff confirm 'granted'; that is what flips
-- on-site tasks to "We'll handle this". Linking to the hub's client_cms_connections (Noma CMS edits) is the hub's step: this
-- table holds no credential, only the fact and who recorded it.
create table if not exists public.client_access (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  kind             text not null check (kind in ('site','gsc','ga4','bing')),
  platform         text,
  status           text not null default 'requested' check (status in ('requested','granted','revoked')),
  note             text check (note is null or char_length(note) <= 500),
  requested_at     timestamptz not null default now(),
  granted_at       timestamptz,
  recorded_by      text,
  unique (client_domain_id, kind)
);
alter table public.client_access enable row level security;

alter table public.client_task_emails add column if not exists includes_reminder boolean not null default false;
alter table public.client_task_emails add column if not exists reminder_for text[] not null default '{}';
