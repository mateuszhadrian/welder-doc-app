-- migration: 20260510000000_fix_consent_version_comment.sql
-- purpose: fix outdated comment on user_profiles.current_consent_version
-- reason: original comment from 20260507000000 claims the column is written
--         by the /api/consent handler running as service_role. that is no
--         longer accurate after migrations 20260508000000 (record_consent_bundle
--         security definer) and 20260509000000 (block_protected_columns_update
--         postgres-owner bypass). actual write path:
--           - /api/consent uses session-scoped client (createClient from @supabase/ssr)
--           - rpc record_consent_bundle (SECURITY DEFINER) executes as postgres role
--           - block_protected_columns_update bypass via `current_user = 'postgres'`
--         this comment goes into pg_description, supabase studio tooltips, and
--         supabase gen types output, so the drift surfaces to every consumer.

comment on column public.user_profiles.current_consent_version is
  'denormalised version of the most recent accepted consent bundle (tos+pp+cookies); read-only for the authenticated role (block_protected_columns_update trigger); written exclusively by the SECURITY DEFINER function record_consent_bundle() (executes as postgres role, bypassing block_protected_columns_update via current_user = ''postgres'' branch added in 20260509000000) — invoked by the /api/consent route handler operating on a session-scoped client (NOT service_role).';
