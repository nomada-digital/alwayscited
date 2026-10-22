-- Map pack geo-grids (Danny, 22 Oct 2026: "we'll also need to add this to his dashboard"). Additive only: two new
-- tables, RLS on, no policies - every read and write is the service role, as for every other dashboard table.
--
-- A local grid is one keyword read from a square of points around a centre on Google Maps (DataForSEO
-- /v3/serp/google/maps), the way BrightLocal or Local Falcon do it: map pack results move street by street, so one
-- read from one city name says little. The client's listing is matched by its Google CID, never by name.
--
-- 1. local_grids: what to read for a client - keyword, centre, size, spacing, zoom, depth and how often.
-- 2. local_grid_points: one row per point per read day - where the listing ranked (null: not inside depth) and the
--    top three there, so "who owns the pack" is kept day by day rather than thrown away.

create table if not exists public.local_grids (
  id                uuid primary key default gen_random_uuid(),
  client_domain_id  uuid not null references public.client_domains(id) on delete cascade,
  label             text not null check (char_length(label) between 1 and 80),
  keyword           text not null check (char_length(keyword) between 1 and 200),
  gbp_cid           text not null check (gbp_cid ~ '^[0-9]{5,25}$'),
  center_lat        double precision not null check (center_lat between -90 and 90),
  center_lng        double precision not null check (center_lng between -180 and 180),
  size              int not null default 5 check (size in (3, 5, 7, 9)),
  spacing_km        numeric not null default 3 check (spacing_km > 0 and spacing_km <= 50),
  zoom              int not null default 13 check (zoom between 3 and 21),
  depth             int not null default 20 check (depth between 10 and 100),
  cadence           text not null default 'weekly' check (cadence in ('weekly', 'monthly')),
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists local_grids_client_idx on public.local_grids (client_domain_id);
alter table public.local_grids enable row level security;

create table if not exists public.local_grid_points (
  id                bigint generated always as identity primary key,
  grid_id           uuid not null references public.local_grids(id) on delete cascade,
  client_domain_id  uuid not null references public.client_domains(id) on delete cascade,
  run_id            uuid references public.tracking_runs(id) on delete set null,
  run_date          date not null,
  row_idx           int not null check (row_idx between 0 and 8),
  col_idx           int not null check (col_idx between 0 and 8),
  lat               double precision not null,
  lng               double precision not null,
  rank              int check (rank is null or rank >= 1),
  depth             int not null,
  top               jsonb not null default '[]',
  cost              numeric not null default 0,
  created_at        timestamptz not null default now(),
  unique (grid_id, run_date, row_idx, col_idx)
);
create index if not exists local_grid_points_client_idx on public.local_grid_points (client_domain_id, run_date desc);
alter table public.local_grid_points enable row level security;
