-- One-click Search Console (Danny, 16 Nov 2026; src/lib/dash/gsc-oauth.ts, gsc-oauth-io.ts). Follows
-- 20261116000000_google_direct.sql, which must be applied first. Additive only.

-- How a direct connection reads: the customer's own Google grant (oauth) or the hub's service account
-- (service_account), and the Google account that granted it, for "Connected as <email>".
alter table public.integration_connections add column if not exists auth text check (auth is null or auth in ('service_account', 'oauth'));
alter table public.integration_connections add column if not exists google_email text check (google_email is null or char_length(google_email) <= 320);

-- The grant itself: the refresh token sealed with GSC_TOKEN_KEY (AES-256-GCM), one per client. Server only - RLS on,
-- no policies, revoked from anon and authenticated - and read by gsc-oauth-io.ts alone.
create table if not exists public.gsc_tokens (
  client_domain_id uuid primary key references public.client_domains(id) on delete cascade,
  token_enc        text not null check (char_length(token_enc) between 20 and 4000),
  google_email     text check (google_email is null or char_length(google_email) <= 320),
  scope            text check (scope is null or char_length(scope) <= 500),
  created_by       text check (created_by is null or char_length(created_by) <= 320),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.gsc_tokens enable row level security;
revoke all on table public.gsc_tokens from anon, authenticated;
