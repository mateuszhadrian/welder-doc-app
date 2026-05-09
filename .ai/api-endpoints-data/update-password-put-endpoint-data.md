# Endpoint
PUT /auth/v1/user

## Description
Aktualizacja hasła użytkownika (US-004 — po reset password flow). Wywołanie przez Supabase Auth SDK (`supabase.auth.updateUser(...)`). Wymaga aktywnej sesji (z PKCE callback po recovery, lub obecnej sesji do change password).

## Authentication / Authorization
- Aktywna sesja Supabase.
- Klient: `@supabase/ssr` lub `@supabase/supabase-js`.

## Request

### SDK call
```typescript
const { error } = await supabase.auth.updateUser({
  password: 'NoweHaslo456'
})
```

### Body Schema
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `password` | `string` | tak | Nowe hasło (min. 8 znaków) |
| `email` | `string` | nie | (Opcjonalnie) zmiana emaila — wymaga `enable_confirmations = true` |
| `data` | `object` | nie | Custom user metadata |

## Response

### Sukces
```json
{
  "user": {
    "id": "uuid-...",
    "email": "user@example.com",
    "updated_at": "2026-05-08T12:00:00Z"
  }
}
```

## Error Codes
| Błąd | Mapowanie |
|---|---|
| `Password should be at least 6 characters` (lub min `auth.password.min_length`) | `BusinessError.PASSWORD_TOO_WEAK` → `errors.password_too_weak` |
| `Auth session missing` | 401 unauthorized |

## Database Tables Involved
- `auth.users` — UPDATE przez GoTrue (kolumny: `encrypted_password`, `updated_at`).

## Business Logic

### 1. Verify session
- SDK używa aktualnych cookies sesji (`@supabase/ssr`).

### 2. SDK wywołuje `updateUser`
- GoTrue weryfikuje min. siłę hasła.
- Aktualizuje `auth.users.encrypted_password`.
- Invaliduje refresh token (z bezpieczeństwa) — następne `auth.getUser()` może wymagać re-login.

### 3. UI flow (reset password)
- User trafia z linka `recovery` → callback wymienia `code` na sesję.
- User wpisuje nowe hasło w formularzu → `updateUser({ password })`.
- Po sukcesie: redirect na `/login` lub `/dashboard`.

## Validation Rules
- `password`: min. 8 znaków (PRD US-001), egzekwowane przez GoTrue (`supabase/config.toml [auth.password] min_length`).
- Klient powinien preflight'ować długość ≥ 8 i pokazać miernik siły hasła.

## Rate Limiting
- Supabase Auth — brak osobnego limitu na `updateUser`. Pokrywa `token_refresh = 150 / 5 min / IP` po stronie sesji.

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase Auth SDK — brak custom Route Handlera.
- Po reset password flow: po `updateUser` SDK automatycznie wymienia tokeny — nie trzeba ręcznie wylogowywać.
- Error mapping: `mapAuthError` z `src/lib/supabase/errors.ts` (TODO).
- Klient powinien wymagać podwójnego wpisania hasła w UI.
