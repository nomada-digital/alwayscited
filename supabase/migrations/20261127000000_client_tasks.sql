-- "Your tasks" (27 Nov 2026, Danny): actions for the customer, in their dashboard instead of in an email.
-- Staff add them from a template library or write a custom one (hub /ac/<slug> -> /api/hub/agency tasks_*).
-- status: todo -> done (the customer ticks it) -> checked (we confirmed it: an integration connected, a live page check
-- matched, or staff confirmed a manual one). Service role only: RLS on, no policies, like the other client tables.
create table if not exists public.client_tasks (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  template         text,                                   -- the library template it came from, null for a custom task
  kind             text not null default 'manual' check (kind in ('manual','connect_gsc','connect_ga4','page_check')),
  title            text not null check (char_length(title) between 3 and 200),
  why              text not null default '' check (char_length(why) <= 400),
  steps            jsonb not null default '[]'::jsonb,     -- [{text, href?, img?}]
  check_spec       jsonb,                                  -- page_check: {url, target: 'h1'|'title', before, after}
  status           text not null default 'todo' check (status in ('todo','done','checked')),
  done_at          timestamptz,
  done_by          text,
  checked_at       timestamptz,
  check_note       text,
  last_check_at    timestamptz,
  sort             integer not null default 0,
  created_by       text,
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,
  notified_at      timestamptz                             -- set when the batch email that announced it was made
);
create index if not exists client_tasks_client on public.client_tasks (client_domain_id) where archived_at is null;
alter table public.client_tasks enable row level security;

-- The batched "We've added N tasks" email: one per client per day at most. 'draft' waits for the owner in the hub
-- (Ready to send); 'auto' was sent straight away.
create table if not exists public.client_task_emails (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  status           text not null default 'draft' check (status in ('draft','sent','dismissed','failed')),
  subject          text not null,
  html             text not null,
  body_text        text not null,
  to_emails        text[] not null default '{}',
  from_name        text not null default 'Kev @ alwayscited',
  task_ids         uuid[] not null default '{}',
  hub_draft_id     text,                                    -- the hub ready_emails row it became
  error            text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index if not exists client_task_emails_client on public.client_task_emails (client_domain_id, created_at desc);
alter table public.client_task_emails enable row level security;

-- Per client: how the notification goes out, and who signs it. Default is a draft for the owner to approve.
alter table public.client_domains add column if not exists task_email_mode text not null default 'draft' check (task_email_mode in ('draft','auto'));
alter table public.client_domains add column if not exists account_lead text;
update public.client_domains set account_lead = 'Kev' where account_lead is null and slug in
  ('common-agency','mortalentboutique-com','laverleisure-co-uk','propelo-co-uk','serendipityyork-co-uk','alistairmacphotography-com','volunteero-org');
