-- Seed danych dla lokalnego dewelopera / E2E.
-- Uruchamiane automatycznie przez `pnpm supabase db reset`, ale **idempotentny**
-- — można też wywołać samodzielnie bez resetu DB:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed.sql
-- Każdy INSERT używa `ON CONFLICT (id) DO NOTHING`, każdy UPDATE jest stabilny.
-- Powtórne wywołanie nie tworzy duplikatów ani nie nadpisuje innych userów.
--
-- Hasła: wszystkie test users mają hasło `Test123456!` (powyżej minimum 6
-- znaków wymaganego przez GoTrue).
-- Email-confirmation: GoTrue lokalnie ma `enable_confirmations = false`
-- w `supabase/config.toml`, więc email_confirmed_at jest ustawiany przez
-- nas explicite, by deterministycznie kontrolować scenariusze testowe.
--
-- UWAGA: ten plik celowo NIE używa transakcji — błąd na jednym userze nie
-- może wycofać reszty seeda.

-- =============================================================================
-- E2E test users
-- =============================================================================

-- E2E #1: PL locale + zaakceptowana wersja TOS — happy path login.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated',
  'e2e-pl-ok@test.local',
  crypt('Test123456!', gen_salt('bf')),
  now(), now(), now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict (id) do nothing;

-- E2E #2: EN locale + zaakceptowana wersja — test locale-redirect.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated',
  'e2e-en-ok@test.local',
  crypt('Test123456!', gen_salt('bf')),
  now(), now(), now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict (id) do nothing;

-- E2E #3: PL locale, brak akceptacji regulaminu — test consent-required.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated',
  'e2e-no-consent@test.local',
  crypt('Test123456!', gen_salt('bf')),
  now(), now(), now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict (id) do nothing;

-- E2E #4: niepotwierdzony email — test EMAIL_NOT_CONFIRMED.
-- email_confirmed_at = NULL, ale tylko gdy lokalna konfiguracja GoTrue
-- ma enable_confirmations = true. Jeśli false (default) to login się
-- powiedzie. Test powinien używać tego userka warunkowo.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '44444444-4444-4444-4444-444444444444',
  'authenticated', 'authenticated',
  'e2e-unconfirmed@test.local',
  crypt('Test123456!', gen_salt('bf')),
  null, now(), now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict (id) do nothing;

-- =============================================================================
-- Profile state — handle_new_user trigger już utworzył wpisy w user_profiles.
-- Aktualizujemy je tutaj jako rola `postgres` (seed run jako superuser),
-- co omija block_protected_columns_update (trigger pomija postgres).
-- =============================================================================

update public.user_profiles
set locale = 'pl', current_consent_version = '2026-05-01'
where id = '11111111-1111-1111-1111-111111111111';

update public.user_profiles
set locale = 'en', current_consent_version = '2026-05-01'
where id = '22222222-2222-2222-2222-222222222222';

update public.user_profiles
set locale = 'pl', current_consent_version = null
where id = '33333333-3333-3333-3333-333333333333';

update public.user_profiles
set locale = 'pl', current_consent_version = '2026-05-01'
where id = '44444444-4444-4444-4444-444444444444';
