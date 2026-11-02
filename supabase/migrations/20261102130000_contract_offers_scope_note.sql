-- Contract offers, 2 Nov 2026: one optional line under the keyword cluster on the offer page, for how the agreed
-- scope unfolds (Volunteero: UK first, then the US, with PR support). Kept in the row, not the code, as the price is:
-- this repository is public. Additive only: a nullable column; null shows nothing.

alter table public.contract_offers add column if not exists scope_note text check (scope_note is null or length(scope_note) <= 200);
