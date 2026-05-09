# Endpoint
POST /rest/v1/rpc/effective_plan

## Description
RPC do obliczenia efektywnego planu użytkownika na podstawie aktualnego stanu subskrypcji. Używana **wyłącznie** po powrocie ze strony płatności Paddle (gdy webhook mógł jeszcze nie dotrzeć) lub przy podejrzeniu desynchronizacji. W standardowym flow odczytuj `user_profiles.plan` (cache).

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- Funkcja DB: `public.effective_plan(uid UUID)` — `SECURITY DEFINER`, `SET search_path = ''`.
- Może być wywoływana przez `authenticated` (sprawdza `subscriptions.user_id = uid`).

## Request

### SDK call
```typescript
const { data: effectivePlan } = await supabase
  .rpc('effective_plan', { uid: userId })
// Zwraca: 'free' | 'pro'
```

### Body Schema
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `uid` | `UUID` | tak | UUID usera |

## Response

### 200 OK
```json
"pro"
```
lub
```json
"free"
```

## Error Codes
| Kod | Powód |
|---|---|
| 401 | brak sesji |
| 500 | błąd DB |

## Database Tables Involved

### `public.subscriptions` (read by function)
| Kolumna | Typ | Uwagi |
|---|---|---|
| `user_id` | `UUID` | filtr |
| `status` | `TEXT` | `IN ('trialing','active','past_due','canceled')` |
| `current_period_end` | `TIMESTAMPTZ` | dla `canceled` — sprawdzana grace period |

**Indeks:** `subscriptions_user_id_status_period_end_idx (user_id, status, current_period_end DESC)` — wspiera lookup.

### Funkcja `public.effective_plan(uid UUID) RETURNS TEXT`
```sql
CREATE OR REPLACE FUNCTION public.effective_plan(uid UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;
```

## Business Logic

### 1. Kiedy wywołać
- **Po powrocie z Paddle Checkout** (US-045): user może być na ekranie sukcesu zanim webhook dotrze do `/api/paddle/webhook` i trigger zaktualizuje `user_profiles.plan`. Wywołaj RPC by pokazać aktualny plan w UI.
- **Podejrzenie desynchronizacji**: gdy UI pokazuje plan inny niż na fakturze.

### 2. Kiedy NIE wywołać (standardowo)
- Bootstrap aplikacji, nawigacja, render komponentów: czytaj `user_profiles.plan`.
- Triggery DB (`subscriptions_after_iu_refresh_plan` + cron `refresh_expired_plans`) gwarantują, że cache jest spójny.

### 3. Logika funkcji
- Pro = istnieje subskrypcja w stanie `trialing`/`active`/`past_due` LUB `canceled` z `current_period_end > now()` (grace period).
- Free = brak takich subskrypcji.

## Validation Rules
- `uid`: UUID format. Funkcja wewnętrznie sprawdza `s.user_id = uid` — brak izolacji RLS-style (user może wywołać dla cudzego UID i zobaczyć ich plan). **Klient powinien zawsze przekazywać własne `auth.uid()`** — patrz Security note poniżej.

## Security Note
- Funkcja `SECURITY DEFINER` widzi wszystkie subscriptions (nie filtruje per `auth.uid()`). Klient może teoretycznie zapytać o cudzy UID i dostać `'pro'`/`'free'`.
- Defense-in-depth (post-MVP): dodać guard `IF uid != auth.uid() AND auth.role() != 'service_role' THEN RAISE EXCEPTION`.
- W MVP akceptowalne — ujawnienie binarnego planu (Pro/Free) cudzego usera nie jest istotnym data leak.

## Rate Limiting
- Brak osobnego limitu.

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK (`supabase.rpc(...)`).
- Funkcja DB zaimplementowana w migracji `20260507000000_complete_schema.sql`.
- Real-time aktualizacja `user_profiles.plan` przez trigger `subscriptions_after_iu_refresh_plan` — RPC potrzebny tylko jako workaround dla webhook latency.
- Cron `expire-subscriptions` (daily 03:00 UTC) odświeża cache.
