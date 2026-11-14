-- Schema Nomada has delivered to a customer (Danny, 14 Nov 2026: COMMON's "Schema for your site" must not contradict
-- the schema work Nomada already did for them; "if that work is live, mark it complete"). Additive: one new table and
-- COMMON's three blocks as seed rows. TO BE APPLIED BY DISPATCH.
--
-- One row per block and version: what it is, where it goes, when and by whom it was supplied, and `expected` - each
-- node's @id with its types and property names, as supplied (never the values). The dashboard's Schema page
-- (lib/dash/schema-build.ts) reads the live pages and, for each block, says "Added by Nomada on <date>" when its latest
-- version is on the site, "Updated version supplied <date>, waiting to go live" when only an earlier one is, or
-- "Supplied <date>, waiting to go live"; and it recommends nothing a delivered block covers (never a second
-- Organization). Staff add rows from the hub's customer page through /api/hub/agency schema_delivered_set.
-- Service-role only: RLS on, no policies.
create table if not exists public.schema_delivered (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  block_key        text not null check (block_key ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  version          integer not null default 1 check (version between 1 and 99),
  label            text not null check (char_length(label) between 3 and 160),
  where_url        text not null check (where_url = 'sitewide' or where_url ~ '^https?://'),
  how              text check (how is null or char_length(how) <= 200),
  supplied_on      date not null,
  supplied_by      text not null check (char_length(supplied_by) between 2 and 120),
  expected         jsonb not null check (jsonb_typeof(expected) = 'object' and pg_column_size(expected) <= 32768),
  note             text check (note is null or char_length(note) <= 500),
  created_by       text not null,
  created_at       timestamptz not null default now(),
  unique (client_domain_id, block_key, version)
);
create index if not exists schema_delivered_client_idx on public.schema_delivered (client_domain_id);
alter table public.schema_delivered enable row level security;

-- COMMON (common.agency): Nomada's schema spec, first version (29 Oct; live in Framer today) and the update sent to
-- COMMON on 13 Nov. The first version's `expected` is what is live on the site now; the update's is the spec's graph.
insert into public.schema_delivered (client_domain_id, block_key, version, label, where_url, how, supplied_on, supplied_by, expected, note, created_by)
select * from (values
  ((select id from public.client_domains where slug = 'common-agency'), 'site-graph', 1, 'Site-wide graph (Organization, WebSite and leadership)', 'sitewide', 'Framer site custom code', date '2026-10-29', 'Luke Wilson, Nomada', '{"https://www.common.agency/#organization":{"types":["Organization","ProfessionalService"],"props":["address","alternateName","areaServed","description","email","image","knowsAbout","logo","memberOf","name","parentOrganization","sameAs","url"]},"https://www.common.agency/#website":{"types":["WebSite"],"props":["inLanguage","name","publisher","url"]}}'::jsonb, 'First version, from the schema spec sent 30 Oct; put live directly in Framer by COMMON.', 'seed 20261114010000'),
  ((select id from public.client_domains where slug = 'common-agency'), 'site-graph', 2, 'Site-wide graph (Organization, WebSite and leadership)', 'sitewide', 'Framer site custom code', date '2026-11-13', 'Luke Wilson, Nomada', '{"https://www.common.agency/#organization":{"types":["Organization","ProfessionalService"],"props":["address","alternateName","areaServed","contactPoint","description","email","employee","founder","image","knowsAbout","logo","memberOf","name","numberOfEmployees","parentOrganization","sameAs","slogan","url"]},"https://www.common.agency/#phil-clark":{"types":["Person"],"props":["jobTitle","name","worksFor"]},"https://www.common.agency/#john-brolly":{"types":["Person"],"props":["jobTitle","name","worksFor"]},"https://www.common.agency/#jordan-donnelly":{"types":["Person"],"props":["jobTitle","name","worksFor"]},"https://www.common.agency/#website":{"types":["WebSite"],"props":["inLanguage","name","publisher","url"]}}'::jsonb, 'Updated to the new site copy and sent to COMMON 13 Nov: replaces the live block in Framer.', 'seed 20261114010000'),
  ((select id from public.client_domains where slug = 'common-agency'), 'craft-graph', 1, 'Craft CMS page graph (WebPage, Service, FAQPage)', 'https://www.common.agency/craft-cms', 'Framer page custom code', date '2026-10-29', 'Luke Wilson, Nomada', '{"https://www.common.agency/craft-cms#webpage":{"types":["WebPage"],"props":["about","breadcrumb","description","inLanguage","isPartOf","name","url"]},"https://www.common.agency/craft-cms#breadcrumb":{"types":["BreadcrumbList"],"props":["itemListElement"]},"https://www.common.agency/craft-cms#service":{"types":["Service"],"props":["areaServed","description","hasOfferCatalog","name","provider","serviceType","url"]},"https://www.common.agency/craft-cms#faq":{"types":["FAQPage"],"props":["mainEntity"]}}'::jsonb, 'First version, from the schema spec sent 30 Oct; put live directly in Framer by COMMON.', 'seed 20261114010000'),
  ((select id from public.client_domains where slug = 'common-agency'), 'craft-graph', 2, 'Craft CMS page graph (WebPage, Service, FAQPage)', 'https://www.common.agency/craft-cms', 'Framer page custom code', date '2026-11-13', 'Luke Wilson, Nomada', '{"https://www.common.agency/craft-cms#webpage":{"types":["WebPage"],"props":["about","breadcrumb","description","inLanguage","isPartOf","mentions","name","primaryImageOfPage","url"]},"https://www.common.agency/craft-cms#breadcrumb":{"types":["BreadcrumbList"],"props":["itemListElement"]},"https://www.common.agency/craft-cms#craft-cms":{"types":["SoftwareApplication"],"props":["applicationCategory","author","name","url"]},"https://www.common.agency/craft-cms#service":{"types":["Service"],"props":["areaServed","audience","description","hasOfferCatalog","name","provider","serviceType","url"]},"https://www.common.agency/craft-cms#faq":{"types":["FAQPage"],"props":["mainEntity"]}}'::jsonb, 'Updated to the new page and sent to COMMON 13 Nov: replaces the live block in Framer.', 'seed 20261114010000'),
  ((select id from public.client_domains where slug = 'common-agency'), 'home-graph', 1, 'Homepage graph (WebPage and capability catalogue)', 'https://www.common.agency/', 'Google Tag Manager, tag Schema - Homepage', date '2026-11-13', 'Luke Wilson, Nomada', '{"https://www.common.agency/#webpage":{"types":["WebPage"],"props":["about","description","inLanguage","isPartOf","mainEntity","name","primaryImageOfPage","url"]},"https://www.common.agency/#organization":{"types":["Organization","ProfessionalService"],"props":["hasOfferCatalog"]}}'::jsonb, 'New, sent 13 Nov: goes in through GTM until it moves into Framer.', 'seed 20261114010000')
) as v(client_domain_id, block_key, version, label, where_url, how, supplied_on, supplied_by, expected, note, created_by)
where v.client_domain_id is not null
on conflict (client_domain_id, block_key, version) do nothing;
