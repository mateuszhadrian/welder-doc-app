# API Endpoint Implementation Plan: GET /api/health

## 1. Endpoint Overview

Publiczny endpoint sprawdzający stan (liveness/readiness probe) aplikacji WelderDoc. Służy do:

- weryfikacji deployu na Vercel (Deploy Checks),
- monitoringu zewnętrznego (UptimeRobot, Better Stack, itp.),
- diagnostyki w CI po deploy,
- ręcznego sanity-checku gdy użytkownik zgłasza problemy.

Endpoint wykonuje lekki probe do bazy Supabase i zwraca jednolity, krótki JSON. Brak logiki domenowej — endpoint MUSI być szybki (< 100 ms p95), nie blokuje na żadnych podsystemach poza pojedynczym round-tripem do Postgres przez PostgREST.

Plik: `src/app/api/health/route.ts` — **już zaimplementowany**. Niniejszy plan udokumentowuje istniejący kontrakt i wyznacza dalsze prace (rate limit, ewentualny twardy timeout, observability).

---

## 2. Request Details

- **HTTP Method:** `GET`
- **URL Structure:** `/api/health`
- **Parametry:**
  - Wymagane: brak
  - Opcjonalne: brak
- **Request Body:** brak
- **Headers:** brak (publiczne — nie wymaga `Authorization`, `Cookie`, `X-CSRF`)
- **Query string:** brak (świadomie — żeby URL był idempotentny i łatwo cache'owalny w monitorach)

---

## 3. Used Types

DTO już istnieje w `src/types/api.ts` (sekcja `HEALTH CHECK`):

```ts
/** Response from GET /api/health. */
export interface HealthCheckResponseDto {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks?: {
    database: 'unreachable';
  };
}
```

Brak osobnego `Command Model` — endpoint nie przyjmuje payloadu.

Brak osobnego typu błędu — degradacja jest reprezentowana w tym samym DTO przez wariant `status: 'degraded'` + `checks.database`. **Nie używamy `ApiErrorDto`** dla 503, ponieważ kontrakt monitoringowy oczekuje jednorodnego kształtu odpowiedzi (`status` + `timestamp`) zarówno w 200 jak i 503.

---

## 4. Response Details

### 4.1 200 OK — DB osiągalna

```json
{
  "status": "ok",
  "timestamp": "2026-05-08T12:00:00.000Z"
}
```

`Content-Type: application/json`. Brak nagłówków cache — odpowiedź dynamiczna (Next.js Route Handler domyślnie `no-store`).

### 4.2 503 Service Unavailable — DB nieosiągalna

```json
{
  "status": "degraded",
  "timestamp": "2026-05-08T12:00:00.000Z",
  "checks": {
    "database": "unreachable"
  }
}
```

Kod 503 jest świadomy — Vercel Deploy Checks i większość monitorów traktuje 5xx jako fail. Nie zwracamy 200 z `status: "degraded"`, bo niektóre alerty oparte są tylko na statusie HTTP.

### 4.3 Statusy nieużywane

| Status | Powód niewystąpienia |
|---|---|
| 400 | Brak query params / body do walidacji |
| 401 | Endpoint publiczny — brak auth |
| 404 | Brak parametrów ścieżki |
| 500 | Wewnętrzne błędy są mapowane na `503 degraded`, by ujednolicić kontrakt monitorowania |

---

## 5. Data Flow

```
Client (Vercel Deploy Check / monitor)
  │
  ▼
GET /api/health  ──►  Next.js Route Handler (Node runtime, region fra1)
                          │
                          │ 1. timestamp = new Date().toISOString()
                          │ 2. supabase = await createClient()  ── (src/lib/supabase/server.ts)
                          │ 3. probe: supabase.from('documents').select('id', { count: 'exact', head: true })
                          ▼
                       Supabase PostgREST  ──►  Postgres (EU-Frankfurt)
                          │                      │
                          │                      └─ RLS: SELECT na documents wymaga auth.uid();
                          │                         brak sesji → 0 wierszy, ale BEZ błędu;
                          │                         head:true + count:exact daje round-trip bez transferu danych
                          ▼
                       error?
                         ├─ tak → NextResponse.json({status:'degraded', timestamp, checks:{database:'unreachable'}}, {status: 503})
                         └─ nie → NextResponse.json({status:'ok', timestamp})
```

### 5.1 Dlaczego `documents` z `head: true` + `count: 'exact'`?

- Probe MUSI uderzyć w Postgres, a nie zatrzymać się w PostgREST cache — `count: 'exact'` wymusza realne zapytanie SQL.
- `head: true` nie transferuje wierszy → mniejszy payload, niższe p95.
- Wybór tabeli `documents`: jest centralna dla aplikacji (jak nie działa, aplikacja jest faktycznie zdegradowana). Alternatywą byłaby `select 1` przez RPC, ale wymaga to RPC + service-role; obecny wariant załatwia to przez session-client + RLS.
- RLS bez sesji nie błędzi (zwraca 0 wierszy), więc endpoint działa anonimowo.

### 5.2 Co celowo NIE jest robione

- **Brak service-role** (`createAdminClient`) — niepotrzebny, podnosi powierzchnię ataku.
- **Brak `auth.getUser()` jako liveness probe** — opisane w spec jako alternatywa, ale wymaga sesji i nie testuje read-path do tabeli aplikacyjnej.
- **Brak osobnych `checks.auth`, `checks.storage`** — w MVP tylko `database`. Rozszerzenie w przyszłości przez dopisanie pól w `HealthCheckResponseDto.checks` (typ przewiduje wzbogacenie).
- **Brak logowania błędu do `webhook_events` / Sentry** — endpoint jest "ping", logowanie zostawiamy infrastrukturze (Vercel Functions logs).

---

## 6. Security Considerations

### 6.1 Autoryzacja

- Endpoint **publiczny**. Nie wymaga `Authorization: Bearer ${CRON_SECRET}` (vs `/api/cron/*`), nie wymaga JWT.
- W odpowiedzi **nie zwracamy żadnych danych użytkownika ani DB schema** — brak nazw tabel, brak `error.message`. Treść odpowiedzi jest taka sama dla każdego klienta.

### 6.2 Information disclosure

- Świadomie pomijamy `error.message` w 503, żeby nie wyciekła topologia ani fragmenty zapytań SQL do publicznych logów monitorów.
- `timestamp` jest po stronie serwera (ISO 8601 UTC) — nie ujawnia stref ani identyfikatorów wewnętrznych.

### 6.3 DDoS / abuse

- Endpoint może być nadużyty jako keep-alive ping (każde wywołanie to round-trip do Postgres).
- **TODO (poza zakresem MVP, zaplanowane):** rate-limit 60 / min / IP. Implementacja: lekki middleware w `src/proxy.ts` lub Upstash Redis `@upstash/ratelimit`. Klucz limit: `IP` (anonimizacja przez `src/lib/ipAnonymize.ts` przed użyciem jako klucz).
- Vercel ma własną ochronę DDoS na poziomie edge — dla MVP wystarczy.

### 6.4 Region / GDPR

- Endpoint nie loguje IP do bazy (w przeciwieństwie do `/api/consent`). Vercel logi runtime są efemeryczne; nie ma trwałego śladu RODO-relewantnego.
- Region `fra1` (EU-Frankfurt), zgodnie z `vercel.json` i Supabase EU.

### 6.5 Cache / proxy poisoning

- Odpowiedź MUSI być `no-store`. Domyślne zachowanie Next.js Route Handlerów (`dynamic = 'force-dynamic'` jest implicite tu, bo nie wywołujemy `cache()` ani `unstable_cache`). Nie dodajemy `Cache-Control: public` — monitory pollują, a cache wprowadziłby fałszywy "ok" gdyby DB padła.

### 6.6 Co jeszcze do rozważenia (nie blokuje MVP)

- HTTP HEAD support: Vercel Deploy Checks używa GET, więc nie jest potrzebne. Można dodać export `HEAD` później.
- Versioning: jeśli kiedyś dodamy `checks.auth`, monitory powinny tolerować nowe pola — `HealthCheckResponseDto.checks?` jest opcjonalne i extendable.

---

## 7. Error Handling

| Sytuacja | Przyczyna | Zachowanie | Status | Body |
|---|---|---|---|---|
| Supabase URL/klucz źle skonfigurowane | Brak `NEXT_PUBLIC_SUPABASE_URL` lub `NEXT_PUBLIC_SUPABASE_ANON_KEY` w env | `createClient()` rzuci → bubble do Next.js | 500 (default Next.js) | HTML error page |
| Sieć między Vercel a Supabase niedostępna | DNS / network partition | `supabase.from().select()` zwraca `error` (PostgREST/fetch error) | 503 | `{status:'degraded', timestamp, checks:{database:'unreachable'}}` |
| Supabase 5xx (np. database paused) | Awaria po stronie Supabase | `error` z PostgREST | 503 | `{status:'degraded', timestamp, checks:{database:'unreachable'}}` |
| RLS odfiltrował wiersze | Anon, brak sesji | Brak `error`, count = 0 | 200 | `{status:'ok', timestamp}` |
| Tabela `documents` nie istnieje | Brak migracji w danym środowisku | `error.code = '42P01'` | 503 | `{status:'degraded', ...}` (poprawne — apka faktycznie nie działa) |
| Timeout PostgREST | Slow Postgres / overload | `error` (po `~10s`) | 503 | `{status:'degraded', ...}` |

### 7.1 Błędy NIE-mapowane na 503

- Brak — każdy `error` z probe'u skutkuje `503 degraded`. Nie używamy `mapPostgrestError` (z `src/lib/supabase/errors.ts` — patrz CLAUDE.md), bo monitor nie potrzebuje granulacji `BusinessError` — wystarczy "DB nieosiągalna".

### 7.2 Logowanie

- Brak osobnego logowania do tabeli `error_log` (taka tabela nie istnieje w schemacie — patrz `db-plan.md`).
- Vercel Functions automatycznie loguje `console.error` do dashboardu. Można opcjonalnie:
  ```ts
  if (error) console.error('[health] supabase probe failed', { code: error.code });
  ```
  (Nie loguj `error.message` — może zawierać fragment SQL.)

---

## 8. Performance Considerations

### 8.1 Cele

- p95 < 100 ms (cel z spec — `Implementation Notes`).
- p99 < 500 ms (degradacja akceptowalna podczas cold start).

### 8.2 Główne źródła latencji

| Źródło | Typowy koszt | Łagodzenie |
|---|---|---|
| Vercel cold start | 100-300 ms (Node runtime) | Region `fra1` (collocation z Supabase EU); funkcja jest mała → szybkie warm-up |
| `await createClient()` | ~5 ms (cookies parse) | Brak — koszt amortyzowany |
| PostgREST round-trip | ~20-40 ms (fra1 ↔ Supabase EU) | `head: true` + `count: 'exact'` minimalizuje payload |
| RLS evaluation | < 1 ms | OK |

### 8.3 Bottlenecki, które NIE powinny się pojawić

- N+1 — brak.
- Duże JSON serializacji — odpowiedź ma ~80 bajtów.
- Lock contention — `SELECT count` na indeksie `documents.id` (PK) jest tani.

### 8.4 Skalowanie

- Vercel Functions skalują horizontally automatycznie.
- Każdy probe to jedno query — Supabase pooler (Supavisor / pgBouncer) bez problemu obsłuży nawet wysokie QPS z monitoringu.
- **Limit:** rate limiting 60/min/IP (TODO §6.3) ucina nadmierne wywołania.

### 8.5 Pomiary

- Vercel Analytics → endpoint p50/p95/p99.
- (Po dodaniu Sentry) — instrument `Sentry.startSpan('health.probe', ...)`.

---

## 9. Implementation Steps

> **Status:** kroki 1-6 są **już ukończone** (commit `406aae7` — `feat: implement backend API layer, Supabase integration, and DB migrations`). Kroki 7-9 są follow-upami.

### 9.1 Już zaimplementowane

1. **DTO**
   Dodać `HealthCheckResponseDto` do `src/types/api.ts` w sekcji `HEALTH CHECK`. **DONE** — typ jest na linii ~211.

2. **Plik route**
   Utworzyć `src/app/api/health/route.ts` z eksportem async `GET()` zwracającym `NextResponse.json(...)`. Plik jest w runtime Node (default). **DONE.**

3. **Helper Supabase**
   Użyć `createClient` z `src/lib/supabase/server.ts` (cookie-based session client) — nie `createBrowserClient`, nie `createAdminClient`. **DONE.**

4. **Probe DB**
   Wywołać `supabase.from('documents').select('id', { count: 'exact', head: true })`. Wybór `documents` świadomy (centralna tabela aplikacji). **DONE.**

5. **Branch error**
   Jeśli `{ error }` z probe'u jest niezerowy → 503 z `{status:'degraded', timestamp, checks:{database:'unreachable'}}`. W przeciwnym razie 200 z `{status:'ok', timestamp}`. **DONE.**

6. **Information disclosure**
   Świadomie pominąć `error.message` w odpowiedzi. Komentarz w pliku tłumaczy decyzję. **DONE.**

### 9.2 Pozostałe kroki

7. **Test jednostkowy (Vitest)** — `src/app/api/health/route.test.ts`:
   - Mock `createClient` z `@/lib/supabase/server`. Mock zwraca `{ from: () => ({ select: () => Promise.resolve({ error: null }) }) }`.
   - Test 1: szczęśliwa ścieżka — `GET()` → status 200, body `{status:'ok', timestamp: <ISO>}`.
   - Test 2: błąd DB — mock zwraca `{ error: { code: 'PGRST116', message: '...' } }` → status 503, body `{status:'degraded', timestamp, checks:{database:'unreachable'}}`.
   - Test 3: kontrakt — `timestamp` jest validnym ISO 8601 UTC (regex `\dT\dZ`).
   - Test 4: odpowiedź **nie** zawiera `error.message`.
   - **Coverage**: `src/app/api/**` nie jest w core'owym progu (CLAUDE.md mówi `src/lib`, `src/shapes`, `src/weld-units`, `src/store` — 80/80/70/80) — testy są dla regression-protection, nie dla coverage gate.

8. **Test E2E (Playwright)** — opcjonalnie, w `e2e/health.spec.ts`:
   - `await page.goto('/api/health')` lub `page.request.get('/api/health')` → spodziewane status 200 i shape `{status:'ok'}`.
   - Smoke test odpalany w CI po deploy preview.

9. **Rate limiting** — TODO osobny ticket:
   - Decyzja: Upstash Redis (`@upstash/ratelimit`) vs naive in-memory (nie skaluje na Vercel — funkcje są stateless).
   - Klucz: `health:${anonymizedIp}` (użyj `anonymizeIpV4_24` / `anonymizeIpV6_48` z `src/lib/ipAnonymize.ts`).
   - Limit: 60/min/IP. Po przekroczeniu → 429 z body `{ error: 'rate_limited' }` (nowy wariant DTO — rozszerz `HealthCheckResponseDto` lub użyj `ApiErrorDto`).
   - Konfiguracja env: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (dodać do `.env.example` i sekcji 13 `tech-stack.md`).

10. **Verify-routes script** — sprawdzić, że `pnpm verify:routes` (`scripts/verify-routes.sh`) pokrywa też `/api/health`. Jeśli nie — dorzucić assertion. (Skrypt obecnie weryfikuje crony + Paddle + consent + export — health może zostać poza, bo brak go w `vercel.json crons[]`.)

11. **Dokumentacja monitoringu** — README.md / `.ai/` :
    - Zarejestrować `https://<prod-host>/api/health` w UptimeRobot / Better Stack.
    - Alert na 3 kolejne 503 w ciągu 5 minut.
    - Wpiąć w Vercel Deploy Checks (`vercel.json` → `checks` — opcjonalne dla MVP).

### 9.3 Definition of Done

- [x] Plik `src/app/api/health/route.ts` istnieje i eksportuje `GET`.
- [x] DTO `HealthCheckResponseDto` w `src/types/api.ts`.
- [x] Endpoint zwraca 200 dla osiągalnej DB i 503 dla niedostępnej.
- [x] Brak wycieku `error.message` w odpowiedzi.
- [ ] Pokrycie testami (Vitest unit) — krok 7.
- [ ] Rate limiting 60/min/IP — krok 9.
- [ ] Wpis w UptimeRobot — krok 11.
