# API Endpoint Implementation Plan: GET /api/cron/cleanup-webhook-events

## 1. Endpoint Overview

Vercel Cron handler odpowiedzialny za czyszczenie tabeli `public.webhook_events` z wpisów starszych niż 90 dni. Wymóg retencji wynika z `db-plan.md` §1.6 oraz polityki RODO (§ minimalizacja danych — brak biznesowego uzasadnienia dla przechowywania payloadów webhooków po pełnej obsłudze i upływie okresu reklamacyjnego).

Endpoint wywoływany jest automatycznie przez Vercel Cron raz w tygodniu (niedziela 02:00 UTC) zgodnie z konfiguracją w `vercel.json` (`schedule: "0 2 * * 0"`). Operacja jest **idempotentna** — kolejne wywołania w obrębie tego samego okna nie będą miały efektu (po pierwszym usunięciu starszych rekordów następne wywołanie nic nie znajdzie).

Status implementacji: **plik `src/app/api/cron/cleanup-webhook-events/route.ts` już istnieje** (zaimplementowany w commicie `406aae7 feat: implement backend API layer, Supabase integration, and DB migrations`). Niniejszy plan dokumentuje istniejącą implementację, opisuje punkty kontrolne PR oraz rekomendowane testy regresji przed mergem do `main` / pierwszym deployem produkcyjnym.

## 2. Request Details

- **HTTP Method:** `GET`
  - Vercel Cron domyślnie wysyła `GET` — handler **musi** eksportować `GET`, **nie** `POST`. Pomyłka tutaj powoduje 405 Method Not Allowed → cron przestaje działać po cichu.
- **URL Structure:** `/api/cron/cleanup-webhook-events`
- **Parameters:**
  - **Required (headers):**
    - `Authorization: Bearer ${CRON_SECRET}` — sekret z Vercel env, weryfikowany porównaniem stringów.
  - **Optional:** brak.
  - **Query/path:** brak.
- **Request Body:** brak (GET).

### Vercel Cron Configuration

Wpis w `vercel.json` (już obecny):

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

Pin regionu `fra1` (zgodność z Supabase EU-Frankfurt — wymóg GDPR) jest dziedziczony z `vercel.json`.

## 3. Used Types

Z `src/types/api.ts` (już zdefiniowane):

- `CleanupWebhookEventsResponseDto` — body 200 OK:
  ```typescript
  export interface CleanupWebhookEventsResponseDto {
    deleted: number;
    timestamp: string;
  }
  ```
- `TypedApiErrorDto<CronApiErrorCode>` — body 401 / 500:
  ```typescript
  export type CronApiErrorCode = 'unauthorized' | 'internal_error';
  ```

Helper z `src/lib/supabase/server.ts`:

- `createAdminClient()` — synchroniczny klient `service_role` (omija RLS), wymagany dla `webhook_events` (RLS bez polityk → tylko `service_role`).

## 4. Response Details

### 200 OK — sukces

```json
{
  "deleted": 150,
  "timestamp": "2026-05-08T02:00:00Z"
}
```

- `deleted` — liczba usuniętych wierszy (`count: 'exact'` z PostgREST). Może być `0`.
- `timestamp` — ISO 8601 chwili wykonania (server-side `new Date().toISOString()`).

### 401 Unauthorized

```json
{ "error": "unauthorized" }
```

Brak / nieprawidłowy nagłówek `Authorization`.

### 500 Internal Server Error

```json
{ "error": "internal_error" }
```

Błąd zapytania DELETE (PostgrestError) lub inny nieoczekiwany wyjątek. Body **nie zawiera** szczegółów błędu DB — by nie wyciekać struktury bazy w logach Vercel Cron Dashboard.

### Mapa kodów

