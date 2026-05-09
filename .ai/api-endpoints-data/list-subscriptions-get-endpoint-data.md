# Endpoint
GET /rest/v1/subscriptions?user_id=eq.{uid}

## Description
Pobranie historii / aktualnego stanu subskrypcji użytkownika (US-044). Wywołanie przez Supabase JS SDK z PostgREST. Wyłącznie odczyt — mutacje wyłącznie z `service_role` przez `POST /api/paddle/webhook`.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `subscriptions`: tylko SELECT (`user_id = auth.uid()`); brak polityk INSERT/UPDATE/DELETE.

## Request

### URL
```
GET /rest/v1/subscriptions
  ?user_id=eq.{uid}
  &select=id,status,plan_tier,current_period_start,current_period_end,cancel_at,created_at
  &order=created_at.desc
```

### SDK call
```typescript
const { data: subscriptions, error } = await supabase
  .from('subscriptions')
  .select('id, status, plan_tier, current_period_start, current_period_end, cancel_at, created_at')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
```

### Query Parameters
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `user_id=eq.{uid}` | string | nie* | Filtr (RLS i tak ogranicza) |
| `select` | string | nie | Lista kolumn |
| `order` | string | nie | `created_at.desc` (default) |

## Response

### 200 OK
```json
[
  {
    "id": "uuid-...",
    "status": "active",
    "plan_tier": "pro_monthly",
    "current_period_start": "2026-05-01T00:00:00Z",
    "current_period_end": "2026-06-01T00:00:00Z",
    "cancel_at": null,
    "created_at": "2026-05-01T00:00:00Z"
  }
]
```

## Error Codes
- 401 — brak sesji.
- 500 — błąd DB.

## Database Tables Involved

### `public.subscriptions`
Aktualny stan subskrypcji (1 wiersz per `paddle_subscription_id`); upsert po `paddle_subscription_id`. Audit log webhooków → `webhook_events.payload`.

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY` |
| `user_id` | `UUID` | `REFERENCES auth.users(id) ON DELETE SET NULL`, nullable |
| `paddle_subscription_id` | `TEXT` | `NOT NULL`, `UNIQUE` |
| `paddle_customer_snapshot` | `TEXT` | `NOT NULL` (audyt po SET NULL) |
| `status` | `TEXT` | `CHECK (status IN ('trialing','active','past_due','paused','canceled'))` |
| `plan_tier` | `TEXT` | `CHECK (plan_tier IN ('pro_monthly','pro_annual'))` |
| `current_period_start`, `current_period_end`, `cancel_at` | `TIMESTAMPTZ` | nullable |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` |

**Indeks:** `subscriptions_user_id_status_period_end_idx (user_id, status, current_period_end DESC)`.

### RLS Policy
```sql
CREATE POLICY subscriptions_select_authenticated ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```
Brak polityk INSERT/UPDATE/DELETE → mutacje tylko z `service_role`.

## Business Logic

### 1. Use cases
- **Strona ustawień (US-044)**: pokaż aktualny plan, daty rozliczeniowe, status, „Zarządzaj subskrypcją" CTA.
- **Po Paddle Checkout (US-045)**: poll subscriptions po `effective_plan()` RPC, by potwierdzić aktualizację.

### 2. Customer Portal CTA (anulowanie / zmiana metody płatności)
- Dostępny gdy `subscriptions[0].status IN ('active','trialing','past_due')`.
- Wymaga `user_profiles.paddle_customer_id` wypełnionego.
- Implementacja: `paddle.CustomerPortal.open({ customerId })` (SDK inline, bez Route Handlera).

### 3. Anulowanie
- Odbywa się w UI Paddle (Customer Portal).
- Po kliknięciu Cancel Paddle wysyła `subscription.canceled` webhook → `subscriptions.status = 'canceled'` + `cancel_at`.
- Trigger `subscriptions_after_iu_refresh_plan` + cron `expire-subscriptions` zarządzają downgrade'm `user_profiles.plan = 'free'` po `current_period_end`.

## Validation Rules
- Brak walidacji wejścia (read-only).

## Rate Limiting
- Brak.

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- Brak `user_id` w wynikach po RODO-delete (`SET NULL`) — `paddle_customer_snapshot` zachowuje audyt billingu.
- `effective_plan()` RPC może wskazywać Pro nawet po `cancel` (grace period do `current_period_end`).
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
