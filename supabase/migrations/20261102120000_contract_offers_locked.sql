-- Contract offers, 2 Nov 2026 (Volunteero): an offer may fix its keyword, and may run monthly until cancelled.
--
-- keyword_locked: the plan is this one cluster on `keyword`. Signup makes cluster 1 on it as it is (no starter checks,
-- which swapped MOR's keyword on 31 Oct), and sets the client's cluster_limit to 1. The offer page shows it as fixed.
-- charges null: no end date is set on the subscription; it bills monthly until cancelled.
--
-- Additive only: a new column with a default, and a not-null dropped (the 1-36 check still holds when set).

alter table public.contract_offers add column if not exists keyword_locked boolean not null default false;
alter table public.contract_offers alter column charges drop not null;
