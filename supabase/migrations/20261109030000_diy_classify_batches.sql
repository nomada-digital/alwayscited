-- The DIY classify job's Message Batches (9 Nov 2026, the prompt-caching audit). Additive only: one table.
--
-- diy_classify_batches: the night's classify chunks sent as one Message Batch per client, collected by
--   /api/cron/brand-batches (lib/diy/opportunities/classify-batches.ts). chunks maps each custom_id to its diy_reads
--   reservation and the items it carries, so the collector can settle, store the types, or call directly.
-- Service role only (RLS on, no policies), like every table the app writes through supabaseAdmin.

create table if not exists public.diy_classify_batches (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  domain           text not null check (char_length(domain) <= 253),
  batch_id         text not null check (char_length(batch_id) <= 100),
  chunks           jsonb not null,
  request_count    integer not null check (request_count > 0),
  status           text not null default 'pending' check (status in ('pending', 'collected', 'fallback')),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  fallback_calls   integer not null default 0 check (fallback_calls >= 0),
  typed            integer not null default 0 check (typed >= 0),
  failed           integer not null default 0 check (failed >= 0)
);
create index if not exists diy_classify_batches_pending on public.diy_classify_batches (created_at) where status = 'pending';
alter table public.diy_classify_batches enable row level security;
