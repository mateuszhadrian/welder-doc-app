# Endpoint
POST /auth/v1/logout

## Description
Wylogowanie użytkownika (US-003). Wywołanie przez Supabase Auth SDK (`supabase.auth.signOut(...)`). Czyści cookies sesji.

## Authentication / Authorization
- Aktywna sesja Supabase.
- Klient: `@supabase/ssr` lub `@supabase/supabase-js`.

## Request

### SDK call
```typescript
const { error } = await supabase.auth.signOut()
```

### Body Schema
- Brak.

## Response

### Sukces
```json
{ "error": null }
```
- Cookies sesji są czyszczone (`sb-access-token=; Max-Age=0`, `sb-refresh-token=; Max-Age=0`).

## Error Codes
- `AuthSessionMissingError` — brak aktywnej sesji (idempotentne — return success bez efektu).

## Database Tables Involved
- `auth.users` (Supabase Auth — invalidation refresh tokenu po stronie GoTrue).

## Business Logic

### 1. SDK wysyła request do `/auth/v1/logout`
GoTrue invaliduje refresh token i usuwa sesję.

### 2. Klient czyści cookies
`@supabase/ssr` automatycznie czyści `sb-access-token`, `sb-refresh-token`.

### 3. UI flow
- Klient wykonuje `router.push('/[locale]')` (przekierowanie na publiczny widok lub `/login`).
- Czyszczenie store'a Zustand (jeśli zawiera dane usera).
- localStorage:
  - `welderdoc_autosave` — zachowane (gość/anonim może kontynuować).
  - `welderdoc_migrated_at` — zachowane (idempotency marker).

## Validation Rules
- Brak.

## Rate Limiting
- Brak (operacja idempotentna, niskie ryzyko abuse).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase Auth SDK — brak custom Route Handlera.
- Idempotentne — `signOut()` na nieaktywnej sesji nie zwraca błędu.
- W `DELETE /api/user/account` flow handler **też** wywołuje `supabase.auth.signOut()` po hard delete (cleanup cookies).
