# Endpoint
POST /api/paddle/webhook

## Description
Obsługuje zdarzenia Paddle Billing (cykl życia subskrypcji, eventy klienta). Implementuje weryfikację podpisu HMAC, idempotencję przez `webhook_events.UNIQUE(provider, external_event_id)` oraz aktualizację `subscriptions` / `user_profiles.paddle_customer_id`. Custom Route Handler — plik `src/app/api/paddle/webhook/route.ts`.

## Authentication / Authorization
- **Brak sesji użytkownika** — webhook wywoływany przez Paddle.
- Weryfikacja podpisu HMAC-SHA256 z nagłówka `paddle-signature` z użyciem sekretu `PADDLE_WEBHOOK_SECRET`.
- Klient DB: `createAdminClient()` z `SUPABASE_SERVICE_ROLE_KEY` (omija RLS — `webhook_events` nie ma żadnych polityk; tylko `service_role` może operować).

## Request Headers
```
paddle-signature: ts=1746703200;h1=abc123...
Content-Type: application/json
```

## Request Body Schema
Surowy payload Paddle. Wymagane top-level pola:
- `event_type` (string) — np. `subscription.activated`, `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.paused`, `subscription.past_due`, `customer.created`, `customer.updated`
- `event_id` (string) — globalnie unikalny ID zdarzenia (Paddle gwarantuje unikalność)
- `occurred_at` (ISO timestamp)
- `data` (object) — payload zależny od `event_type`

### Przykładowy ładunek (subscription.activated)
```json
{
  "event_type": "subscription.activated",
  "event_id": "evt_01abc123",
  "occurred_at": "2026-05-08T12:00:00Z",
  "data": {
    "id": "sub_01abc123",
    "customer": {
      "id": "ctm_01abc123",
      "email": "user@example.com"
    },
    "status": "active",
    "items": [
      { "price": { "id": "pri_monthly_49pln" } }
    ],
    "current_billing_period": {
      "starts_at": "2026-05-08T12:00:00Z",
      "ends_at": "2026-06-08T12:00:00Z"
    },
    "customData": { "user_id": "uuid-..." }
  }
}
```

### Przykład payloadu customer.*
- `customer.created` / `customer.updated`: `data` ma top-level `email`, `id` (`ctm_...`).

## Response

### 200 OK (przetworzone)
```json
{ "received": true }
```

### 200 OK (duplikat — idempotencja)
```json
{ "received": true, "duplicate": true }
```

## Error Codes
| Kod | Body | Powód |
|---|---|---|
| 400 | `{ "error": "missing_signature" }` | Brak nagłówka `paddle-signature` |
| 400 | `{ "error": "invalid_signature" }` | Nieprawidłowy podpis HMAC |
| 400 | `{ "error": "invalid_payload", "message": "..." }` | Malformed JSON lub brak `event_id` / `event_type` / `data` |
| 500 | `{ "error": "internal_error", "message": "..." }` | Błąd DB |

## Database Tables Involved

