# Endpoint
POST /auth/v1/recover

## Description
Wysłanie linka resetującego hasło (US-004). Wywołanie przez Supabase Auth SDK (`supabase.auth.resetPasswordForEmail(...)`). GoTrue wysyła email z linkiem PKCE flow.

## Authentication / Authorization
- Brak (publiczny endpoint Supabase Auth).

## Request

### SDK call
```typescript
const { error } = await supabase.auth.resetPasswordForEmail('user@example.com', {
  redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/[locale]/auth/callback?next=/reset-password`
})
```

### Body Schema
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `email` | `string` | tak | Email użytkownika |
| `redirectTo` | `string` | tak | URL callback dla PKCE flow (`/[locale]/auth/callback?next=/reset-password`) |

## Response

### Sukces
```json
{ "data": {}, "error": null }
```
- Email wysyłany przez SMTP (Resend / Postmark w produkcji).

## Error Codes
- `Email rate limit exceeded` (HTTP 429) — przekroczony `email_sent = 4 / godzinę / IP`.
- Brak błędu jeśli email nie istnieje w bazie (anty-enumeration).

## Database Tables Involved
- `auth.users` (read-only przez GoTrue).

## Business Logic

### 1. SDK wysyła request do `/auth/v1/recover`
GoTrue:
- Sprawdza czy email istnieje (silent fail jeśli nie — anty-enumeration).
- Generuje PKCE token.
- Wysyła email z linkiem `${redirectTo}?code=...&type=recovery`.

### 2. UI flow (po kliknięciu linku)
- User trafia na `/[locale]/auth/callback?code=...&next=/reset-password`.
- Server Component wymienia `code` na sesję przez `supabase.auth.exchangeCodeForSession(code)`.
- Redirect na `/reset-password` (formularz nowego hasła).
- User wpisuje nowe hasło → `supabase.auth.updateUser({ password: 'NoweHaslo456' })` (patrz `update-password-put-endpoint-data.md`).

## Validation Rules
- `email`: format email.
- `redirectTo`: URL z prefiksem `NEXT_PUBLIC_APP_URL` (whitelisted w Supabase Auth Dashboard).

## Rate Limiting
- Supabase Auth `email_sent = 4 / godzinę / IP`.
- 60s cooldown w GoTrue (po przekroczeniu: kolejne wywołania zwracają błąd).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`
- (Prod) Custom SMTP.

## Implementation Notes
- Bezpośrednie wywołanie Supabase Auth SDK — brak custom Route Handlera.
- `redirectTo` musi być na whitelist'cie w Supabase Auth Settings → Redirect URLs.
- Callback flow: PKCE z `code` jako URL param.
- Anty-enumeration: API zawsze zwraca sukces (nie ujawnia, czy email istnieje).
- UI po wysłaniu: komunikat „Jeśli email istnieje, link został wysłany" (nie potwierdzaj istnienia konta).
