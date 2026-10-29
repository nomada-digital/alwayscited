-- A brand that is also an ordinary word counts only as written (Danny, 29 Oct 2026). Additive: one column, false for
-- every existing row, so nothing changes until staff set it from the agency view (lib/agency/edit.ts setBrand).
-- With it on, the daily check names the client only where an answer writes the brand exactly - "COMMON", not
-- "a common mistake" (brand-name.ts namesExactly). Aliases are matched as before.
alter table public.client_domains add column if not exists brand_case_sensitive boolean not null default false;