| Kod | Body | Powód |
|---|---|---|
| 200 | `{ "deleted": number, "timestamp": ISO8601 }` | Operacja zakończona (również gdy `deleted === 0`) |
| 401 | `{ "error": "unauthorized" }` | Brak / niepoprawny `CRON_SECRET` |
| 500 | `{ "error": "internal_error" }` | Błąd Postgrest / nieoczekiwany wyjątek |

## 5. Data Flow

```
Vercel Cron Scheduler (0 2 * * 0)
        │ GET /api/cron/cleanup-webhook-events
        │ Authorization: Bearer <CRON_SECRET>
        ▼
Next.js Route Handler (Node runtime, region fra1)
   src/app/api/cron/cleanup-webhook-events/route.ts
        │
        ├─ 1. Read `authorization` header
        │     ↳ if !== `Bearer ${process.env.CRON_SECRET}` → 401
        │
        ├─ 2. Compute cutoff:
        │     cutoffIso = new Date(Date.now() - 90*24*60*60*1000).toISOString()
        │
        ├─ 3. createAdminClient()                         ← service_role (omija RLS)
        │
        ├─ 4. supabase
        │       .from('webhook_events')
        │       .delete({ count: 'exact' })               ← PostgREST: zwraca count
        │       .lt('received_at', cutoffIso)
        │
        │     SQL effective:
        │       DELETE FROM public.webhook_events
        │       WHERE received_at < $1
        │     Index used: webhook_events_received_at_idx
        │
        │     ↳ if error → 500 { error: 'internal_error' }
        │
        └─ 5. 200 { deleted: count ?? 0, timestamp: <now ISO> }
```

### Database Tables

Jedyny zaangażowany obiekt:

#### `public.webhook_events`

| Kolumna | Typ | Notatka |
|---|---|---|
| `id` | `BIGSERIAL` | PK |
| `provider` | `TEXT` | nieużywane przez handler |
| `external_event_id` | `TEXT` | nieużywane przez handler |
| `event_type` | `TEXT` | nieużywane przez handler |
| `payload` | `JSONB` | nieużywane przez handler |
| `received_at` | `TIMESTAMPTZ` | **jedyna kolumna w `WHERE`** — porównywana z cutoff |
| `processed_at` | `TIMESTAMPTZ` | nieużywane przez handler |

- **RLS:** włączona, **brak polityk** → dostęp tylko z `service_role`. Z tego wynika obowiązkowe użycie `createAdminClient()`.
- **Indeks:** `webhook_events_received_at_idx (received_at)` wspiera DELETE — dzięki temu nawet przy dużej tabeli operacja pozostaje sprawna (range scan po indeksie).

### Brak współpracy z innymi serwisami

Handler nie wywołuje żadnych zewnętrznych usług (Paddle / inne) — ani jako emiter, ani jako konsument. Operacja jest lokalna dla bazy.

## 6. Security Considerations

### 6.1 Autoryzacja — `CRON_SECRET`

- **Mechanizm:** porównanie nagłówka `Authorization` z `Bearer ${process.env.CRON_SECRET}`. Już zaimplementowane.
- **Wymóg env:** `CRON_SECRET` musi być ustawiony w środowisku Vercel (production + preview). Brak / pusty `CRON_SECRET` → handler będzie odpowiadał 401 dla wszystkich requestów (bezpieczne fail-closed), ale cron nie zadziała.
- **Constant-time compare?** Obecna implementacja używa `!==` (porównanie referencyjne stringów w JS — w teorii leakuje czas). Dla cron-secret wykonywanego z infrastruktury Vercel (nie publicznie) ryzyko timing attack jest pomijalne; bardziej problematyczna byłaby publiczna eksposycja. **Zalecana ocena:** pozostawić `!==` (czytelność), udokumentować.

### 6.2 Autoryzacja DB — `service_role`

