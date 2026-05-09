-- =============================================================================
-- 20260511000000_fix_documents_rls_email_confirmed
--
-- Fixes a latent bug in `documents_*_authenticated` RLS policies introduced by
-- 20260507000000_complete_schema. Each policy embeds:
--
--   EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
--                                       AND u.email_confirmed_at IS NOT NULL)
--
-- but `authenticated` / `anon` roles have no SELECT grant on `auth.users`
-- (Supabase isolates that table by design). PostgREST therefore returns
-- `42501 permission denied for table users` for every INSERT/SELECT/UPDATE/
-- DELETE through the REST API — silently if the surrounding code only
-- captures the boolean success flag (cf. US-007 guest migration during
-- US-002 sign-in).
--
-- Fix: extract the email-confirmed check into a SECURITY DEFINER helper
-- (`public.user_email_confirmed`) that runs as `postgres` and is granted
-- EXECUTE to `authenticated`. The helper is `stable`, takes no arguments,
-- and reads `auth.uid()` internally so callers cannot point it at someone
-- else's user id.
--
-- The four existing documents policies are dropped and recreated against
-- the helper. Behaviour is preserved bit-for-bit; only the path through
-- which auth.users is read changes.
-- =============================================================================

-- step 1: helper function
create or replace function public.user_email_confirmed()
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
  as $$
    select exists (
      select 1
      from auth.users
      where id = auth.uid()
        and email_confirmed_at is not null
    );
  $$;

comment on function public.user_email_confirmed() is
  'returns true when the JWT-bound user has a confirmed email; SECURITY DEFINER so it can read auth.users without granting the role direct SELECT';

revoke all on function public.user_email_confirmed() from public;
grant execute on function public.user_email_confirmed() to authenticated;

-- step 2: rebuild documents policies against the helper
-- The original migration created a single FOR ALL policy named
-- `documents_owner_all`; we replace it with four operation-scoped policies
-- so each can be reasoned about independently. Both naming variants are
-- dropped here so this migration is idempotent across environments where
-- it may have been partially applied during development.
drop policy if exists documents_owner_all on public.documents;
drop policy if exists documents_select_authenticated on public.documents;
drop policy if exists documents_insert_authenticated on public.documents;
drop policy if exists documents_update_authenticated on public.documents;
drop policy if exists documents_delete_authenticated on public.documents;

create policy documents_select_authenticated
  on public.documents
  for select
  to authenticated
  using (owner_id = auth.uid() and public.user_email_confirmed());

create policy documents_insert_authenticated
  on public.documents
  for insert
  to authenticated
  with check (owner_id = auth.uid() and public.user_email_confirmed());

create policy documents_update_authenticated
  on public.documents
  for update
  to authenticated
  using (owner_id = auth.uid() and public.user_email_confirmed())
  with check (owner_id = auth.uid() and public.user_email_confirmed());

create policy documents_delete_authenticated
  on public.documents
  for delete
  to authenticated
  using (owner_id = auth.uid() and public.user_email_confirmed());
