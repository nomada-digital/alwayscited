-- What a client's package delivers, beyond its tier (Danny, 8 Nov 2026). Additive: two columns, defaulting to the tier
-- as it is. Not yet applied when revised (8 Nov 2026, the same day): ranking_kpi added beside excluded_deliverables.
--
-- ranking_kpi: whether the client has a ranking-target KPI. Link insertions are only for a client that does, so false
--   takes link insertions out of the package wherever targets are drawn - the customer's dashboard (lib/dash/plan.ts
--   deliverables, packageIncludes) and the agency hub's monthly tracker (alwayscited-admin adds it to the customer read).
-- excluded_deliverables: anything else a package leaves out of its tier, by lib/dash/plan.ts DELIVERABLE_KEYS.
alter table public.client_domains add column if not exists ranking_kpi boolean not null default true;
alter table public.client_domains add column if not exists excluded_deliverables text[] not null default '{}'
  check (excluded_deliverables <@ array['placements', 'insertions', 'schema', 'pr']::text[]);

-- Volunteero (volunteero.org) stays on the alwayscited plan; its KPIs are AI visibility, with no ranking target, so no
-- link insertions. Backfill of the column just added.
update public.client_domains set ranking_kpi = false where domain = 'volunteero.org' and ranking_kpi;
