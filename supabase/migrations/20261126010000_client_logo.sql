-- Client logos (Danny, 26 Nov 2026): each client's favicon, shown beside its name in the agency and customer
-- dashboards, with initials where there is none. Additive: one nullable column and a backfill of the column just added.
-- logo_url is the favicon's own address (https only); the dashboards host serves it same-origin through
-- /api/dash/logo/<slug> (the CSP's img-src is 'self'), cached. MOR Talent Boutique has none: its site's only icon is a
-- text wordmark that is unreadable at favicon size, so it shows initials.
alter table public.client_domains add column if not exists logo_url text;
alter table public.client_domains drop constraint if exists client_domains_logo_url_https;
alter table public.client_domains add constraint client_domains_logo_url_https check (logo_url is null or (logo_url ~ '^https://[^\s]+$' and char_length(logo_url) <= 500));

update public.client_domains set logo_url = v.url
from (values
  ('volunteero-org', 'https://framerusercontent.com/images/0U9FOMxdSWw5agdNmaobATpmJc.png'),
  ('common-agency', 'https://framerusercontent.com/images/U9RkijVzufKzxcWWUb7MKkC0Y.png'),
  ('laverleisure-co-uk', 'https://www.laverleisure.co.uk/icons/icon-192x192.png'),
  ('propelo-co-uk', 'https://www.propelo.co.uk/images/web-app-icons/apple-touch-icons/200x200.png'),
  ('serendipityyork-co-uk', 'https://www.serendipityyork.co.uk/images/favicon-96x96.png'),
  ('alistairmacphotography-com', 'https://static.wixstatic.com/media/e3e28e_eae51995e83c4b65923af3fc56a59da8%7Emv2.jpg/v1/fill/w_192%2Ch_192%2Clg_1%2Cusm_0.66_1.00_0.01/e3e28e_eae51995e83c4b65923af3fc56a59da8%7Emv2.jpg'),
  ('alwayscited-com', 'https://alwayscited.com/icon.svg'),
  ('nomadadigital-co-uk', 'https://www.nomadadigital.co.uk/apple-touch-icon.png'),
  ('goodtrip-co-uk', 'https://goodtrip.co.uk/cdn/shop/files/Globe_actual_final_64x.png?v=1652403834'),
  ('propellerindustries-com', 'https://www.propellerindustries.com/assets/apple-touch-icon.png?id=91d5e97fd783f4da4d61bf8418a411ee')
) as v(slug, url)
where client_domains.slug = v.slug and client_domains.logo_url is null;
