-- The placement budget is per customer (Danny, 10 Nov 2026: "$750 PER CUSTOMER PER MONTH"). Comments only: the column
-- keeps its name (a rename is destructive DDL, and the hub's finder read it by name until today), and the rule lives in
-- src/lib/csm/allocation.ts. No row changes: the 750 Danny set on 5 Nov is now each customer's monthly amount.
comment on table public.placement_budget_settings is
  'AGENCY-ONLY. One row: the monthly placement budget each customer on a placement plan gets (allocation.ts). Per customer since 2026-11-10; it was one cap split across every client.';
comment on column public.placement_budget_settings.global_cap_usd is
  'Per-customer monthly placement budget, USD: every paying client on the alwaysmentioned or alwayscited plan gets this each month, unless placement_budgets leaves it out or an override sets its own. Not a shared cap (until 2026-11-10 it was split by plan price). Name kept from 2026-11-06.';
comment on table public.placement_budgets is
  'AGENCY-ONLY. Says otherwise for one client: excluded, or weight_override 0, gives it no budget; weight_override above 0 gives the per-customer budget to a client that would get none (an internal brand, or one with no order). No row: the plan''s own rule. Since 2026-11-10 a weight no longer splits anything.';
comment on column public.placement_budgets.weight_override is
  'Since 2026-11-10: 0 leaves the client out of the per-customer budget, above 0 puts it in; null is the plan''s own rule. It was a weight on the shared cap.';
