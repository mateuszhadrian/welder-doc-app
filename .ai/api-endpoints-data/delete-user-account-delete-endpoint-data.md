# Endpoint
DELETE /api/user/account

## Description
Trwale usuwa konto użytkownika (RODO art. 17 — „prawo do bycia zapomnianym"). Wymaga re-autoryzacji hasłem (operacja destrukcyjna, OWASP best practice). Custom Route Handler — plik `src/app/api/user/account/route.ts`. **Status: TODO — niezaimplementowane** (CLAUDE.md).

## Authentication / Authorization
1. **Aktywna sesja Supabase** (`authenticated`) — weryfikowana przez `@supabase/ssr` (`createServerClient`).
2. **Re-auth:** ponowne podanie hasła w body żądania, weryfikowane przez `signInWithPassword()` na osobnym kliencie (nie nadpisujemy aktywnej sesji).
3. **Hard delete:** `createAdminClient(SUPABASE_SERVICE_ROLE_KEY).auth.admin.deleteUser(user.id)`.
4. **Krytyczne:** wywołać `auth.getUser()` jako pierwsze działanie po stworzeniu klienta sesyjnego.

## Request Headers
```
Content-Type: application/json
```

## Request Body Schema
```json
{
  "password": "AktualneHaslo123",
  "confirmation": "DELETE"
}
```

| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `password` | `string` | tak | Aktualne hasło — weryfikowane przez `signInWithPassword()` |
| `confirmation` | `"DELETE"` | tak | Literał `"DELETE"` (UI wymusza wpisanie) |

## Response

### 200 OK
```json
{
  "deleted": true,
  "user_id": "uuid-...",
  "deleted_at": "2026-05-08T12:00:00Z"
}
```

> Po sukcesie handler usuwa cookies sesji przez `supabase.auth.signOut()` (`Set-Cookie: sb-access-token=; Max-Age=0`). Klient powinien wykonać `router.push('/[locale]/account-deleted')`.

## Error Codes
| Kod | Body | Powód |
|---|---|---|
| 400 | `{ "error": "missing_fields" }` | Brak `password` lub `confirmation` |
| 400 | `{ "error": "invalid_confirmation" }` | `confirmation !== "DELETE"` |
| 400 | `{ "error": "invalid_payload" }` | Malformed JSON |
| 401 | `{ "error": "unauthorized" }` | Brak sesji |
| 401 | `{ "error": "invalid_password" }` | `signInWithPassword()` zwrócił `Invalid login credentials` |
| 429 | `{ "error": "rate_limited" }` | Przekroczony limit |
| 500 | `{ "error": "internal_error" }` |

## Database Tables Involved (kaskada przy delete)

### `auth.users`
- Hard delete przez `auth.admin.deleteUser(user.id)`.

### `public.user_profiles`
- `ON DELETE CASCADE` — usuwane razem z userem.

### `public.documents`
- `ON DELETE CASCADE` — usuwane (RODO art. 17).

### `public.consent_log`
- `ON DELETE CASCADE` — usuwane.

### `public.subscriptions`
- `user_id ON DELETE SET NULL` — zachowane dla audytu billingu Paddle. `paddle_customer_snapshot` zachowuje copy customer ID.

### `public.webhook_events`
- Bez relacji do `auth.users`. Zachowuje payload Paddle do retencji 90 dni (cron `cleanup-webhook-events`).

## Business Logic

### 1. Verify session
```typescript
const cookieStore = await cookies()
const supabase = createServerClient(...) // session client
const { data: { user } } = await supabase.auth.getUser()
if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
```

### 2. Validate payload
```typescript
const { password, confirmation } = await request.json()
if (!password || !confirmation) return Response.json({ error: 'missing_fields' }, { status: 400 })
if (confirmation !== 'DELETE') return Response.json({ error: 'invalid_confirmation' }, { status: 400 })
```

### 3. Re-auth na osobnym kliencie
```typescript
import { createClient } from '@supabase/supabase-js'

// Tymczasowy klient (anon key, BEZ cookies tej sesji)
const tempClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const { error: signInErr } = await tempClient.auth.signInWithPassword({
  email: user.email!,
  password
})
if (signInErr) return Response.json({ error: 'invalid_password' }, { status: 401 })
```

> **Powód osobnego klienta:** `signInWithPassword()` na server clientie (z cookies) **nadpisałby** aktywną sesję — gdyby user anulował delete później, byłby wylogowany. Tymczasowy klient bez cookies izoluje weryfikację.

### 4. Hard delete przez admin client
```typescript
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const { error } = await adminClient.auth.admin.deleteUser(user.id)
if (error) return Response.json({ error: 'internal_error' }, { status: 500 })
```

### 5. Sign out (cleanup cookies)
```typescript
await supabase.auth.signOut()
```

### 6. Zwróć 200 z timestamp
```typescript
return Response.json({
  deleted: true,
  user_id: user.id,
  deleted_at: new Date().toISOString()
})
```

## Security & Compliance
- **Re-auth** chroni przed delete'm na porzuconej sesji (kawiarnia, cudzy laptop).
- **`confirmation: "DELETE"`** — defensywna warstwa UX.
- **Rate limit:** Supabase Auth `sign_in_sign_ups = 30 / 5 min / IP` ogranicza brute-force re-auth. TODO: 3/godzinę/IP, 1/dobę/user.
- **Operacja nieodwracalna** — żadnego soft-delete'u w MVP. Audit log w `webhook_events` (anonimizowany po `user_id = NULL`) jest jedyną pozostałą informacją.

## UX (klient)
- Dwuetapowa modal:
  1. Ostrzeżenie + lista skasowanych zasobów (projekty, ustawienia, historia zgód).
  2. Pola: `password` + `confirmation` ("Wpisz `DELETE` aby potwierdzić").
- Po sukcesie: redirect do `/[locale]/account-deleted` (publiczna strona, bez sesji).

## Validation Rules
- `password`: string non-empty.
- `confirmation`: literal `"DELETE"`.

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Implementation Notes
- Plik: `src/app/api/user/account/route.ts` — **TODO, niezaimplementowane** (CLAUDE.md "Route Handler NOT YET implemented").
- Wymagane przed produkcją (RODO art. 17).
- Eksport `DELETE` (nie `POST`).
- Można rozważyć dodanie `Idempotency-Key` (post-MVP).
