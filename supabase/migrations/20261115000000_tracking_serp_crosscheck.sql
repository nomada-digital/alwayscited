-- The Ahrefs cross-check of a keyword read (Danny, 15 Nov 2026; src/lib/tracking/crosscheck.ts). A read that comes
-- back absent, or 10 or more places worse than the last, is read again on Ahrefs. When the better-supported reading
-- is Ahrefs', it replaces position and url; DataForSEO's own reading is kept here, with Ahrefs' and whether the two
-- disagree (the dashboard's "readings vary" note). Additive; null on every row read before it.
alter table public.tracking_serp
  add column if not exists read_position integer,
  add column if not exists check_position integer,
  add column if not exists check_source text,
  add column if not exists check_on date,
  add column if not exists check_varies boolean;
