-- Manual overrides for placements and link insertions (25 Nov 2026). WLDM keeps the link tracker sheet and is sometimes
-- slow to update it (a Common Agency placement was live for days and still "in progress" on the customer's page), so
-- the team can mark an item live, change its stage or correct its URL or anchor from the agency/admin view
-- (/admin/links, and links_* on /api/hub/agency). Additive only, under the 19 Sep 2026 authorisation: one new table,
-- nothing existing changed, and harmless landing before or after the deploy (the code reads "no overrides" while the
-- table is absent, so the sync and the customer's page behave exactly as before).
--
-- One row per item, the CURRENT override; who changed what and when stays in agency_edits (old and new value, actor,
-- time), as every agency edit does. The sheet sync never writes this table's rows' items back over them:
--   source 'sheet_link' - item_key is sheet_links.url_key, kind its kind. The customer's read applies the override over
--                         the sheet's row (lib/links/override.ts); the sync is untouched, so it cannot revert it.
--   source 'progress'   - item_key is the sheet's NOM-0000 id (placements_in_progress.placement_ref), kind 'placement'.
--                         placements_sync skips an overridden item, and clears the override when the sheet agrees.
-- When the sheet catches up and agrees, the sync sets active false (cleared_at, cleared_reason) and the sheet is
-- the truth again. While an override is active and the sheet differs, the internal view shows "differs from WLDM
-- sheet"; the customer never sees the override, the flag or the note.
--
-- link_check is the last "is our link on the page" result (lib/links/check.ts): found, anchor, status, when.
-- Service-role only, authorisation in the app, as every tracking table: RLS on, no policies.
create table if not exists public.link_overrides (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  source           text not null check (source in ('sheet_link', 'progress')),
  kind             text not null check (kind in ('insertion', 'placement')),
  item_key         text not null check (char_length(item_key) between 1 and 500),
  status           text not null check (char_length(status) between 2 and 60),
  live_url         text check (live_url is null or (char_length(live_url) <= 500 and live_url ~* '^https?://')),
  anchor_text      text check (anchor_text is null or char_length(anchor_text) <= 200),
  live_on          date,
  note             text check (note is null or char_length(note) <= 1000),
  link_check       jsonb,
  active           boolean not null default true,
  set_by           text not null check (char_length(set_by) between 3 and 320),
  set_at           timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  cleared_at       timestamptz,
  cleared_reason   text check (cleared_reason is null or char_length(cleared_reason) <= 200),
  unique (client_domain_id, source, item_key)
);
create index if not exists link_overrides_client_idx on public.link_overrides (client_domain_id, active);
alter table public.link_overrides enable row level security;
