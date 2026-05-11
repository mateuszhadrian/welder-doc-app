-- =============================================================================
-- 20260513000000_grant_effective_plan_authenticated
--
-- Tightens the EXECUTE grants on `public.effective_plan(uuid)` so only the
-- `authenticated` PostgREST role can invoke it from the REST API. The
-- original schema migration (20260507000000_complete_schema) created the
-- function without explicit grants, leaving Postgres' default — EXECUTE to
-- PUBLIC — plus the Supabase-managed default privileges that grant EXECUTE
-- on new functions to anon, authenticated, and service_role.
--
-- IMPORTANT — Supabase default privileges:
-- `roles.sql` (seeded by `supabase db reset`) issues
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
-- so REVOKE ALL FROM PUBLIC alone is NOT sufficient: each role keeps its
-- explicit grant. We therefore revoke from PUBLIC *and* from anon
-- specifically, leaving service_role intact (cron, webhook reconciliation,
-- and future admin paths legitimately call this function).
--
-- After this migration:
--   anon          → 401 from PostgREST (no EXECUTE)
--   authenticated → can call (explicit grant retained)
--   service_role  → can call (intentionally left intact for backend paths)
--   postgres      → owns the function (SECURITY DEFINER target)
--
-- The function body is unchanged. `SET search_path = ''` and `SECURITY DEFINER`
-- remain in place from the original definition.
--
-- The function is referenced by the daily `refresh_expired_plans` cron and by
-- the `subscriptions_after_iu_refresh_plan` trigger; both run as `postgres`
-- and are unaffected by these GRANT changes.
-- =============================================================================

revoke all on function public.effective_plan(uuid) from public;
revoke all on function public.effective_plan(uuid) from anon;
grant execute on function public.effective_plan(uuid) to authenticated;
