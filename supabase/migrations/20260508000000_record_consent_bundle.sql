-- migration: 20260508000000_record_consent_bundle.sql
-- purpose: introduce atomic consent bundle recorder for /api/consent
-- affected tables: consent_log (append), user_profiles (update of current_consent_version)
-- affected functions: record_consent_bundle (new)
-- special considerations:
--   - security definer with empty search_path (cve-2018-1058 mitigation)
--   - p_user_id is validated against auth.uid() to prevent forging consent
--     for another user; service_role bypasses this check (used by admin tooling)
--   - bypasses block_protected_columns_update via the `current_user = 'postgres'`
--     branch added in 20260509000000_paddle_webhook_hardening.sql; auth.role()
--     reflects the jwt role (e.g. 'authenticated') and would NOT bypass the
--     trigger on its own — it is the security definer's executing role
--     (current_user) that does
--   - replaces the previous 2-step handler logic (consent_log insert → admin
--     update of current_consent_version) which was non-atomic and could leave
--     consent_log out of sync with user_profiles.current_consent_version
--     (gdpr art. 7 ust. 1 audit gap — see code-documentation-problems-v5.md §2.7)

-- atomic bundle recorder: inserts terms_of_service + privacy_policy + cookies
-- rows into consent_log AND updates user_profiles.current_consent_version in
-- a single transaction. revocation flow (accepted = false) skips the
-- current_consent_version update — only acceptances bump the denormalised
-- pointer (per api-plan.md §2.1).
create or replace function public.record_consent_bundle(
  p_user_id    uuid,
  p_version    text,
  p_accepted   boolean,
  p_ip         inet,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_uid  uuid;
  caller_role text;
begin
  caller_role := coalesce(auth.role(), 'anon');
  caller_uid  := auth.uid();

  -- service_role may record consent for any user (admin tooling, migrations).
  -- authenticated callers may record consent only for themselves; anon is rejected.
  if caller_role <> 'service_role' then
    if caller_role <> 'authenticated' or caller_uid is null or caller_uid <> p_user_id then
      raise exception 'unauthorized_consent_target'
        using hint = 'p_user_id must match auth.uid() for authenticated callers';
    end if;
  end if;

  insert into public.consent_log (
    user_id, consent_type, version, accepted, ip_address, user_agent
  )
  values
    (p_user_id, 'terms_of_service', p_version, p_accepted, p_ip, p_user_agent),
    (p_user_id, 'privacy_policy',   p_version, p_accepted, p_ip, p_user_agent),
    (p_user_id, 'cookies',          p_version, p_accepted, p_ip, p_user_agent);

  -- only acceptances update the cache; revocations leave current_consent_version
  -- pointing at the last accepted version (audit reconstruction reads consent_log).
  if p_accepted then
    update public.user_profiles
    set current_consent_version = p_version
    where id = p_user_id;
  end if;
end;
$$;

-- expose the function to the supabase rest layer for authenticated callers.
-- service_role implicitly has execute via postgres owner; explicit grant for
-- authenticated is required for `supabase.rpc('record_consent_bundle', ...)`
-- from a session-scoped client.
grant execute on function public.record_consent_bundle(uuid, text, boolean, inet, text)
  to authenticated, service_role;

comment on function public.record_consent_bundle(uuid, text, boolean, inet, text) is
  'atomically records a tos+pp+cookies consent bundle and bumps user_profiles.current_consent_version (only for accepted=true). enforces auth.uid() = p_user_id for authenticated callers; service_role may record on behalf of any user. used by /api/consent route handler.';
