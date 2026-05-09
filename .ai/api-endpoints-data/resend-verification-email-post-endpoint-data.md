# Endpoint
POST /auth/v1/resend

## Description
Ponowne wysłanie maila weryfikacyjnego po rejestracji (US-001 follow-up, m5). Wywołanie przez Supabase Auth SDK (`supabase.auth.resend(...)`) z klienta lub Server Component.

## Authentication / Authorization
- Brak (publiczny endpoint Supabase Auth).
- Klient: `@supabase/supabase-js` lub `@supabase/ssr`.

## Request

### SDK call
```typescript
const { error } = await supabase.auth.resend({
  type: 'signup',
  email: 'user@example.com'
})
```

### Body Schema
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `type` | `'signup' \| 'email_change' \| 'recovery'` | tak | `'signup'` dla US-001 |
| `email` | `string` | tak | Email do którego ma trafić maila |

## Response

### Sukces
```json
{ "data": null, "error": null }
```

## Error Codes
- `For security purposes, you can only request this once every 60 seconds` — rate limit Supabase Auth (po stronie klienta nie pokazujemy szczegółów; UI countdown 60s).
- `Email rate limit exceeded` (jeśli przekroczy `email_sent = 4 / godzinę / IP`).
- Generic AuthError → `mapAuthError` → `BusinessError.UNKNOWN`.

## Database Tables Involved
- `auth.users` (read-only przez GoTrue — tylko sprawdza istnienie usera).

## Business Logic

### 1. SDK wysyła request do `/auth/v1/resend`
GoTrue wysyła nowy email weryfikacyjny przez skonfigurowany SMTP.

### 2. UI flow
- User klika „Nie dostałem maila — wyślij ponownie".
- Klient wywołuje `resend({ type: 'signup', email })`.
- UI pokazuje countdown 60s na przycisku „Wyślij ponownie".
- Po przekroczeniu limitu Supabase: komunikat „Spróbuj ponownie za godzinę".

## Validation Rules
- `email`: format email.
- `type`: enum `'signup' | 'email_change' | 'recovery'`.

## Rate Limiting
- Supabase Auth `email_sent = 4 / godzinę / IP` (konfiguracja w `supabase/config.toml`).
- Wbudowany 60s cooldown w GoTrue.

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase Auth SDK — brak custom Route Handlera.
- UI: countdown 60s, komunikat o limicie.
- Wymaga skonfigurowanego custom SMTP w produkcji (Resend / Postmark).
