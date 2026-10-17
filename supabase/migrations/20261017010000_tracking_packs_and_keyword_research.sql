-- dashboards.alwayscited.com (17 Oct 2026, second pass). Additive only: two new tables, RLS on, no policies -
-- every read and write is the service role, as for every other dashboard table.

-- Extra tracking packs bought through Stripe Checkout. Each purchase is its own small subscription on the client's
-- Stripe customer, marked metadata[kind]=pack, so it can never be mistaken for a signup. cluster_limit is
-- 10 + 5 x (packs on the main subscription + the quantity of every live row here), set by the webhook
-- (lib/checkout/packs.ts). A cancelled pack keeps its row with status canceled; nothing is deleted.
create table if not exists public.tracking_packs (
  stripe_subscription_id text primary key check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  client_domain_id       uuid not null references public.client_domains(id) on delete cascade,
  quantity               int not null default 1 check (quantity between 0 and 100),
  status                 text not null,
  stripe_customer_id     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists tracking_packs_client_idx on public.tracking_packs (client_domain_id);
alter table public.tracking_packs enable row level security;

-- Keyword research results (Search positions' "Find keywords"), shared across clients: one row per market, kind and
-- seed, reused for 30 days, so the same search twice - by one client or two - is paid for once. The per-client
-- daily count of paid searches is the DIY ledger's (diy_reads), not this table's.
create table if not exists public.keyword_research (
  id          bigint generated always as identity primary key,
  market      text not null check (market in ('US', 'UK')),
  kind        text not null check (kind in ('suggestions', 'related', 'difficulty')),
  seed        text not null check (char_length(seed) between 1 and 400),
  rows        jsonb not null default '[]',
  read_on     date not null,
  created_at  timestamptz not null default now(),
  unique (market, kind, seed, read_on)
);
create index if not exists keyword_research_lookup_idx on public.keyword_research (market, kind, seed, read_on desc);
alter table public.keyword_research enable row level security;
