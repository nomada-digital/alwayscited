-- Find keywords: a placeholder from the client's own space, and a default toggle by business type (27 Nov 2026, Danny).
-- client_domains.keyword_placeholders  {all, b2b, b2c}: each {term, source: 'keywords'|'generated', volume} - cached so the example never flickers
-- client_domains.business_type         'b2b' or 'b2c': which side of the B2B / B2C toggle Find keywords opens on (null: from the order's sector, else All)
alter table public.client_domains add column if not exists keyword_placeholders jsonb;
alter table public.client_domains add column if not exists business_type text check (business_type is null or business_type in ('b2b','b2c'));
update public.client_domains set business_type = 'b2b' where business_type is null and slug in ('common-agency','mortalentboutique-com','volunteero-org');
update public.client_domains set business_type = 'b2c' where business_type is null and slug in ('laverleisure-co-uk','alistairmacphotography-com','serendipityyork-co-uk');
