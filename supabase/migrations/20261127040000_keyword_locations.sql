-- Keyword reads by place, and what a read says beyond the position (27 Nov 2026, Danny: Common's York keywords).
-- client_domains.search_location_*  a client local to one place: every keyword is read from there unless it names another place
-- tracked_keywords.location_*       one keyword's own override (staff)
-- tracking_serp.location_*          the place the page was read for (null: the country)
-- tracking_serp.aio_shown/aio_named an AI Overview showed for the search / it names the client or cites the client's site
-- tracking_serp.listed              third-party pages in the top 10 whose title or snippet names the client: [{rank, domain, url, title}]
-- Kept apart from tracking_serp.position, which is only ever the client's own domain.
alter table public.client_domains add column if not exists search_location_code integer;
alter table public.client_domains add column if not exists search_location_name text;
alter table public.tracked_keywords add column if not exists location_code integer;
alter table public.tracked_keywords add column if not exists location_name text;
alter table public.tracking_serp add column if not exists location_code integer;
alter table public.tracking_serp add column if not exists location_name text;
alter table public.tracking_serp add column if not exists aio_shown boolean;
alter table public.tracking_serp add column if not exists aio_named boolean;
alter table public.tracking_serp add column if not exists listed jsonb;
