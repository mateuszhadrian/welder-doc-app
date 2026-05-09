# API Endpoint Implementation Plan: DELETE /api/user/account

## 1. Endpoint Overview

Trwale i nieodwracalnie usuwa konto użytkownika oraz wszystkie powiązane dane osobowe — realizacja prawa do bycia zapomnianym (RODO art. 17). Operacja destrukcyjna, dlatego wymaga ponownej autoryzacji hasłem (re-auth) oraz literała potwierdzenia `"DELETE"` jako defensywnej warstwy UX.

Handler działa w trzech izolowanych kontekstach klienta Supabase:

1. **Klient sesyjny** (`createClient()` z `src/lib/supabase/server.ts`) — weryfikacja aktywnej sesji JWT i kasacja cookies po sukcesie.
2. **Klient tymczasowy** (`@supabase/supabase-js#createClient` z `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **bez cookies**) — wyłącznie do `signInWithPassword()`, aby nie nadpisać sesji aktywnego usera.
3. **Klient admin** (`createAdminClient()` z `src/lib/supabase/server.ts`) — `auth.admin.deleteUser(user.id)` (omija RLS).

Po `auth.admin.deleteUser` Postgres rozpędza kaskadę przez constrainty FK:
- `public.user_profiles` — `ON DELETE CASCADE` (usuwane).
- `public.documents` — `ON DELETE CASCADE` (usuwane; obejmuje JSONB `data`).
- `public.consent_log` — `ON DELETE CASCADE` (usuwane).
- `public.subscriptions` — `ON DELETE SET NULL` na `user_id` (rekord zachowany dla audytu billingu Paddle, `paddle_customer_snapshot` zachowuje copy customer ID).
- `public.webhook_events` — bez relacji do `auth.users`; pełen payload Paddle żyje 90 dni (cron `cleanup-webhook-events`).

Status: **TODO** — plik `src/app/api/user/account/route.ts` nie istnieje (CLAUDE.md "Route Handler NOT YET implemented"). Endpoint jest **wymagany przed pierwszym deployem produkcyjnym** dotykającym tabel `documents`/`consent_log` (compliance, nie feature parity).

## 2. Request Details

- **HTTP Method:** `DELETE`
- **URL Structure:** `/api/user/account`
- **Plik handlera:** `src/app/api/user/account/route.ts` (eksport `DELETE`, **nie** `POST`)
- **Runtime:** Node.js (default; service-role key wymaga środowiska serwerowego, nie Edge)
- **Headers:**
  - `Content-Type: application/json` (wymagane dla body)
  - `Cookie: sb-access-token=...; sb-refresh-token=...` (dostarczane automatycznie przez przeglądarkę)
- **Parameters:**
  - **Required (body):**
    - `password: string` — niepusty string, hasło aktualnego użytkownika
    - `confirmation: "DELETE"` — literał, dokładnie wielkimi literami
  - **Optional:** brak
- **Request Body:**

```json
{
  "password": "AktualneHaslo123",
  "confirmation": "DELETE"
}
```

## 3. Used Types

Wszystkie typy są już zdefiniowane w `src/types/api.ts` — handler **nie** dodaje nowych typów do tego pliku; importuje istniejące.

- `DeleteAccountCommand` (`src/types/api.ts`) — body request:
  ```typescript
  interface DeleteAccountCommand {
    password: string;
    confirmation: 'DELETE';
  }
  ```
- `DeleteAccountResponseDto` (`src/types/api.ts`) — body sukcesu:
  ```typescript
  interface DeleteAccountResponseDto {
    deleted: true;
    user_id: string;
    deleted_at: string; // ISO 8601
  }
  ```
- `DeleteAccountApiErrorCode` (`src/types/api.ts`) — discriminated union kodów błędów:
  ```typescript
  type DeleteAccountApiErrorCode =
    | 'missing_fields'
    | 'invalid_confirmation'
    | 'invalid_payload'
    | 'unauthorized'
    | 'invalid_password'
    | 'rate_limited'
    | 'internal_error';
  ```
- `TypedApiErrorDto<DeleteAccountApiErrorCode>` (`src/types/api.ts`) — body błędu:
  ```typescript
  interface TypedApiErrorDto<T extends string> {
    error: T;
    message?: string;
  }
  ```

Brak DTO ze schemy DB (`Tables<'...'>`) — handler nie czyta ani nie zapisuje wprost żadnej tabeli; cała kaskada idzie przez `auth.admin.deleteUser` + FK.

## 4. Response Details

### 200 OK — sukces

```json
{
  "deleted": true,
  "user_id": "00000000-0000-0000-0000-000000000000",
  "deleted_at": "2026-05-09T12:00:00.000Z"
}
```

`Set-Cookie` zawiera nagłówki kasujące cookies sesyjne (efekt `supabase.auth.signOut()` na kliencie sesyjnym). Klient po otrzymaniu 200 wykonuje `router.push('/<locale>/account-deleted')` (publiczna strona, bez sesji).

### Kody błędów (szczegóły w §7)

| Status | `error` | Powód |
|---|---|---|
| 400 | `invalid_payload` | `request.json()` rzucił (malformed JSON) |
| 400 | `missing_fields` | brak `password` lub brak `confirmation` |
| 400 | `invalid_confirmation` | `confirmation !== "DELETE"` |
| 401 | `unauthorized` | brak aktywnej sesji (po `auth.getUser()`) |
| 401 | `invalid_password` | `signInWithPassword()` → `Invalid login credentials` |
| 429 | `rate_limited` | przekroczony limit (Supabase Auth `sign_in_sign_ups` lub własny per-IP/user) |
| 500 | `internal_error` | `auth.admin.deleteUser` zwrócił błąd lub nieobsłużony wyjątek |

Każdy błąd ma kształt `{ error: DeleteAccountApiErrorCode, message?: string }`. `message` to opcjonalny i18n-key (`errors.<...>`); nie używać raw stringów z Supabase — przepuścić przez `mapAuthError()` z `src/lib/supabase/errors.ts` (gdy plik powstanie; do tego czasu fallback na konkretny kod lokalnie w handlerze).

## 5. Data Flow

```
Client (DELETE /api/user/account, body { password, confirmation })
    │
    ▼
Next.js proxy (src/proxy.ts) → updateSession() [refresh cookies] → next-intl middleware
    │
    ▼ (matcher wyłącza /api/*, więc proxy NIE biegnie po API; sesja odświeża się
       w samym handlerze przez auth.getUser())
    │
Route Handler  src/app/api/user/account/route.ts  (export async function DELETE)
    │
    ├─ 1. const supabase = await createClient()                        ── klient sesyjny
    ├─ 2. const { data: { user } } = await supabase.auth.getUser()     ── obowiązkowe pierwsze wywołanie
    │       └─ user === null            → 401 unauthorized
    │
    ├─ 3. let body; try { body = await request.json() } catch          → 400 invalid_payload
    ├─ 4. walidacja: typeof password === 'string' && password.length > 0
    │                && confirmation !== undefined
    │       └─ fail                     → 400 missing_fields
    │   walidacja: confirmation === 'DELETE'
    │       └─ fail                     → 400 invalid_confirmation
    │
    ├─ 5. const tempClient = createClient(URL, ANON_KEY,
    │       { auth: { persistSession: false, autoRefreshToken: false } })
    │   const { error } = await tempClient.auth.signInWithPassword({
    │     email: user.email!, password
    │   })
    │       ├─ error?.message ~ "Invalid login credentials" → 401 invalid_password
    │       ├─ error?.status === 429                       → 429 rate_limited
    │       └─ inny error                                   → 500 internal_error
    │
    ├─ 6. const admin = createAdminClient()                            ── service-role
    │   const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
    │       └─ delErr                   → 500 internal_error
    │       │
    │       └─ Postgres CASCADE:
    │           DELETE FROM auth.users WHERE id = $1
    │             ├─ user_profiles  : CASCADE (usunięte)
    │             ├─ documents      : CASCADE (usunięte)
    │             ├─ consent_log    : CASCADE (usunięte)
    │             ├─ subscriptions  : SET NULL na user_id (zachowane dla audytu)
    │             └─ webhook_events : brak FK (zachowane do retencji 90 dni)
    │
    ├─ 7. await supabase.auth.signOut()                                ── kasuje sb-* cookies
    │
    └─ 8. return NextResponse.json(
            { deleted: true, user_id: user.id, deleted_at: new Date().toISOString() },
            { status: 200 }
          )
```

**Kontrakt zewnętrzny:** brak. Operacja jest fully-internal (Supabase Auth Admin API + Postgres FK). **Brak interakcji z Paddle** — subskrypcje nie są kasowane w Paddle (tylko `user_id` w `public.subscriptions` jest `NULL`-owany, snapshot customer ID zachowany). Anulowanie subskrypcji w Paddle to osobny przepływ (Paddle Customer Portal); ten endpoint nie próbuje go zastąpić.

## 6. Security Considerations

- **Re-auth jest obowiązkowy.** Zabezpiecza przed account-takeover na porzuconej sesji (np. cudzy laptop, kawiarnia, zostawiona zakładka). Sama sesja JWT nie wystarcza — destrukcyjne operacje wymagają świeżego dowodu posiadania hasła (OWASP ASVS V8.1).
- **Osobny klient na re-auth.** `signInWithPassword()` na kliencie sesyjnym nadpisałby cookies aktywnej sesji nowymi tokenami. Gdyby user anulował delete (np. zamknął tab po wpisaniu hasła, ale przed wywołaniem `auth.admin.deleteUser`), kontynuacja działania na "starych" cookies byłaby spójna. Tymczasowy klient z `persistSession: false` izoluje weryfikację — żadna interakcja z `cookies()`.
- **Admin client tylko po pomyślnym re-auth.** `createAdminClient()` ma uprawnienia obejścia RLS i może skasować dowolnego usera. Nie wolno wywołać go przed potwierdzeniem hasła.
- **Service-role key jest server-only.** `SUPABASE_SERVICE_ROLE_KEY` istnieje wyłącznie w env serwera Vercel. Plik `src/app/api/user/account/route.ts` nigdy nie może być importowany z Client Component (wymusza to fizyczna struktura `app/api/`).
- **`auth.getUser()` jako pierwsze działanie.** Bez tego wywołania `@supabase/ssr` nie waliduje JWT i nie odświeża cookies — atakujący ze stale wygasłymi cookies mógłby trafić w gałąź "user istnieje" (CLAUDE.md ostrzeżenie `M2`).
- **Confirmation `"DELETE"`** to defense-in-depth UX, **nie** zabezpieczenie kryptograficzne. Wymuszenie wpisania literału ogranicza przypadkowe wywołania (klik, browser-fetch w devtools), ale nie blokuje atakującego znającego hasło — to jest zadanie kroku re-auth.
- **Rate limiting:** Supabase Auth wbudowany limit `sign_in_sign_ups = 30 / 5 min / IP` chroni przed brute-force re-auth na cudzym koncie. **TODO post-MVP:** dodatkowy limit 3/godzinę/IP i 1/dobę/user dla samego `/api/user/account` (api-plan.md §6, M1) — implementacja przez middleware rate-limit (np. Upstash Redis) gdy infrastruktura będzie dostępna. Na MVP polegamy wyłącznie na limicie Supabase + warstwie UX.
- **Nieodwracalność.** Brak soft-delete w MVP. Po sukcesie jedyne pozostałe ślady to:
  - `public.subscriptions` z `user_id IS NULL` + `paddle_customer_snapshot` (audyt billingowy).
  - `public.webhook_events` (rotacja 90 dni przez cron).
  Anonimizacja konsentów nie jest potrzebna — `consent_log` cascadowany w całości (RODO art. 17 wymaga usunięcia, nie anonimizacji konsentów).
- **Brak CSRF tokens** — Supabase cookies są `SameSite=Lax`, a `@supabase/ssr` nie dopuszcza cross-site użycia. Dodatkowo body wymaga JSON contentu (przeglądarki nie wysyłają `application/json` w prostych form-submitach bez explicit fetch).
- **Logowanie:** **nie logować `password`**. Loguj wyłącznie `user.id`, kod błędu i timestamp. Body request nigdy nie trafia do `console.log` ani `Sentry.captureException` (post-MVP — gdy Sentry zostanie podpięty, dodać `beforeSend` strip dla pól `password`).
- **TLS:** wymagany na poziomie Vercel (HTTPS-only). Endpoint nigdy nie biegnie pod HTTP.

## 7. Error Handling

Tabela mapowania `(warunek) → (HTTP, error)`:

| # | Warunek | HTTP | Body |
|---|---|---|---|
| 1 | `request.json()` rzucił (malformed JSON, niepoprawne `Content-Type`) | 400 | `{ error: "invalid_payload" }` |
| 2 | `body.password` nie jest string non-empty **lub** brak `body.confirmation` | 400 | `{ error: "missing_fields" }` |
| 3 | `body.confirmation !== "DELETE"` (case-sensitive, dokładny literał) | 400 | `{ error: "invalid_confirmation" }` |
| 4 | `auth.getUser()` zwróciło `user === null` (brak/wygasła sesja) | 401 | `{ error: "unauthorized" }` |
| 5 | `signInWithPassword()` zwróciło error z `message` zawierającym `"Invalid login credentials"` lub `error.code === 'invalid_credentials'` | 401 | `{ error: "invalid_password" }` |
| 6 | `signInWithPassword()` zwróciło error ze `status === 429` lub `error.message ~ "rate limit"` | 429 | `{ error: "rate_limited" }` |
| 7 | `signInWithPassword()` zwróciło inny error | 500 | `{ error: "internal_error" }` |
| 8 | `admin.auth.admin.deleteUser()` zwróciło error | 500 | `{ error: "internal_error" }` |
| 9 | Nieobsłużony exception (try/catch zewnętrzny) | 500 | `{ error: "internal_error" }` |

**Wzorzec:** każda gałąź `return NextResponse.json({ error: '<code>' }, { status: <kod> })`. Nie wycieka `error.message` z Supabase do klienta — log po stronie serwera (`console.error('[delete-account]', user?.id, error)`), klient dostaje wyłącznie wąski kod z `DeleteAccountApiErrorCode`.

**Mappery z `src/lib/supabase/errors.ts`** (do użycia gdy plik powstanie — api-plan.md §9):
- `mapAuthError(signInErr)` zwróci `{ business: BusinessError.INVALID_CREDENTIALS | RATE_LIMITED | UNKNOWN, message }` — zmapuj na lokalne `DeleteAccountApiErrorCode`. Do tego czasu zrób inline `if (err.message?.includes('Invalid login'))` z TODO commentem.
- **Nie** wprowadzać `error.message.includes(...)` na stałe — to anti-pattern wymieniony w CLAUDE.md ("Error handling uses BusinessError enum + mappers, never raw string checks").

**Nie pisz logów w error-table.** Projekt nie ma dedykowanej tabeli błędów; obserwacja błędów to logi Vercel + (post-MVP) Sentry.

## 8. Performance Considerations

- **Latencja zdominowana przez `auth.admin.deleteUser`** — wykonuje `DELETE FROM auth.users` z kaskadami, co dla użytkownika z dużą liczbą `documents` (każdy `data` JSONB do 5 MB) może trwać sekundy. Soft-target: `<3s` p95. W razie regresji rozważyć batch-delete dokumentów przed `deleteUser`, ale **nie w MVP** — dodaje race condition (inny request mógłby już ich nie znaleźć).
- **Brak cache.** Endpoint mutacyjny, idempotentny pod względem efektu (drugie wywołanie po sukcesie zwróci 401 — sesja skasowana). Cache nie ma sensu.
- **Brak Edge runtime.** Service-role key + `auth.admin` API wymagają Node runtime; Edge nie ma dostępu do pełnego `@supabase/supabase-js` admin API. Pozostawić default Node runtime (brak `export const runtime = 'edge'`).
- **Cold start:** `createAdminClient()` jest synchroniczny i nie ustawia cookies — pomija narzut `await cookies()` (`tech-stack.md` §7). To jedyna mikro-optymalizacja istotna dla pierwszego wywołania po wdrożeniu.
- **`Promise.all` nie do zastosowania** — kroki są sekwencyjne (auth → re-auth → delete → signOut), żaden krok nie jest niezależny.
- **Idempotency-Key:** rozważone i odrzucone na MVP (api-plan.md §7). Drugie wywołanie po sukcesie naturalnie zwróci 401 — to akceptowalne. Dodać post-MVP, jeśli pojawi się retry-safe delete na potrzeby klienta mobilnego.

## 9. Implementation Steps

1. **Utworzyć katalog i plik handlera.**
   - `mkdir -p src/app/api/user/account`
   - `touch src/app/api/user/account/route.ts`

2. **Imports + szkielet handlera.** W `route.ts` dodać:
   - `import { NextResponse } from 'next/server'`
   - `import { createClient as createSupabaseClient } from '@supabase/supabase-js'` (alias, żeby nie kolidował z `@/lib/supabase/server#createClient`)
   - `import { createClient, createAdminClient } from '@/lib/supabase/server'`
   - `import type { DeleteAccountCommand, DeleteAccountResponseDto, DeleteAccountApiErrorCode, TypedApiErrorDto } from '@/types/api'`
   - Zadeklarować `export async function DELETE(request: Request)` (eksport `DELETE`, **nigdy** `POST`).
   - Pomocnik lokalny: `function err(code: DeleteAccountApiErrorCode, status: number) { return NextResponse.json<TypedApiErrorDto<DeleteAccountApiErrorCode>>({ error: code }, { status }) }`.

3. **Krok 1 — sesja.** `const supabase = await createClient()`, następnie `const { data: { user } } = await supabase.auth.getUser()`. Jeśli `!user || !user.email` → `return err('unauthorized', 401)`. **Wywołanie `auth.getUser()` musi być pierwszym kontaktem z Supabase** w handlerze (CLAUDE.md "Krytyczne").

4. **Krok 2 — body i walidacja.** Owinąć `await request.json()` w `try/catch`; w `catch` → `return err('invalid_payload', 400)`. Następnie `const { password, confirmation } = body as Partial<DeleteAccountCommand>`. Walidacje:
   - `if (typeof password !== 'string' || password.length === 0 || confirmation === undefined) return err('missing_fields', 400)`.
   - `if (confirmation !== 'DELETE') return err('invalid_confirmation', 400)`.

5. **Krok 3 — re-auth na osobnym kliencie.** Stworzyć tymczasowy klient bez cookies:
   ```typescript
   const tempClient = createSupabaseClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
     { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
   );
   const { error: signInErr } = await tempClient.auth.signInWithPassword({
     email: user.email,
     password
   });
   ```
   Mapowanie błędów:
   - `signInErr?.status === 429` lub `/rate limit/i.test(signInErr?.message ?? '')` → `return err('rate_limited', 429)`.
   - `signInErr` (jakikolwiek inny — Supabase zwraca `Invalid login credentials` przy złym haśle) → `return err('invalid_password', 401)`. **Nie rozdzielać** "user not found" od "wrong password" — Supabase i tak unifikuje (anti-enumeration).

6. **Krok 4 — hard delete.** `const admin = createAdminClient()`, następnie `const { error: delErr } = await admin.auth.admin.deleteUser(user.id)`. Jeśli `delErr` → `console.error('[delete-account]', user.id, delErr)` + `return err('internal_error', 500)`. **Nie** logować body request.

7. **Krok 5 — signOut + cookies cleanup.** `await supabase.auth.signOut()` na **kliencie sesyjnym** (nie na `tempClient`). Wywołanie ustawia `Set-Cookie` z `Max-Age=0` na `sb-*` cookies w kontekście tego responsu (`@supabase/ssr` używa `setAll` z `next/headers` cookies). Ignorować ewentualny error (`signOut()` po skasowanym userze może rzucić — to OK; user już nie istnieje).

8. **Krok 6 — odpowiedź sukcesu.**
   ```typescript
   const body: DeleteAccountResponseDto = {
     deleted: true,
     user_id: user.id,
     deleted_at: new Date().toISOString()
   };
   return NextResponse.json(body, { status: 200 });
   ```

9. **Wrapper try/catch zewnętrzny.** Owinąć całe ciało `DELETE` w `try { ... } catch (e) { console.error('[delete-account]', e); return err('internal_error', 500) }` na wypadek nieobsłużonych wyjątków (np. Supabase down).

10. **Aktualizacja `scripts/verify-routes.sh`.** Sprawdzić, czy skrypt obejmuje obecność `src/app/api/user/account/route.ts`. Jeśli nie — dodać assert (analogicznie do istniejących linii dla `paddle/webhook` / `consent`). PR checklist w CLAUDE.md wymaga, by RODO-relevantne handlery istniały przed merge na `main`.

11. **Testy (Vitest, `src/app/api/user/account/route.test.ts`).** Pokryć 100% gałęzi błędów:
    - 400 `invalid_payload` (mock `request.json()` rzucający).
    - 400 `missing_fields` (brak `password`, brak `confirmation`).
    - 400 `invalid_confirmation` (`confirmation !== 'DELETE'`).
    - 401 `unauthorized` (mock `auth.getUser()` → `{ data: { user: null } }`).
    - 401 `invalid_password` (mock `signInWithPassword` → `{ error: { message: 'Invalid login credentials' } }`).
    - 429 `rate_limited` (mock `signInWithPassword` → `{ error: { status: 429 } }`).
    - 500 przy `admin.deleteUser` error.
    - 200 happy path: weryfikacja `signOut()` wywołane, response shape zgodny z `DeleteAccountResponseDto`.
   Mockować `@/lib/supabase/server` (oba `createClient` i `createAdminClient`) oraz `@supabase/supabase-js#createClient` przez `vi.mock`.

12. **Test E2E (Playwright, opcjonalnie post-implementacja UI).** Po dodaniu modal/komponentu kasacji w `src/app/[locale]/(authenticated)/account/...`: scenariusz "user wpisuje błędne hasło → toast `errors.invalid_password`"; "user wpisuje poprawne hasło + DELETE → redirect na `/[locale]/account-deleted`, sesja wyczyszczona, kolejne `GET /api/user/export` zwraca 401". Test E2E wymaga osobnego seed-konta na każdy run (ten endpoint jest jednorazowy z definicji).

13. **Klucze i18n (`src/messages/{pl,en}.json`).** Dodać sekcję `errors` z kluczami: `errors.unauthorized`, `errors.invalid_password`, `errors.invalid_confirmation`, `errors.missing_fields`, `errors.invalid_payload`, `errors.rate_limited`, `errors.internal_error`. Klient mapuje `error` z body na klucz przez `useTranslations('errors')`. Brakujący klucz = fallback na `errors.unknown` (gdy `BusinessError` mapper będzie wdrożony).

14. **Aktualizacja CLAUDE.md.** Po implementacji:
    - W sekcji "Route Handlers implemented" przenieść `src/app/api/user/account/route.ts` z bloku "NOT YET implemented".
    - Usunąć linię "**TODO**".

15. **Pre-merge checks (lokalne):**
    - `pnpm typecheck` — strict TS, sprawdza zgodność z `DeleteAccountCommand`/`DeleteAccountResponseDto`.
    - `pnpm lint` — ESLint flat config, brak `no-restricted-imports` violations (nie importujemy `konva` itp.).
    - `pnpm test:run src/app/api/user/account/route.test.ts` — wszystkie ścieżki błędów pokryte.
    - `pnpm verify:routes` — handler obecny.
    - **Manual QA na lokalu (`pnpm supabase start`):** stworzyć usera, zalogować się, wywołać `DELETE /api/user/account` z curl/Insomnia z dobrym hasłem; zweryfikować, że w `auth.users`, `user_profiles`, `documents`, `consent_log` user zniknął, a w `subscriptions` `user_id` jest `NULL` (jeśli rekord istniał).

16. **Post-MVP TODO** (nie blokuje pierwszego deployu):
    - Rate-limit per-IP/user (3/h IP, 1/dobę user) — wymaga Upstash Redis lub równorzędnego.
    - `Idempotency-Key` (api-plan.md §7).
    - Sentry breadcrumb dla `[delete-account]` z PII strip.
    - Wyłączenie wszystkich aktywnych sesji przed `deleteUser` (Supabase `auth.admin.signOut(user.id, 'global')`) — chroni urządzenia, na których user został zalogowany jednocześnie.
