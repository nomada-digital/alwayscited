-- Prompt caching and Message Batches (8 Nov 2026, the hub's prompt-caching audit). Additive only: two tables.
--
-- model_usage: every model call's tokens, cache writes and reads included, by call site (lib/scan/anthropic.ts
--   logUsage). Until now only call counts were kept, so a cache hit rate could not be measured.
-- tracking_brand_batches: the daily tracking's brand extraction sent as a Message Batch, one row a run, collected by
--   /api/cron/brand-batches (lib/tracking/brand-batches.ts). requests maps each custom_id to its engine and answers.
-- Service role only (RLS on, no policies), like every table the app writes through supabaseAdmin.

create table if not exists public.model_usage (
  id                 bigserial primary key,
  created_at         timestamptz not null default now(),
  label              text not null check (char_length(label) <= 60),
  model              text check (model is null or char_length(model) <= 60),
  batch              boolean not null default false,
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens >= 0)
);
create index if not exists model_usage_created on public.model_usage (created_at);
create index if not exists model_usage_label on public.model_usage (label, created_at);
alter table public.model_usage enable row level security;

create table if not exists public.tracking_brand_batches (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null unique references public.tracking_runs(id) on delete cascade,
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  batch_id         text not null check (char_length(batch_id) <= 100),
  requests         jsonb not null,
  request_count    integer not null check (request_count > 0),
  status           text not null default 'pending' check (status in ('pending', 'collected', 'fallback')),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  fallback_calls   integer not null default 0 check (fallback_calls >= 0),
  unread           integer not null default 0 check (unread >= 0)
);
create index if not exists tracking_brand_batches_pending on public.tracking_brand_batches (created_at) where status = 'pending';
alter table public.tracking_brand_batches enable row level security;
