# Endpoint
GET /api/cron/cleanup-webhook-events

## Description
Usuwa rekordy `webhook_events` starsze niż 90 dni. Wywoływany przez Vercel Cron raz w tygodniu (niedziela 02:00 UTC). Custom Route Handler — plik `src/app/api/cron/cleanup-webhook-events/route.ts`.

## Authentication / Authorization
- Nagłówek `Authorization: Bearer ${CRON_SECRET}`.
- **Metoda HTTP: `GET`** — Vercel Cron domyślnie wysyła `GET`.
- Klient DB: `createAdminClient(SUPABASE_SERVICE_ROLE_KEY)` (omija RLS — `webhook_events` jest dostępna tylko dla `service_role`).

## Vercel Configuration
```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup-webhook-events",
      "schedule": "0 2 * * 0"
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
  "deleted": 150,
  "timestamp": "2026-05-08T02:00:00Z"
}
```

## Error Codes
| Kod | Body | Powód |
|---|---|---|
| 401 | `{ "error": "unauthorized" }` | Brak/nieprawidłowy `CRON_SECRET` |
| 500 | `{ "error": "internal_error" }` | Błąd DB |

## Database Tables Involved

### `public.webhook_events`
RLS bez polityk → tylko `service_role`.

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` |
| `provider` | `TEXT` | `NOT NULL` |
| `external_event_id` | `TEXT` | `NOT NULL` |
| `event_type` | `TEXT` | `NOT NULL` |
| `payload` | `JSONB` | `NOT NULL` |
| `received_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` |
| `processed_at` | `TIMESTAMPTZ` | nullable |

**Indeks:** `webhook_events_received_at_idx (received_at)` — wspiera DELETE po dacie.

## Business Logic

### 1. Verify CRON_SECRET
```typescript
const authHeader = request.headers.get('authorization')
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}
```

### 2. DELETE old events
```sql
DELETE FROM public.webhook_events
WHERE received_at < now() - INTERVAL '90 days'
```
Wykonywane przez klienta `service_role`.

### 3. Zwróć liczbę usuniętych
```typescript
const { count, error } = await supabaseAdmin
  .from('webhook_events')
  .delete({ count: 'exact' })
  .lt('received_at', new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString())
return Response.json({ deleted: count, timestamp: new Date().toISOString() })
```

## Validation Rules
- `CRON_SECRET` — string (sekret z Vercel env).

## Environment Variables
- `CRON_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Implementation Notes
- Plik: `src/app/api/cron/cleanup-webhook-events/route.ts` (już zaimplementowany).
- **Eksport `GET`, nie `POST`** — Vercel Cron sends GET.
- Retencja 90 dni (db-plan §1.6).
- `pnpm verify:routes` walidator sprawdza obecność handlera dla każdego `vercel.json crons[].path`.
- Idempotentny — kolejne wywołania nic nie zrobią po pierwszym.
- Vercel region pinned to `fra1` (GDPR — colokacja z EU-Frankfurt Supabase).