- `createAdminClient()` używa `SUPABASE_SERVICE_ROLE_KEY` → omija RLS. To jedyne uzasadnione użycie tego klucza w tym handlerze (`webhook_events` ma RLS bez polityk, więc nawet `authenticated` JWT nic by nie zwrócił).
- **Reguła z `tech-stack.md` §13:** klucz `SUPABASE_SERVICE_ROLE_KEY` jest **server-only**, nigdy nie może wyciec do Client Component / Server Component renderowanego w bundlu. Route Handler `route.ts` w `src/app/api/...` jest server-only — bezpieczne.

### 6.3 Walidacja inputu

- Brak body / query → brak wektora dla wstrzyknięcia (np. SQL injection nie ma jak się tu wkraść — `cutoffIso` jest stałą generowaną server-side i przekazywaną przez parametryzowany PostgREST `.lt(...)`).
- Nagłówek `Authorization`: porównujemy do stałej; dowolny string na wejściu jest bezpieczny.

### 6.4 Information disclosure

- 500 nie zwraca message z PostgrestError → brak wycieku struktury bazy / fragmentów payloadów.
- 401 nie rozróżnia "brak nagłówka" od "zły secret" — utrudnia rekonesans.

### 6.5 Rate limiting / DDoS

- Endpoint nie jest publicznie reklamowany, ale URL `/api/cron/cleanup-webhook-events` jest dostępny z internetu. Bez secretu zwraca 401 bardzo tanio (brak zapytań do DB). Zewnętrzny rate-limit (Vercel + Supabase pooler) wystarczy.
- **Zalecenie do rozważenia (nie wymagane na MVP):** opcjonalny limiter w Vercel Edge Config / Upstash, jeśli pojawi się obserwacja prób enumeracji.

### 6.6 Logging

- Cron handler nie loguje payloadu (nic nie ma) ani treści błędu (nie chcemy wycieku do Vercel logs). Zalecane: w przypadku błędu Postgrest wpisać do `console.error(error)` minimalnie (np. `error.code`) — Vercel Function Logs są tylko dla zespołu, więc to bezpieczne, a daje wgląd przy regresji. **Obecna implementacja nie loguje** — opcjonalna poprawa wymieniona w sekcji Implementation Steps.

## 7. Error Handling

| Scenariusz | Wykrycie | Status | Body | Akcja |
|---|---|---|---|---|
| Brak nagłówka `Authorization` | `request.headers.get('authorization') === null` | 401 | `{ error: 'unauthorized' }` | Brak loga (silent reject — uniknięcie szumu) |
| Niepoprawny secret | `authHeader !== Bearer ${CRON_SECRET}` | 401 | `{ error: 'unauthorized' }` | Brak loga |
| `CRON_SECRET` env nie ustawiony | `process.env.CRON_SECRET === undefined` → porównanie zawsze fałszywe | 401 | `{ error: 'unauthorized' }` | **Smoke test pre-deploy:** sprawdzić `vercel env ls` (zalecenie do checklisty PR) |
| Błąd PostgrestError (np. utrata połączenia, prawa, deadlock) | `error !== null` z `.delete(...)` | 500 | `{ error: 'internal_error' }` | Zalecane `console.error(error.code, error.message)` |
| Brak rekordów do usunięcia | `count === 0` | 200 | `{ deleted: 0, timestamp: ... }` | Normalny scenariusz po pierwszym czyszczeniu |
| Wyjątek niespodziewany (np. fetch timeout, DNS) | `try/catch` wewnętrzny PostgREST może rzucić | 500 | `{ error: 'internal_error' }` | Wymaga obudowania `try/catch` (obecna implementacja nie ma — opcjonalne wzmocnienie) |
| `count` zwrócone jako `null` (PostgREST < 2.0 corner case) | `count ?? 0` | 200 | `{ deleted: 0, timestamp: ... }` | Już obsłużone przez nullish coalescing |

### Brak tabeli `error_log` / `cron_run_log`

