-- Contract offers (Danny, 31 Oct 2026): a private checkout link for a client on a signed agreement, so they sign up
-- through alwayscited.com at the agreed price and for the agreed number of monthly payments. The terms live here, not
-- in the code, because this repository is public and an agreement's price is confidential.
--
-- /offer/<token> reads a row by the hash of its token (the token itself is never stored, as dashboard_login_tokens);
-- /api/offer/<token> opens Stripe Checkout at monthly_amount; the webhook (lib/checkout/contract-offer.ts) sets the
-- subscription to end after `charges` payments and marks the row used. A used or expired row opens nothing.
--
-- Additive only: a new table, RLS on with no policies, so only the service role reads or writes it (as orders).

create table if not exists public.contract_offers (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Shown on the offer page: who it was prepared for, and the agreement it is billed under.
  client_name text not null check (length(client_name) between 1 and 120),
  agreement_date date not null,
  tier text not null default 'cited' check (tier in ('tracked', 'mentioned', 'cited')),
  market text not null check (market in ('uk', 'us')),
  website text not null check (length(website) between 3 and 253),
  keyword text check (keyword is null or length(keyword) between 2 and 120),
  -- Prefilled on the offer page and on Stripe's form; the buyer may change it.
  email text check (email is null or length(email) <= 254),
  -- Before VAT, in the smallest unit (pence or cents), as orders.monthly_amount.
  monthly_amount integer not null check (monthly_amount > 0),
  -- How many monthly payments, after which the subscription ends (Stripe cancel_at).
  charges integer not null check (charges between 1 and 36),
  -- The first payment's day; null charges the first payment at checkout.
  first_charge_on date,
  expires_at timestamptz not null,
  used_at timestamptz,
  stripe_session_id text,
  stripe_subscription_id text,
  cancel_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.contract_offers enable row level security;
