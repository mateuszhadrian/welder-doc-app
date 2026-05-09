# Endpoint
POST /auth/v1/signup

## Description
Rejestracja nowego użytkownika (US-001). Wywołanie przez Supabase Auth SDK (`supabase.auth.signUp(...)`) z klienta lub Server Component. Tworzy wiersz w `auth.users` oraz — przez trigger `on_auth_user_created` — w `public.user_profiles`. Email confirmation jest **wymagany w produkcji** (`enable_confirmations = true` w Supabase Cloud Auth Settings).

## Authentication / Authorization
- Brak (publiczny endpoint Supabase Auth).
- Klient: `@supabase/supabase-js` `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)` lub `@supabase/ssr` `createBrowserClient`.

## Request

### SDK call
```typescript
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'MinimalneHaslo123'
})
```

### Body Schema
| Pole | Typ | Wymagane | Reguła |
|---|---|---|---|
| `email` | `string` | tak | Format email |
| `password` | `string` | tak | Min. 8 znaków (PRD US-001), egzekwowane server-side przez GoTrue (`supabase/config.toml [auth.password] min_length = 8`) |

## Response

### Sukces (po `signUp`):
```json
{
  "user": {
    "id": "uuid-...",
    "email": "user@example.com",
    "email_confirmed_at": null
  },
  "session": null
}
```
- `session: null` jeśli włączone potwierdzenie e-mail (domyślne w Supabase Cloud); sesja powstaje po kliknięciu linku weryfikacyjnego.

## Error Codes
- `Invalid login credentials` (AuthError)
- `User already registered` → mapowane przez `mapAuthError` na `BusinessError.EMAIL_ALREADY_REGISTERED` → i18n `errors.email_already_registered`.
- `Password should be at least 6 characters` (lub skonfigurowanego minimum) → `BusinessError.PASSWORD_TOO_WEAK` → `errors.password_too_weak`.

## Database Tables Involved

### `auth.users` (Supabase Auth)
- Tworzony rekord przez GoTrue.
- `email_confirmed_at`:
  - Dev (`supabase/config.toml enable_confirmations = false`) → auto-set na `now()`.
  - Prod (Supabase Cloud, `enable_confirmations = true`) → `NULL` do momentu kliknięcia linku.

### `public.user_profiles` (Postgres trigger)
Tworzony automatycznie triggerem `on_auth_user_created` (funkcja `handle_new_user()` — `SECURITY DEFINER`).

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `plan` | `TEXT` | `NOT NULL`, `DEFAULT 'free'`, `CHECK (plan IN ('free','pro'))` |
| `paddle_customer_id` | `TEXT` | `UNIQUE`, nullable |
| `current_consent_version` | `TEXT` | nullable |
| `locale` | `TEXT` | `NOT NULL`, `DEFAULT 'pl'`, `CHECK (locale IN ('pl','en'))` |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` |

## Business Logic

### 1. Krok 1: `signUp()` (SDK)
- Tworzy `auth.users` + trigger tworzy `user_profiles` z domyślnymi wartościami (`plan='free'`, `locale='pl'`).
- W produkcji: wysyłany email weryfikacyjny (custom SMTP wymagany — Resend/Postmark).

### 2. Krok 2: `POST /api/consent` (bundle)
- **Atomowo** zapisuje TOS + PP + cookies do `consent_log` i ustawia `user_profiles.current_consent_version` przez RPC `record_consent_bundle()` (`SECURITY DEFINER`).
- Klient **nie aktualizuje** `current_consent_version` bezpośrednio — chronione triggerem `block_protected_columns_update`.

### 3. Krok 3: Email confirmation
- User klika link → `email_confirmed_at` ustawiane → sesja może być utworzona.
- Polityka RLS na `documents` wymaga `email_confirmed_at IS NOT NULL` (defense-in-depth przed nadużyciem rejestracji).

### 4. Resend confirmation email (US-001 follow-up)
- Osobny endpoint: `supabase.auth.resend({ type: 'signup', email })` — patrz `resend-verification-email-post-endpoint-data.md`.

## Validation Rules
- `email`: format email (RFC 5322).
- `password`: min. 8 znaków (`auth.password.min_length` w `supabase/config.toml`).
- Auto-tworzenie `user_profiles` z `plan='free'`, `locale='pl'` (defaultny PL — bez prefiksu URL).

## Rate Limiting
- Supabase Auth `email_sent = 4 / godzinę / IP` (potwierdzenia).
- Supabase Auth `sign_in_sign_ups = 30 / 5 min / IP`.
- Bot/abuse defense: TODO Vercel BotID przed publicznym launchem.

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- (Prod) Custom SMTP w Supabase Cloud (Resend / Postmark).

## Implementation Notes
- Klient SDK: `@supabase/supabase-js` lub `@supabase/ssr`.
- Po sukcesie: zapisz `welderdoc_locale_preference` w localStorage (architecture-base.md §17) jako fallback przed sign-in.
- Migracja gościa do chmury (US-007): po pierwszym sign-in odczytaj `welderdoc_autosave` z localStorage i wykonaj `INSERT INTO documents`.
- **Production deploy guardrail:** Supabase Cloud → Auth → Settings → `Enable email confirmations = ON`, `Confirm email change = ON`, custom SMTP skonfigurowany.
- Error mapping: użyj `mapAuthError` z `src/lib/supabase/errors.ts` (TODO, plik nie zaimplementowany).
