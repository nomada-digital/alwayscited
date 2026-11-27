-- Your tasks: Netlify (Gatsby) and SeeCMS join the detected platforms (27 Nov 2026).
alter table public.client_domains drop constraint if exists client_domains_site_platform_check;
alter table public.client_domains add constraint client_domains_site_platform_check check (site_platform is null or site_platform in ('shopify','wordpress','webflow','squarespace','wix','framer','netlify','seecms','custom'));
