-- Your tasks: a "Connect Bing Webmaster Tools" task completes when the Bing connection does (27 Nov 2026).
alter table public.client_tasks drop constraint if exists client_tasks_kind_check;
alter table public.client_tasks add constraint client_tasks_kind_check check (kind in ('manual','connect_gsc','connect_ga4','connect_bing','page_check'));
