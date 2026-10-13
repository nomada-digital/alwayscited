-- DIY P7 (13 Oct 2026, spec 10 sections 5.8, 6.2 and 7.8): Opportunities and
-- the page facts behind them. Additive only, under the 19 Sep 2026
-- authorisation: three new tables, two indexes on them, row level security on
-- with no policies. No existing table, column, row, constraint or policy is
-- touched. Harmless landing before or after the deploy: the pages read every
-- section on its own and say a section could not be read rather than reading
-- it as empty, and the night jobs are not wired until the wave's shell does it.
--
-- source_kinds: a global cache of page and domain types, keyed 'd:<domain>'
-- or 'p:<url_key>'. Holds no client data: a type is a fact about a public
-- page. Written by the rules (set_by 'rule') during opportunity_refresh, and
-- by the classify job (set_by 'model') for what the rules left unclassified.
--
-- page_reads: what one read of a cited page found - its title, h1, h2/h3
-- headings (at most 40, each at most 120 characters), a last-updated date,
-- whether it names the client with a snippet of at most 200 characters, which
-- competitors from the evidence it names, and whether it links to the client.
-- No body text is stored (section 8.1, copyright). One row per client and page,
-- replaced by each read - except that a failed read never replaces a good one:
-- it sets attempted_at only, and the night's picker waits 14 days from the
-- later of read_at and attempted_at (13 Oct 2026, review of DIY P7: a page
-- that had started failing was picked every night).
--
-- opportunities: one row per client, page and lens. Departures from the spec's
-- SQL (section 5.8), each made before this file was ever applied:
-- * Foreign keys say what a delete does (decided 13 Oct 2026, as for
--   plan_items): client_domain_id cascades; cluster_id and prompt_id set null,
--   so an opportunity outlives a deleted cluster or prompt with its history;
--   page_reads.read_id sets null, as diy_reads rows are the ledger's.
-- * live: whether the latest opportunity_refresh still derived the row. A new
--   row that stops qualifying (its page now names the client, or it is no
--   longer cited) is set false rather than deleted, and the lists show new
--   rows only while live. Rows a member has moved keep their status whatever
--   it says.
-- * pursued_on: the day the row was first pursued, the start of first_cited
--   (section 6.2 step 9); status_at changes again at pitched and won.
-- * history: status changes, verifications and prompt steps, newest last, at
--   most 50 entries, each {at, kind, status?, by?, text?}. The detail page's
--   History block reads it.
-- * an 'own' row for a page type the client lacks has no page of its own: its
--   url is the client's homepage and its url_key is 'own:<cluster id>:<type>',
--   so the unique key holds one per cluster and type.
--
-- Service-role reads only, authorisation in the app, as every tracking table.
create table if not exists source_kinds (
  key text primary key check (char_length(key) between 3 and 520),
  level text not null check (level in ('domain','page')),
  domain_type text check (domain_type in ('vendor','platform','publisher','review_platform','community','video',
    'reference','directory','institutional','other')),
  page_type text check (page_type in ('best_of','comparison','alternatives','review_profile','how_to','article',
    'thread','category','product','homepage','other')),
  set_by text not null check (set_by in ('rule','model')),
  model text,
  classified_at timestamptz not null default now()
);

create table if not exists page_reads (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  url_key text not null check (char_length(url_key) <= 520),
  url text not null check (char_length(url) <= 500),
  read_at timestamptz not null,
  via text not null check (via in ('own','content_parsing')),
  status text not null check (status in ('ok','blocked','error','not_html')),
  http_status integer,
  title text check (title is null or char_length(title) <= 300),
  h1 text check (h1 is null or char_length(h1) <= 300),
  updated_on date,
  headings jsonb check (headings is null or (jsonb_typeof(headings) = 'array' and jsonb_array_length(headings) <= 40)),
  names_client boolean,
  client_snippet text check (client_snippet is null or char_length(client_snippet) <= 200),
  brands_found text[],
  links_to_client boolean,
  link_rel text check (link_rel is null or link_rel in ('followed','not_followed')),
  link_anchor text check (link_anchor is null or char_length(link_anchor) <= 200),
  attempted_at timestamptz,
  read_id uuid references diy_reads(id) on delete set null,
  unique (client_domain_id, url_key)
);

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  cluster_id uuid references tracked_clusters(id) on delete set null,
  lens text not null check (lens in ('cited','lists','threads','profiles','own','logged','link_domain','link_page','mention')),
  url text not null check (char_length(url) <= 500),
  url_key text not null check (char_length(url_key) <= 520),
  domain text not null check (char_length(domain) <= 253),
  title text check (title is null or char_length(title) <= 300),
  page_type text,
  domain_type text,
  route text not null check (route in ('ask_added','send_correction','get_listed','answer_thread','offer_resource',
    'publish_own','refresh_own','earn_link','ask_for_link','leave_it')),
  status text not null default 'new' check (status in ('new','pursuing','pitched','won','declined','dismissed')),
  dismiss_reason text check (dismiss_reason is null or dismiss_reason in ('competitor_site','not_relevant','cannot_approach','already_listed','other')),
  evidence jsonb not null default '{}'::jsonb,
  order_key jsonb,
  first_seen date,
  last_seen date,
  live boolean not null default true,
  revealed_at timestamptz,
  status_at timestamptz,
  status_by text,
  pursued_on date,
  note text check (note is null or char_length(note) <= 200),
  prompt_id uuid references tracked_questions(id) on delete set null,
  verified jsonb,
  first_cited jsonb,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_domain_id, url_key, lens)
);
create index if not exists opportunities_client_status on opportunities (client_domain_id, status);
-- Cited pages ?leaves=1 and the detail page find a client's page read by its page.
create index if not exists page_reads_client_read on page_reads (client_domain_id, read_at desc);

alter table source_kinds enable row level security;
alter table page_reads enable row level security;
alter table opportunities enable row level security;
