-- What a client's package leaves out of its tier (Danny, 8 Nov 2026). Additive: one column, defaulting to nothing left out.
-- The dashboard drops these from "Your plan" and from each cluster's monthly delivery, so it never promises them
-- (lib/dash/plan.ts deliverables, packageIncludes). Keys are lib/dash/plan.ts DELIVERABLE_KEYS.
alter table public.client_domains add column if not exists excluded_deliverables text[] not null default '{}'
  check (excluded_deliverables <@ array['placements', 'insertions', 'schema', 'pr']::text[]);

-- Volunteero (volunteero.org) stays on the alwayscited plan without link insertions: those are for clients with a
-- ranking-target KPI, and Volunteero's KPIs are AI visibility. Backfill of the column just added.
update public.client_domains set excluded_deliverables = array['insertions']
 where domain = 'volunteero.org' and excluded_deliverables = '{}';
