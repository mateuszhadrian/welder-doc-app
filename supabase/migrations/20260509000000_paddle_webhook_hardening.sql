-- migration: 20260509000000_paddle_webhook_hardening.sql
-- purpose: harden the paddle webhook flow + atomic consent bundle (code-documentation-problems-v6 §1.1, §1.2, §2.5)
-- affected functions:
--   - lookup_user_id_by_email (new): scalable email → user_id lookup for paddle webhook
--   - block_protected_columns_update (replace): allow security definer functions running as the postgres
--     owner role to bypass the protection (auth.role() reflects jwt role, not the executing db role)
--   - trg_subscriptions_refresh_plan (replace): refresh both old and new user_id when user_id changes,
--     so that orphan-record recovery (UPDATE subscriptions SET user_id = ...) refreshes user_profiles.plan
-- affected triggers:
--   - subscriptions_after_iu_refresh_plan (replace): add user_id to OF column list
-- special considerations:
--   - all functions remain security definer + set search_path = '' (cve-2018-1058 mitigation)
--   - current_user inside a security definer function returns the function owner role (postgres),
--     unlike auth.role() which reads from request.jwt.claims (independent of definer/invoker)

-- ============================================================
-- §1.1 lookup_user_id_by_email — replaces auth.admin.listUsers() pagination
-- ============================================================

-- maps an email address to auth.users.id via a single SQL lookup.
-- auth.users is not exposed by postgrest, so the paddle webhook handler
-- previously relied on auth.admin.listUsers({ perPage: 200 }) and missed
-- users beyond the first page. this function scales to any user count
-- and is callable from the service_role client via supabase.rpc(...).
create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;
$$;

-- restrict execution to service_role only (paddle webhook handler).
-- authenticated callers must not be able to enumerate users by email.
revoke execute on function public.lookup_user_id_by_email(text) from public;
grant execute on function public.lookup_user_id_by_email(text) to service_role;

comment on function public.lookup_user_id_by_email(text) is
  'maps an email address to auth.users.id; service_role only. used by /api/paddle/webhook lookupUserId fallback to scale beyond the 200-user limit of auth.admin.listUsers.';

-- ============================================================
-- §2.5 block_protected_columns_update — allow postgres-owner security definer bypass
-- ============================================================

-- previous version: only `auth.role() = 'service_role'` bypassed the protection.
-- problem: a security definer function running as the postgres owner still
-- sees `auth.role()` returning the caller's jwt role (e.g. 'authenticated'),
-- because auth.role() reads from request.jwt.claims — it is *not* tied to
-- the executing database role. consequence: record_consent_bundle (security
-- definer) was unable to update user_profiles.current_consent_version when
-- invoked by an authenticated caller.
-- fix: explicitly bypass when current_user = 'postgres', which *is* the
-- security definer execution role. service_role bypass kept for direct
-- writes from admin clients that don't go through a definer function.
create or replace function public.block_protected_columns_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- security definer functions run as the postgres owner role.
  -- letting the trigger fall through here is what allows
  -- record_consent_bundle, refresh_user_plan_from_subscriptions and
  -- sync_paddle_customer to update protected columns atomically.
  if current_user = 'postgres' then
    return new;
  end if;
  if coalesce(auth.role(), 'anon') <> 'service_role' then
    new.plan                    := old.plan;
    new.paddle_customer_id      := old.paddle_customer_id;
    new.current_consent_version := old.current_consent_version;
  end if;
  return new;
end;
$$;

-- ============================================================
-- §1.2 trg_subscriptions_refresh_plan + trigger — handle user_id transitions
-- ============================================================

-- previous trigger fired only on (status, current_period_end) changes,
-- so manual orphan recovery (UPDATE subscriptions SET user_id = ...
-- WHERE paddle_subscription_id = ...) did not refresh user_profiles.plan.
-- new behaviour:
--   - fires also on user_id change
--   - refreshes both the new user (effective plan now includes the row)
--     and the previous user (effective plan no longer includes it)
create or replace function public.trg_subscriptions_refresh_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    perform public.refresh_user_plan_from_subscriptions(new.user_id);
  end if;
  if tg_op = 'UPDATE'
    and old.user_id is not null
    and old.user_id is distinct from new.user_id
  then
    perform public.refresh_user_plan_from_subscriptions(old.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_after_iu_refresh_plan on public.subscriptions;
create trigger subscriptions_after_iu_refresh_plan
  after insert or update of status, current_period_end, user_id on public.subscriptions
  for each row execute function public.trg_subscriptions_refresh_plan();
