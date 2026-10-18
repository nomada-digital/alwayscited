-- Login-form abuse (18 Oct 2026). Additive only: one column with a default every existing row satisfies.
-- A row written for an address that is not a live member is marked, so /api/app/login can cap how many such
-- rows it stores an hour across everyone (session.ts LOGIN_STRANGER_ROWS_PER_HOUR) without a join.
-- Rows from before this are false; they were all born used, so none of them can sign anybody in either way.
alter table public.dashboard_login_tokens add column if not exists stranger boolean not null default false;
create index if not exists dashboard_login_tokens_stranger_created_idx on public.dashboard_login_tokens (created_at) where stranger;
