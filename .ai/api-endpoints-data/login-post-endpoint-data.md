# Endpoint
POST /auth/v1/token?grant_type=password

## Description
Logowanie użytkownika (US-002). Wywołanie przez Supabase Auth SDK (`supabase.auth.signInWithPassword(...)`). Tworzy aktywną sesję (cookies httpOnly zarządzane przez `@supabase/ssr`).

## Authentication / Authorization
- Brak (publiczny endpoint Supabase Auth).
- Klient: `@supabase/ssr` (cookies-based session) lub `@supabase/supabase-js`.

## Request

### SDK call
```typescript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'MinimalneHaslo123'
})
```

### Body Schema
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `email` | `string` | tak | Format email |
| `password` | `string` | tak | Hasło |

## Response

### Sukces
```json
{
  "user": {
    "id": "uuid-...",
    "email": "user@example.com",
    "email_confirmed_at": "2026-05-08T12:00:00Z"
  },
  "session": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1746716400
  }
}
```
- Cookies httpOnly ustawiane przez `@supabase/ssr`: `sb-access-token`, `sb-refresh-token`.
- Access token TTL: 1 godzina; refresh token TTL: 1 miesiąc.

## Error Codes
| Błąd | Mapowanie |
|---|---|
| `Invalid login credentials` | `BusinessError.INVALID_CREDENTIALS` → `errors.invalid_credentials` |
| `Email not confirmed` | `BusinessError.EMAIL_NOT_CONFIRMED` → `errors.email_not_confirmed` |
| Rate limit przekroczony | HTTP 429 |

## Database Tables Involved

### `auth.users`
- Read przez GoTrue (weryfikacja hasła).
- `email_confirmed_at` musi być `NOT NULL` w produkcji (polityka RLS na `documents`).

### `public.user_profiles`
- Read po sign-in (Server Component / `LocaleGuard`):
```typescript
const { data: profile } = await supabase
  .from('user_profiles')
  .select('locale, current_consent_version')
  .eq('id', user.id)
  .single()
```

## Business Logic

### 1. SDK wywołuje `signInWithPassword`
- GoTrue weryfikuje hasło, ustawia cookies sesji.

### 2. Po zalogowaniu — Server Component flow
- `[locale]/layout.tsx` (lub `LocaleGuard`) wykonuje:
  1. `auth.getUser()` — refresh JWT cookies.
  2. `supabase.from('user_profiles').select('locale, current_consent_version').eq('id', user.id).single()`.
  3. **Locale redirect:** porównaj `pathname` locale z `user.locale`. Jeśli różne → `redirect('/' + user.locale + restOfPath)`. Bez tego: użytkownik z preferencją EN, który zalogował się na `/pl/...`, pozostaje w PL UI.
  4. **Consent re-check:** jeśli `current_consent_version` jest `NULL` lub starsze niż aktualne TOS/PP version → redirect do `/[locale]/consent-required`.

### 3. Migracja gościa (US-007)
- Klient sprawdza `welderdoc_autosave` w localStorage.
- Jeśli istnieje:
  1. `INSERT INTO documents (owner_id, name, data)` ze sceną z localStorage.
  2. `localStorage.setItem('welderdoc_migrated_at', now())` przed czyszczeniem.
  3. `localStorage.removeItem('welderdoc_autosave')`.
  4. Toast: "Projekt zapisany w chmurze".
- Trigger `check_free_project_limit` zabezpiecza przed race condition (dwie zakładki).

## Validation Rules
- `email`: format email.
- `password`: non-empty string.

## Rate Limiting
- Supabase Auth `sign_in_sign_ups = 30 / 5 min / IP` (brute-force defense).
- Supabase Auth `token_refresh = 150 / 5 min / IP` (refresh token).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase Auth SDK — brak custom Route Handlera.
- Middleware `src/proxy.ts` chain: `updateSession()` → `next-intl` routing. Kolejność krytyczna — Supabase musi odświeżyć token przed routingiem locale.
- Cookies httpOnly zarządzane przez `@supabase/ssr` — bezpieczne (nie XSS-readable).
- Error mapping: `mapAuthError` z `src/lib/supabase/errors.ts` (TODO).
- Locale redirect i consent re-check są **wymagane** wg PR checklist auth implementation (CLAUDE.md).
