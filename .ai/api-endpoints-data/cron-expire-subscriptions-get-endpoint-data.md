# Endpoint
GET /api/cron/expire-subscriptions

## Description
Przelicza `user_profiles.plan` dla użytkowników z przeterminowanymi subskrypcjami. Wywoływany przez Vercel Cron codziennie o 03:00 UTC. Custom Route Handler — plik `src/app/api/cron/expire-subscriptions/route.ts`.

## Authentication / Authorization
- Nagłówek `Authorization: Bearer ${CRON_SECRET}`.
- **Metoda HTTP: `GET`** — Vercel Cron domyślnie wysyła `GET`. Użycie `POST` skutkuje 405.
- Klient DB: `createAdminClient(SUPABASE_SERVICE_ROLE_KEY)` (omija RLS).

## Vercel Configuration
```json
{
  "crons": [
    {
      "path": "/api/cron/expire-subscriptions",
      "schedule": "0 3 * * *"
    }
  ]
}
```

## Request
- **Headers:** `Authorization: Bearer {CRON_SECRET}`
- **Body:** brak.

## Response

### 200 OK
```json
{
  "updated": 5,
  "timestamp": "2026-05-08T03:00:00Z"
}
```

## Error Codes
| Kod | Body | Powód |
|---|---|---|
| 401 | `{ "error": "unauthorized" }` | Brak/nieprawidłowy `CRON_SECRET` |
| 500 | `{ "error": "internal_error" }` | Błąd DB |

## Database Tables Involved

### `public.subscriptions`
| Kolumna | Typ |
|---|---|
| `user_id`, `status`, `current_period_end` | UUID, TEXT, TIMESTAMPTZ |

### `public.user_profiles`
| Kolumna | Typ |
|---|---|
| `id`, `plan` | UUID, TEXT |

### Funkcja DB: `public.refresh_expired_plans()`
- `SECURITY DEFINER`, `SET search_path = ''`.
- Iteruje po userach z `status = 'canceled' AND current_period_end < now()` i ustawia `user_profiles.plan = 'free'` dla tych, których `effective_plan(uid)` zwraca `'free'`.
- Zwraca `INT` — liczbę zaktualizowanych rekordów.

## Business Logic

### 1. Verify CRON_SECRET
```typescript
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  // ...
}
```

### 2. Wywołaj DB function
```typescript
const { data: updated, error } = await supabaseAdmin.rpc('refresh_expired_plans')
if (error) return Response.json({ error: 'internal_error' }, { status: 500 })
return Response.json({ updated, timestamp: new Date().toISOString() })
```

### 3. Effective plan logic (referencja)
```sql
SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = uid
      AND (
        s.status IN ('trialing','active','past_due')
        OR (s.status = 'canceled' AND s.current_period_end > now())
      )
  ) THEN 'pro'
  ELSE 'free'
END;
```

## Validation Rules
- `CRON_SECRET` — string (sekret z Vercel env).

## Environment Variables
- `CRON_SECRET` — Vercel Cron auto-przekazuje.
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Implementation Notes
- Plik: `src/app/api/cron/expire-subscriptions/route.ts` (już zaimplementowany).
- **Eksport `GET`, nie `POST`** — Vercel Cron sends GET.
- `pnpm verify:routes` walidator sprawdza obecność handlera dla każdego `vercel.json crons[].path`.
- Idempotentny — można wywołać wielokrotnie bez efektów ubocznych (kolejne wywołania nic nie zaktualizują).
- Real-time aktualizacja planu odbywa się też przez trigger `subscriptions_after_iu_refresh_plan` po każdym webhook'u Paddle; ten cron jest "time-based" fallback.
