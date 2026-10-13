-- DIY P10 (13 Oct 2026, spec 10 sections 4.8, 5.8, 6.3 and 7.11): Links. Additive
-- only, under the 19 Sep 2026 authorisation: three new tables, one index on
-- them beside their keys' own, row level security on with no policies. No
-- existing table, column, row, constraint or policy is touched. Harmless
-- landing before or after the deploy: the Links page reads each of its
-- tables on its own (src/lib/diy/links/world.ts), and a section whose table
-- is not there yet says it could not be read rather than reading it as
-- empty, while Check a link's form and the pursued wins (which read
-- opportunities, not these tables) still draw; a check made before this
-- lands is refused as not saved. The Backlinks jobs are paid kinds, queued
-- only while diy_enabled is on. (13 Oct 2026, review of DIY P10: this
-- comment described per-section reads the page did not yet make.)
--
-- backlink_reads: one row per client, kind and night - the profile summary,
-- the week's new and lost referring domains, the 13-week series, the bulk
-- comparison, the domain gap, the page gap, and the confirmed mentions. The
-- payload holds the allow-listed fields of the parsers in
-- src/lib/scan/dataforseo-request.ts only: no link attributes, no sponsored
-- count, no spam score, no price. Lists are stored with Nomada's placements
-- for other clients already subtracted (the page subtracts again on read).
--
-- comparison_sets: the month's three compared vendor sites, derived and never
-- edited (a recorded rule), with each domain's basis - page-1 places, or a
-- fallback's shared keywords or linking domains - so the page states it.
--
-- link_checks: a member's "Check a link", one row a check: what we read and
-- whether the page links to the client, the anchor, whether the link is
-- followed (null when the content_parsing fallback read it, which returns no
-- rel) and the page of the client's it points at. No page text is stored.
--
-- Departures from the spec's SQL (section 5.8), each made before this file
-- was ever applied:
-- * Foreign keys say what a delete does (decided 13 Oct 2026): client_domain_id
--   cascades; read_id sets null, as diy_reads rows are the ledger's.
-- * backlink_reads.payload has a backstop of 128 KB (the writer refuses past
--   120,000 characters first: links/write.ts PAYLOAD_MAX), and created_at.
-- * comparison_sets holds at most 3 domains.
-- * link_checks is new: Check a link's result has to outlive the 303 that
--   answers the form, and nothing typed is echoed in the URL.
--
-- Service-role reads only, authorisation in the app, as every tracking table.
create table if not exists backlink_reads (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  kind text not null check (kind in ('summary','new_lost','timeseries','bulk','domain_gap','page_gap','mentions')),
  read_on date not null,
  read_id uuid references diy_reads(id) on delete set null,
  total_count integer,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 131072),
  created_at timestamptz not null default now(),
  unique (client_domain_id, kind, read_on)
);

create table if not exists comparison_sets (
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  month date not null,
  domains text[] not null check (cardinality(domains) <= 3),
  basis jsonb not null check (jsonb_typeof(basis) = 'object'),
  created_at timestamptz not null default now(),
  primary key (client_domain_id, month)
);

create table if not exists link_checks (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  url text not null check (char_length(url) <= 500),
  url_key text not null check (char_length(url_key) <= 520),
  checked_at timestamptz not null,
  via text not null check (via in ('own','content_parsing')),
  status text not null check (status in ('ok','blocked','error','not_html')),
  http_status integer,
  found boolean,
  rel text check (rel is null or rel in ('followed','not_followed')),
  anchor text check (anchor is null or char_length(anchor) <= 200),
  target text check (target is null or char_length(target) <= 500),
  by_email text not null,
  read_id uuid references diy_reads(id) on delete set null
);
-- The page reads a client's latest checks, and the allowance counts this month's.
create index if not exists link_checks_client_checked on link_checks (client_domain_id, checked_at desc);

alter table backlink_reads enable row level security;
alter table comparison_sets enable row level security;
alter table link_checks enable row level security;