W bazie nie istnieje dedykowana tabela do logowania uruchomień cron. Vercel Function Logs + Vercel Cron Dashboard wystarczą (dashboard pokazuje status HTTP ostatniego runa). **Nie wprowadzać** tabeli loga "tylko dlatego, że można" — kontrakt API nie wymaga, a dodaje koszt utrzymania.

## 8. Performance Considerations

### 8.1 Skalowanie tabeli

- `webhook_events` rośnie liniowo z liczbą eventów Paddle. Przy szacowanym ruchu MVP (kilkadziesiąt eventów / dzień), w okresie 90 dni → tysiące, nie miliony rekordów. DELETE z indeksem `received_at_idx` wykona się w milisekundach.
- W skali produkcji Pro (np. 10k eventów / dzień) → ~900k wierszy w okresie. Postgres DELETE z indeksem nadal w sekundach. Nie wymaga batchowania w MVP.
- **Próg do batchowania:** > 1M rekordów do usunięcia w jednym runie — wówczas warto rozbić na chunki (`LIMIT 10000` w pętli) by uniknąć długiego locka.

### 8.2 Cron timeout

- Vercel Function default timeout: 10s na Hobby, 60s na Pro. Cron runs są uruchamiane jako Function. Endpoint nie deklaruje custom `maxDuration` — zostaje default. Przy MVP DELETE zmieści się grubo.
- **Zalecenie dla wzrostu:** dodać `export const maxDuration = 60` w `route.ts`, kiedy wolumen przekroczy ~100k usuniętych rekordów / run.

### 8.3 Lock contention

- DELETE bierze row-level locks na usuwanych wierszach. Inserty z webhooka Paddle (`POST /api/paddle/webhook`) wstawiają **nowe** wiersze (nigdy nie modyfikują starych) → brak realnej kontencji z czyszczeniem.
- Aktualne ID są dalekie od cutoffu czasowego, więc nie kolidują.

### 8.4 Index health

- Po każdym DELETE wartym ~50% rozmiaru tabeli warto rozważyć `VACUUM ANALYZE webhook_events` — obecnie autovacuum Supabase tym zarządza. Brak akcji w handlerze.

### 8.5 Cold start

- Synchroniczny `createAdminClient()` (bez `await cookies()`) → zimny start funkcji nie jest wymuszony do dynamic rendering. Przy zerowym ruchu między cronami (raz / tydzień) cold start jest gwarantowany — typowo < 500 ms na Vercel Pro fra1.

## 9. Implementation Steps

> Plik handlera **już istnieje** i implementuje pełen kontrakt (`src/app/api/cron/cleanup-webhook-events/route.ts`). Poniższe kroki to **lista weryfikacyjna** dla code review + ewentualnych usprawnień; **nie** są listą greenfield "od zera".

### Krok 1 — weryfikacja istniejącego handlera

- [ ] Plik `src/app/api/cron/cleanup-webhook-events/route.ts` eksportuje `GET`, **nie** `POST`.
- [ ] Pierwsza akcja w handlerze: walidacja `Authorization` przed jakimkolwiek dotknięciem DB.
- [ ] `createAdminClient()` z `@/lib/supabase/server` (nie `createClient()` — RLS bez polityk).
- [ ] DELETE używa `.lt('received_at', cutoffIso)` z poprawnym ISO (90 dni × 24h × 60min × 60s × 1000ms).
- [ ] `count: 'exact'` w opcjach `.delete()` — bez tego `count` jest `null`.
- [ ] Przy `error` zwracane 500 z body `{ error: 'internal_error' }` (bez wycieku `error.message`).
- [ ] Przy sukcesie body zawiera `deleted` (number, nie null) i `timestamp` (ISO 8601).

### Krok 2 — weryfikacja konfiguracji Vercel + env

