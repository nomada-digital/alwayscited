-- Weekly recommendations for alwaystracked customers (Danny, 22 Nov 2026): three to five clear things a customer can
-- do themselves each week, each with why, evidence and how to do it, and at most one or two "we could build this for
-- you" rows (kind 'upgrade') that point at the existing upgrade path.
--
-- Written weekly by the Nomada hub (service role); the dashboard only reads. The dashboard shows a row only once
-- released_at is set, which is when the account manager approves that week's email, so nothing reaches a customer
-- before a person has looked at it.
--
-- * week_of is the Monday of the week the row belongs to; position is 1..5 within that week.
-- * evidence: { answers?, engines?, prompts?, url?, domain?, competitors?, since? } - what the readings showed.
-- * how: the steps, a json array of strings. href: the external page to act on, when there is one.
-- * offer, for kind 'upgrade' only: { tier, what }. A price is NEVER stored: the dashboard reads it from
--   src/config/pricing.ts when it draws the card, so a price change cannot leave an old figure here.
-- * source_key de-duplicates a week's rows, so the weekly job can run twice without doubling the list.
-- * status: new, done or dismissed. Read-only on the dashboard for now; the hub may set it.
--
-- Additive only, under the 19 Sep 2026 authorisation: one new table, one index, row level security on with no
-- policies. No existing table, column, row, constraint or policy is touched. Harmless landing before or after the
-- deploy: the Recommendations page says the section could not be read, rather than reading a missing table as empty.
--
-- Service-role reads only, authorisation in the app, as every tracking table.
create table if not exists customer_recommendations (
  id uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references client_domains(id) on delete cascade,
  week_of date not null,
  position int not null check (position between 1 and 5),
  kind text not null check (kind in ('schema','content','profile','on_page_answer','listing','upgrade')),
  title text not null check (char_length(title) <= 160),
  why text not null,
  evidence jsonb not null default '{}',
  how jsonb not null default '[]',
  href text,
  offer jsonb,
  source_key text not null,
  status text not null default 'new' check (status in ('new','done','dismissed')),
  status_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_domain_id, week_of, source_key)
);

create index if not exists customer_recommendations_client_week on customer_recommendations (client_domain_id, week_of);

alter table customer_recommendations enable row level security;
