# Endpoint
GET /api/user/export

## Description
Eksport wszystkich danych użytkownika w formacie JSON (RODO art. 20 — prawo do przenoszenia danych). Custom Route Handler — plik `src/app/api/user/export/route.ts`.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- Klient: `createServerClient` z `@supabase/ssr` (cookie-based JWT).
- **Krytyczne:** wywołać `auth.getUser()` jako pierwsze działanie (refresh JWT cookies — proxy nie wchodzi na `/api/*`).

## Request
- **Parametry zapytania:** brak.
- **Body:** brak.

## Response

### 200 OK
```json
{
  "user_id": "uuid-...",
  "exported_at": "2026-05-08T12:00:00Z",
  "email": "user@example.com",
  "profile": {
    "plan": "pro",
    "locale": "pl",
    "current_consent_version": "1.0",
    "created_at": "2026-01-01T00:00:00Z"
  },
  "documents": [
    {
      "id": "uuid-...",
      "name": "Złącze T 1",
      "created_at": "2026-05-01T10:00:00Z",
      "updated_at": "2026-05-08T09:30:00Z",
      "data": {
        "schemaVersion": 1,
        "canvasWidth": 2970,
        "canvasHeight": 2100,
        "shapes": [],
        "weldUnits": []
      }
    }
  ],
  "consent_log": [
    {
      "consent_type": "terms_of_service",
      "version": "1.0",
      "accepted": true,
      "accepted_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

### Response Headers
```
Content-Type: application/json
Content-Disposition: attachment; filename="welderdoc-export-2026-05-08.json"
```

## Error Codes
| Kod | Body |
|---|---|
| 401 | `{ "error": "unauthorized" }` |
| 500 | `{ "error": "internal_error" }` |

## Database Tables Involved

### `public.user_profiles`
RLS SELECT po `id = auth.uid()`.
| Kolumna | Typ |
|---|---|
| `id`, `plan`, `locale`, `current_consent_version`, `created_at`, `updated_at` | UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ |

### `public.documents`
RLS ALL po `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`.
| Kolumna | Typ |
|---|---|
| `id` | `UUID` |
| `name` | `TEXT` |
| `data` | `JSONB` (≤ 5 MB raw) |
| `schema_version` | `INT` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` |

### `public.consent_log`
RLS SELECT po `user_id = auth.uid()`.
| Kolumna | Typ |
|---|---|
| `consent_type`, `version`, `accepted`, `accepted_at` | TEXT, TEXT, BOOLEAN, TIMESTAMPTZ |

### `auth.users` (Supabase Auth — odczyt przez `auth.getUser()`)
Pobierz `email` z usera (nie czytaj bezpośrednio `auth.users` przez PostgREST — niewystawione).

## Business Logic

### 1. Verify session
```typescript
const { data: { user } } = await supabase.auth.getUser()
if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
```

### 2. Pobierz dane (3 zapytania równolegle przez `Promise.all`)
```typescript
const [profile, documents, consentLog] = await Promise.all([
  supabase.from('user_profiles')
    .select('plan, locale, current_consent_version, created_at')
    .eq('id', user.id).single(),
  supabase.from('documents')
    .select('id, name, created_at, updated_at, data')
    .eq('owner_id', user.id),
  supabase.from('consent_log')
    .select('consent_type, version, accepted, accepted_at')
    .eq('user_id', user.id)
    .order('accepted_at', { ascending: false })
])
```

### 3. Zbuduj odpowiedź
- `user_id`: `user.id`
- `exported_at`: `new Date().toISOString()`
- `email`: `user.email`
- `profile`, `documents`, `consent_log` z zapytań.

### 4. Set Content-Disposition header
- `attachment; filename="welderdoc-export-${YYYY-MM-DD}.json"`.

## Performance Characteristics (m8)
- **Soft-target:** < 30 s (Free → 1 projekt; Pro → ~5-50 projektów).
- **Hard limit:** 300 s (Vercel Function timeout default).
- **Power user (>100 projektów)** — ryzyko throttle/timeout. Plan post-MVP: streaming (NDJSON) lub asynchroniczne generowanie do Vercel Blob z linkiem mailowym.
- **Rate limit (TODO):** 1 request/min/user, 5 requestów/dzień/user.

## Validation Rules
- Brak walidacji wejścia (endpoint read-only bez parametrów).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Plik: `src/app/api/user/export/route.ts` (już zaimplementowany).
- Self-describing JSON realizuje portability art. 20 — `data->>'schemaVersion'` w każdym dokumencie umożliwia odczyt bez żywego API.
- W MVP: zwróć cały JSON w body. Post-MVP rozważyć stream / async.
- RLS naturalnie izoluje dane — niemożliwe wyciągnięcie cudzego eksportu.
