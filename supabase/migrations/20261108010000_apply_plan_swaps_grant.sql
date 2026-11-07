-- apply_plan_swaps (20261108000000) was revoked from public, anon and authenticated and granted to nobody in that
-- file. Live, service_role already holds execute through Supabase's default privileges (read back 7 Nov 2026:
-- proacl {postgres=X, service_role=X}), so this changes nothing there; it states the grant in the migrations, where
-- function-grants.test.mts reads it, and holds it on any database built from these files. Additive only.
grant execute on function public.apply_plan_swaps(date) to service_role;