- [ ] `vercel.json` zawiera wpis `crons[]` z `path: "/api/cron/cleanup-webhook-events"` i `schedule: "0 2 * * 0"`.
- [ ] `pnpm verify:routes` przechodzi (skrypt sprawdza obecność `route.ts` dla każdego cron path).
- [ ] Vercel env `CRON_SECRET` ustawiony w **production + preview** (`vercel env ls`). Bez tego cron zwróci 401.
- [ ] Vercel env `SUPABASE_SERVICE_ROLE_KEY` ustawiony w **production + preview**.
- [ ] Vercel env `NEXT_PUBLIC_SUPABASE_URL` ustawiony w **production + preview**.
- [ ] Region projektu Vercel pinned do `fra1` w `vercel.json` (kolokacja z Supabase EU-Frankfurt — RODO).

### Krok 3 — testy jednostkowe (Vitest, jeśli zostaną dodane)

> Aktualnie brak testów dla tego handlera. Zalecane (nie blokujące mergea, ale wartościowe):

- [ ] Plik `src/app/api/cron/cleanup-webhook-events/route.test.ts` (jsdom env).
- [ ] Mock `process.env.CRON_SECRET = 'test-secret'`.
- [ ] Mock `@/lib/supabase/server` → `createAdminClient` zwraca obiekt z `from().delete().lt()` resolving do różnych scenariuszy.
- [ ] Test: brak `Authorization` → 401 + body `{ error: 'unauthorized' }`.
- [ ] Test: zły secret → 401.
- [ ] Test: poprawny secret + `count: 5, error: null` → 200 + `{ deleted: 5, timestamp: <ISO> }`.
- [ ] Test: poprawny secret + `count: null, error: null` → 200 + `{ deleted: 0, ... }` (sprawdza `count ?? 0`).
- [ ] Test: poprawny secret + `error: { code: 'PGRST...' }` → 500 + `{ error: 'internal_error' }`.
- [ ] Test: cutoff ISO ma wartość 90 dni przed `Date.now()` (przez `vi.useFakeTimers`).

### Krok 4 — opcjonalne wzmocnienia (nie wymagane na MVP)

- [ ] Dodać `console.error('[cron/cleanup-webhook-events]', error.code, error.message)` w gałęzi błędu — pomoże w debugowaniu w Vercel Function Logs bez wycieku do klienta.
- [ ] Owijka `try/catch` na całość — łapanie nieoczekiwanych wyjątków (np. fetch timeout do Supabase) i mapowanie na 500.
- [ ] `export const dynamic = 'force-dynamic'` — choć Route Handler z `request.headers` i tak nie jest cacheowany; eksplicytna deklaracja zwiększa czytelność.
- [ ] `export const maxDuration = 60` — bezpieczny zapas, kiedy wolumen wzrośnie.

### Krok 5 — testy integracyjne / smoke (post-deploy)

- [ ] Po pierwszym deployu na production: ręczne wywołanie `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/cleanup-webhook-events` → oczekiwane 200 + `deleted: 0` (brak danych starszych niż 90 dni przy świeżej bazie).
- [ ] W Vercel Cron Dashboard pierwsze automatyczne uruchomienie (najbliższa niedziela 02:00 UTC) → status 200.
- [ ] W Supabase SQL Editor: `SELECT count(*) FROM webhook_events WHERE received_at < now() - INTERVAL '90 days'` po runie → 0.

### Krok 6 — checklist PR review

- [ ] Brak hardcoded sekretu / URL-a w kodzie (wszystko z `process.env`).
- [ ] Handler nie loguje payloadu webhook eventu (RODO — payload Paddle może zawierać dane osobowe).
- [ ] Brak importu `createClient` z `server.ts` (tylko `createAdminClient`).
- [ ] Brak `POST` / `PATCH` / `DELETE` eksportu — tylko `GET`.
- [ ] `vercel.json crons[]` i `route.ts` są w jednym PR (nie rozbijać — łatwiej walidatorem `pnpm verify:routes`).
- [ ] `.env.example` zawiera placeholder dla `CRON_SECRET` (już obecny zgodnie z `tech-stack.md` §13).