### `public.webhook_events`
Audyt techniczny i mechanizm idempotencji. RLS bez polityk → tylko `service_role`.

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` |
| `provider` | `TEXT` | `NOT NULL` (`'paddle'`) |
| `external_event_id` | `TEXT` | `NOT NULL` |
| `event_type` | `TEXT` | `NOT NULL` |
| `payload` | `JSONB` | `NOT NULL` |
| `received_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` |
| `processed_at` | `TIMESTAMPTZ` | nullable |

**`UNIQUE (provider, external_event_id)`** → idempotencja.

### `public.subscriptions`
Aktualny stan subskrypcji Paddle (1 wiersz per `paddle_subscription_id`).

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` |
| `user_id` | `UUID` | `REFERENCES auth.users(id) ON DELETE SET NULL`, nullable |
| `paddle_subscription_id` | `TEXT` | `NOT NULL`, `UNIQUE` |
| `paddle_customer_snapshot` | `TEXT` | `NOT NULL` |
| `status` | `TEXT` | `CHECK (status IN ('trialing','active','past_due','paused','canceled'))` |
| `plan_tier` | `TEXT` | `CHECK (plan_tier IN ('pro_monthly','pro_annual'))` |
| `current_period_start` | `TIMESTAMPTZ` | nullable |
| `current_period_end` | `TIMESTAMPTZ` | nullable |
| `cancel_at` | `TIMESTAMPTZ` | nullable |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` |

### `public.user_profiles`
| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | `UUID` | PK = `auth.users(id)` |
| `plan` | `TEXT` | `CHECK (plan IN ('free','pro'))` — chronione triggerem `block_protected_columns_update` (bypass dla `service_role`) |
| `paddle_customer_id` | `TEXT` | `UNIQUE`, chronione, write z webhook handler |

## Business Logic

### 1. Verify HMAC signature
- Parse `paddle-signature` (`ts=...;h1=...`).
- Compute HMAC-SHA256 z `${ts}:${rawBody}` używając `PADDLE_WEBHOOK_SECRET`.
- Compare timing-safe z `h1`. Mismatch → 400 `invalid_signature`.

### 2. Idempotency check (must come BEFORE business dispatch — "dispatch-before-marker")
```sql
INSERT INTO webhook_events (provider, external_event_id, event_type, payload)
VALUES ('paddle', $event_id, $event_type, $payload)
ON CONFLICT (provider, external_event_id) DO NOTHING
RETURNING id;
```
Pusty `RETURNING` → duplikat → return 200 `{ received: true, duplicate: true }`.

### 3. Dispatch business logic by `event_type`
- `subscription.*` → upsert do `subscriptions` po `paddle_subscription_id`. Trigger `subscriptions_after_iu_refresh_plan` automatycznie przelicza `user_profiles.plan` przez `refresh_user_plan_from_subscriptions(user_id)` (recovery dla `OLD.user_id` i `NEW.user_id` przy zmianie ownera). Trigger `subscriptions_after_iu_sync_customer` synchronizuje `paddle_customer_snapshot` → `user_profiles.paddle_customer_id` jeśli ten ostatni jest NULL.
- `customer.*` → UPDATE `user_profiles.paddle_customer_id` (App-side bypass: `service_role`).

### 4. Lookup użytkownika (kolejność priorytetów)
1. `payload.data.customData.user_id` (zalecane — Paddle Checkout przekazuje `customData: { user_id }`).
2. `user_profiles WHERE paddle_customer_id = payload.data.customer.id`.
3. RPC `public.lookup_user_id_by_email(p_email)` (`SECURITY DEFINER`, `service_role only`) z emailem z `data.customer?.email ?? data.email`. RPC opakowuje pojedynczy SELECT po `lower(email)` w `auth.users` (która **nie jest** wystawiona przez PostgREST — `from('users', { schema: 'auth' })` zwraca `relation does not exist`).
4. Jeśli user nie znaleziony → zapisz `webhook_event`, zaloguj warning, zwróć 200. Recovery przez manualny `UPDATE subscriptions SET user_id = ...` po rejestracji; trigger refresh planu odświeży `user_profiles.plan` automatycznie.

### 5. Recovery flow (out-of-order webhooks)
Paddle nie gwarantuje kolejności `customer.created` vs `subscription.created`:
- `customer.created` jako pierwszy: lookup po emailu. Sukces → UPDATE `paddle_customer_id`. Brak → orphan log.
- `subscription.created` jako pierwszy: trigger `sync_paddle_customer` wpisuje `paddle_customer_id` do `user_profiles` z `paddle_customer_snapshot`.

### 6. Mark processed
Po sukcesie: `UPDATE webhook_events SET processed_at = now() WHERE id = $insertedId`.

## Validation Rules

- `event_type` musi być stringiem; obsługiwane wartości wymienione wyżej. Nieobsługiwany typ → log + 200 (Paddle traktuje 5xx jako retry).
- `subscriptions.status` enum check: `('trialing','active','past_due','paused','canceled')`.
- `subscriptions.plan_tier` enum check: `('pro_monthly','pro_annual')`.

## Environment Variables
- `PADDLE_WEBHOOK_SECRET` — sekret do HMAC.
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — admin client.

## Implementation Notes
- Plik: `src/app/api/paddle/webhook/route.ts` (już zaimplementowany — patrz CLAUDE.md "Route Handlers implemented").
- **Nie używać `auth.getUser()`** — webhook nie ma sesji użytkownika.
- Vercel Cron i webhook powinny używać klienta `createAdminClient(SUPABASE_SERVICE_ROLE_KEY)` aby ominąć RLS.
- HMAC verify musi być **przed** parsowaniem ciała JSON (defensa przed payload poisoning).
- Loggować orphan webhooks (warning) — krytyczne dla debugowania US-045.
- PR checklist: każde wywołanie `Paddle.Checkout.open({...})` musi zawierać `customData: { user_id }` — bez tego pierwszy `subscription.created` może wpaść w fallback email lookup.
- Migracja: `20260509000000_paddle_webhook_hardening.sql` (lookup_user_id_by_email RPC + bypass `current_user='postgres'` w `block_protected_columns_update`).
