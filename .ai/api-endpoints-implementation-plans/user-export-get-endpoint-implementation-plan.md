# API Endpoint Implementation Plan: GET /api/user/export

## 1. Endpoint Overview

`GET /api/user/export` realizuje obowiązek z **RODO art. 20** (prawo do przenoszenia danych) — pojedyncze, czytelne, podpisane czasem JSON-owe „zdjęcie" danych zalogowanego użytkownika. Zwraca w jednym body:

- `user_id` i `email` z `auth.users` (przez `auth.getUser()` — bez czytania `auth.users` przez PostgREST),
- profil z `public.user_profiles` (`plan`, `locale`, `current_consent_version`, `created_at`),
- listę dokumentów z `public.documents` (z pełnym blob-em `data: JSONB` — `CanvasDocument`),
- log zgód z `public.consent_log` (bez `ip_address` — nie wycieka dalej niż jest potrzebne).

Endpoint działa wyłącznie po stronie serwera (Route Handler `src/app/api/user/export/route.ts`), używa klienta cookie-based (`createClient` z `src/lib/supabase/server.ts`) i polega na **RLS** jako głównej granicy autoryzacji — nigdy nie używa `service_role`. Odpowiedź wymusza pobranie pliku w przeglądarce poprzez `Content-Disposition: attachment`.

> Status: plik `src/app/api/user/export/route.ts` jest już zaimplementowany. Niniejszy plan utrwala kontrakt, opisuje stan docelowy i wskazuje wąskie gardła do wykończenia (mapper błędów, rate limit, testy).

---

## 2. Request Details

- **HTTP Method:** `GET`
- **URL Structure:** `/api/user/export`
- **Parametry:**
  - **Wymagane:** brak (endpoint read-only, parametryzacja zbędna).
  - **Opcjonalne:** brak.
- **Request Body:** brak (GET).
- **Wymagane nagłówki / cookies:**
  - Cookies sesji Supabase (`sb-<project-ref>-auth-token` itp.) — ustawiane przez `@supabase/ssr` po zalogowaniu. **Nie** używamy `Authorization: Bearer` — kontrakt to wyłącznie cookie-based JWT.
  - `Accept: application/json` (nieobowiązkowy — i tak zwracamy `application/json`).
- **Środowisko:** Route Handler w Node.js runtime na Vercel (region `fra1`). Proxy (`src/proxy.ts`) **nie obejmuje** `/api/*` — odświeżenie JWT cookies musi nastąpić w handlerze przez pierwsze wywołanie `auth.getUser()`.

---

## 3. Used Types

Wszystkie typy zdefiniowane w `src/types/api.ts` — **nie tworzymy nowych**, ponownie wykorzystujemy istniejące DTO.

| Typ | Plik | Rola |
|---|---|---|
| `UserExportDto` | `src/types/api.ts` | Pełny kontrakt body 200. |
| `ExportProfileDto` | `src/types/api.ts` | Sekcja `profile` (`plan`, `locale`, `current_consent_version`, `created_at`). |
| `DocumentDto` | `src/types/api.ts` | Pojedynczy dokument (`id`, `name`, `schema_version`, `created_at`, `updated_at`, `data: CanvasDocument`). |
| `CanvasDocument` | `src/types/api.ts` | Typowana reprezentacja kolumny `documents.data` (JSONB). |
| `ConsentLogItemDto` | `src/types/api.ts` | Wpis logu zgody (bez `ip_address`). |
| `TypedApiErrorDto<UserExportApiErrorCode>` | `src/types/api.ts` | Body błędów 401/500 (`'unauthorized' \| 'internal_error'`). |
| `Database` (z generowanych typów) | `src/types/database.ts` | Generyk dla `createServerClient<Database>` — gwarantuje typy zwrotów `select(...)`. |

**Polecane lokalne aliasy (wewnątrz pliku route.ts):**

```typescript
type SuccessBody = UserExportDto;
type ErrorBody = TypedApiErrorDto<UserExportApiErrorCode>;
```

Nie wprowadzać Zod-a ani innej walidacji — endpoint nie ma wejścia użytkownika.

---

## 4. Response Details

### 200 OK — sukces

**Headers:**

```
Content-Type: application/json
Content-Disposition: attachment; filename="welderdoc-export-YYYY-MM-DD.json"
```

`YYYY-MM-DD` to `exported_at.slice(0, 10)` — generowany na podstawie aktualnego `Date.now()`, **nie** na podstawie nagłówka żądania (klient nie kontroluje nazwy pliku).

**Body** (kształt `UserExportDto`):

```json
{
  "user_id": "uuid-...",
  "exported_at": "2026-05-08T12:00:00.000Z",
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

### 401 Unauthorized

```json
{ "error": "unauthorized" }
```

Nagłówki: domyślne `Content-Type: application/json`.

### 500 Internal Server Error

```json
{ "error": "internal_error" }
```

Komunikaty z PostgREST/Auth **nigdy** nie wyciekają do klienta — pełne `error.message`/`error.code` logujemy serwerowo (patrz §6).

### Inne statusy

- 405 — Vercel automatycznie odeśle, jeśli ktoś wyśle `POST` (handler eksportuje tylko `GET`). Nie obsługujemy ręcznie.
- 504 — możliwy w teorii (timeout 300 s Vercel Functions), ale jako MVP nie zwracamy z handlera; zostaje w gestii infrastruktury.

---

## 5. Data Flow

```
Browser (cookie sb-...auth-token)
    │
    │  GET /api/user/export
    ▼
Next.js Route Handler  src/app/api/user/export/route.ts
    │
    │  await createClient()   (src/lib/supabase/server.ts — cookies-based)
    ▼
supabase.auth.getUser()                       ─┐  refresh JWT cookies
    │ user==null → 401                          │  (proxy nie wchodzi na /api/*)
    │                                           │
    ▼                                          ─┘
Promise.all([
  supabase.from('user_profiles').select(...).eq('id', user.id).single(),
  supabase.from('documents').select(...).eq('owner_id', user.id).order('created_at'),
  supabase.from('consent_log').select(...).eq('user_id', user.id).order('accepted_at desc')
])
    │  any error → 500 (internal_error), pełny błąd zalogowany serwerowo
    ▼
build UserExportDto:
  user_id      = user.id
  exported_at  = new Date().toISOString()
  email        = user.email
  profile      = profileRes.data
  documents    = documentsRes.data ?? []
  consent_log  = consentRes.data ?? []
    │
    ▼
new NextResponse(JSON.stringify(body), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="welderdoc-export-${YYYY-MM-DD}.json"`
  }
})
```

**Kluczowe interakcje:**

1. **Supabase Auth** — odczyt `auth.users` przez `auth.getUser()` (nigdy `from('auth.users')`). Funkcja sama odświeża cookies przy starych tokenach.
2. **PostgREST + RLS** — trzy proste `SELECT` z istniejącymi politykami RLS:
   - `user_profiles`: `SELECT` po `id = auth.uid()`,
   - `documents`: `ALL` po `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`,
   - `consent_log`: `SELECT` po `user_id = auth.uid()`.
3. **Brak service_role**, brak RPC, brak zewnętrznych usług. Nie czytamy `auth.users` przez SQL.
4. **Brak tabel zapisu** — endpoint w 100% read-only.

**Sortowania** (utrwalają stabilność eksportu):

- `documents.order('created_at', { ascending: true })` — chronologicznie od najstarszego.
- `consent_log.order('accepted_at', { ascending: false })` — najnowsze zgody na górze (dla audytu).

---

## 6. Security Considerations

### Authentication

- **Tylko sesja Supabase** (cookies-based JWT). Anonimowy → 401.
- `auth.getUser()` wywołane **jako pierwsze działanie** w handlerze. Pomijanie tego kroku oznacza, że JWT nie zostanie odświeżony (proxy nie obsługuje `/api/*`) i kolejne zapytania w obrębie tej sesji dostają 401 z PostgREST. Patrz `api-plan.md` §1.1 (changelog 2026-05-08).

### Authorization

- **RLS jest jedyną granicą** dla danych użytkownika. Klient cookie-based propaguje `auth.uid()` do PostgREST — niemożliwe wyciągnięcie cudzego `user_id` (nawet jeśli ktoś podmieni body — w GET nie ma body).
- Nigdy **nie** używamy `createAdminClient()` w tej trasie. Service role bypassowałby RLS i zniweczył naturalną izolację.

### Data confidentiality

- `consent_log.ip_address` celowo **wykluczone** z `select(...)` (eksport portability ≠ surowe dane techniczne; IP jest też anonimizowany w `/api/consent` przez `src/lib/ipAnonymize.ts`, ale i tak nie ma powodu go zwracać).
- `paddle_customer_id` nie jest częścią `ExportProfileDto` — to ID systemu zewnętrznego, nie potrzebne dla portability.
- `documents.share_token` i `share_token_expires_at` celowo nieobejmowane `select(...)` — token udostępniający to dane operacyjne, nie portability.
- `email` pobierany **wyłącznie** z `user.email` (Supabase Auth), nigdy z duplikatu w `public.*`.

### Headers / response

- `Content-Disposition: attachment` zapobiega wyświetlaniu treści w kontekście dokumentu (mitigacja XSS w przypadku, gdyby ktoś wstrzyknął `<script>` do nazwy dokumentu).
- Nazwa pliku z `${YYYY-MM-DD}` — bezpieczna, nie zawiera danych użytkownika (brak ataku „odkrycie e-maila" przez nazwę pliku). Nie wstawiamy `user.email` ani `user.id` do nazwy.

### Rate limiting

- W MVP **bez własnego rate-limitera** w kodzie (brak Redis/Upstash). Zgodnie z `api-plan.md` §6 i polem `Performance Characteristics` w specyfikacji: docelowo **1 request/min/user, 5 requestów/dzień/user**. Implementacja: TODO (Upstash Ratelimit lub Vercel KV) — przed produkcją. W planie zostaje jako sekcja §7.
- Brak rate limitera oznacza ryzyko DoS przez power-usera generującego eksport pętlą — zaakceptowane na czas MVP.

### Logging

- Każde 500 musi zostać zalogowane serwerowo z pełnym `error.code`/`error.message` (Vercel `console.error`). Klient nigdy nie dostaje treści błędu DB.
- **Zero PII w logach** — nie logować `user.email`. `user.id` (UUID) w logach jest dopuszczalne i wymagane do diagnozy.

### Cookies / CSRF

- GET na własnym originie + cookies SameSite=Lax (domyślne dla `@supabase/ssr`) — CSRF nieaplikowalny przy braku side-effect.

---

## 7. Error Handling

| Kod | Warunek | Body | Nagłówki | Logging |
|---|---|---|---|---|
| 401 | `auth.getUser()` zwróciło `data.user === null` (brak / wygasła sesja, niepoprawne cookies) | `{ "error": "unauthorized" }` | `Content-Type: application/json` | Brak (oczekiwany przepływ) |
| 500 | `profileRes.error \|\| documentsRes.error \|\| consentRes.error` (problem PostgREST: timeout, 503 z DB, naruszenie RLS niespodziewane) | `{ "error": "internal_error" }` | `Content-Type: application/json` | `console.error('[user/export] db_error', { user_id: user.id, source: 'profile\|documents\|consent', code: err.code, message: err.message })` |
| 500 | Nieprzechwycony wyjątek (np. `JSON.stringify` na cyklicznym blob — w teorii nie powinno wystąpić, ale `data: JSONB` przyszło z niezaufanego źródła) | `{ "error": "internal_error" }` | `Content-Type: application/json` | `console.error('[user/export] unexpected', err)` w `try/catch` na zewnątrz całości |
| 405 | Inna metoda niż `GET` | (Vercel default) | n/d | Brak |

**Wzorzec mapowania błędów:**

W obecnej implementacji handler robi prosty `if (a.error || b.error || c.error) → 500`. Po wprowadzeniu `src/lib/supabase/errors.ts` (`mapPostgrestError`) — **nie zmieniamy zachowania klienta** (kontrakt to nadal `'unauthorized' | 'internal_error'`), ale używamy mappera dla logów:

```typescript
import { mapPostgrestError } from '@/lib/supabase/errors';

if (profileRes.error) {
  const mapped = mapPostgrestError(profileRes.error);
  console.error('[user/export] profile_error', { user_id: user.id, ...mapped });
  return NextResponse.json<ErrorBody>({ error: 'internal_error' }, { status: 500 });
}
```

To samo dla `documents` i `consent_log`. W aktualnym MVP `mapPostgrestError` jeszcze nie istnieje — patrz CLAUDE.md (sekcja „Currently implemented") — więc dopóki go nie ma, logujemy bezpośrednio `error.code`/`error.message`. Po dodaniu mappera podstaw go w handler bez zmiany kontraktu.

**Zero leaków:**

- Klient nigdy nie dostaje `error.code` PostgREST.
- Klient nigdy nie dostaje `error.message` z bazy (mogłaby zawierać wskazówki o schemacie).
- `email` użytkownika nigdy nie trafia do logów.

---

## 8. Performance Considerations

### Soft- i hard-targety

| Metryka | Wartość | Źródło |
|---|---|---|
| **Soft-target latencja** | **< 30 s** (Free → 1 projekt; Pro → 5–50 projektów) | spec §Performance, `api-plan.md` §m8 |
| **Hard limit infrastruktura** | 300 s — Vercel Function timeout (Fluid Compute) | `tech-stack.md` §12 |
| **Power user (>100 projektów)** | Ryzyko throttle/timeout | spec §Performance — TODO post-MVP |

### Wąskie gardła

1. **`documents.data` (JSONB ≤ 5 MB każdy).** Eksport 100 projektów = ~500 MB JSON-a. Dwa problemy:
   - **Pamięć Lambdy** — domyślne 1024 MB w Vercel; przy `JSON.stringify(body)` cały blob ląduje w pamięci jako string (×2 — buffer + return). Realny próg bezpieczeństwa: ~100–200 MB.
   - **Timeout** — 300 s rezerwa; przy 500 MB serializacja sama może zająć kilkanaście sekund.
2. **PostgREST round-trip** dla `documents` z dużymi `data` — payload sieciowy między Lambda a Supabase EU-Frankfurt; przy `fra1` opóźnienie minimalne, przepustowość kluczowa.
3. **`consent_log`** — historycznie krótka lista (<100 wpisów), pomijalna.

### Optymalizacje już zastosowane

- **`Promise.all` na trzech `SELECT`** — równoległe zamiast sekwencyjnych zapytań. Daje `max(t1, t2, t3)` zamiast `t1 + t2 + t3`.
- **`select` z konkretną listą kolumn** — nie pobieramy `share_token`, `paddle_customer_id`, `ip_address`, `user_agent`. Zmniejsza payload sieciowy.
- **Region `fra1`** colocated z Supabase EU-Frankfurt — RTT < 5 ms.
- **Brak service_role** = brak nadpisywania headerów `Authorization` w fetch — niska narzut na konfigurację klienta.

### Optymalizacje post-MVP (poza zakresem)

- **Streaming response (NDJSON)** — `Response` z ReadableStream; zwracamy nagłówek + profil + każdy dokument jako linijkę. Eliminuje peak pamięci; klient łączy.
- **Async export do Vercel Blob** — handler kolejkuje job, generuje JSON, wstawia do Blob, e-mail z linkiem. Wymaga Workflow Devkit lub własnej kolejki. Próg uruchomienia: P95 > 60 s.
- **Pagination strony klienta** — jeśli pójdziemy w stronę „download per dokument" zamiast jednego pliku.

### Caching

- **Brak cache** — endpoint zwraca dane wrażliwe i czas-zależne (`exported_at`). Każde wywołanie musi być świeże. Nie ustawiać `Cache-Control: public`. Domyślny `private, max-age=0` jest poprawny (Next.js Route Handler nie cache'uje GET-ów bez explicite `revalidate`).

### Rate limiting (TODO post-MVP)

Patrz §6 — do implementacji w osobnym tasku przed produkcją. Cel: 1 req/min/user, 5 req/dzień/user.

---

## 9. Implementation Steps

> Plik `src/app/api/user/export/route.ts` **już istnieje i jest zaimplementowany** (patrz sekcja „Route Handlers implemented" w `CLAUDE.md`). Poniższe kroki to (a) weryfikacja zgodności obecnego kodu z planem, (b) wykończenia post-MVP, (c) testy.

### A. Weryfikacja istniejącego handlera (PR review)

1. **Sprawdź import klienta:** `import { createClient } from '@/lib/supabase/server'` — nie `createAdminClient`. Plik nie wpina nigdy service role.
2. **Sprawdź kolejność operacji:**
   1. `const supabase = await createClient();`
   2. `const { data: { user } } = await supabase.auth.getUser();` — **musi być pierwsze** zapytanie do Supabase; refreshuje cookies.
   3. Early-return 401 jeśli `!user`.
3. **Sprawdź `Promise.all`** — trzy zapytania równoległe, **nie** trzy `await` sekwencyjne.
4. **Sprawdź `select(...)` listy kolumn:**
   - `user_profiles`: `'plan, locale, current_consent_version, created_at'`.
   - `documents`: `'id, name, created_at, updated_at, data'`. **Brak** `share_token`, `paddle_customer_id`, `owner_id`, `schema_version` (pozycja `schema_version` jest w `DocumentDto`, ale spec wymaga jej tylko w pełnym widoku dokumentu — zweryfikować vs. spec — patrz krok B.4).
   - `consent_log`: `'consent_type, version, accepted, accepted_at'`. **Brak** `ip_address`, `user_agent`, `id`, `user_id`.
5. **Sprawdź sortowania:** `documents.order('created_at', asc)`, `consent_log.order('accepted_at', desc)`.
6. **Sprawdź budowę body:** dokładnie pola `user_id`, `exported_at`, `email`, `profile`, `documents`, `consent_log` — żadnych innych.
7. **Sprawdź nagłówki odpowiedzi:**
   - `Content-Type: application/json`,
   - `Content-Disposition: attachment; filename="welderdoc-export-${YYYY-MM-DD}.json"`.
8. **Sprawdź typowanie:** body powinno być castowalne na `UserExportDto`. Jeśli TypeScript nie widzi typu zwrotnego — dodać `: Promise<NextResponse<UserExportDto | TypedApiErrorDto<UserExportApiErrorCode>>>`.

### B. Drobne wykończenia

1. **Logging błędów PostgREST.** Obecny handler robi globalne `if (a||b||c) → 500` bez logu. Dodać `console.error` per źródło z `user_id` i `error.code` (bez `email`).
2. **Wyciąg generacji nazwy pliku do helpera** (opcjonalne, czytelność): `formatExportFilename(date: Date): string`.
3. **`schema_version` w `DocumentDto` vs. obecny `select`.** `DocumentDto` ma `schema_version`, ale obecny `select(...)` go pomija. Dwie opcje:
   - **Opcja A** (rekomendowana): dodać `schema_version` do `select` — bo `data: JSONB` zawiera już `schemaVersion`, ale kolumna `documents.schema_version` jest źródłem prawdy dla migracji. Spójność z `DocumentDto`. Zmiana niskiego ryzyka.
   - **Opcja B**: zaktualizować lokalny typ body na `Omit<DocumentDto, 'schema_version'>`. Ostrożnie — łamie kontrakt typów.
   
   **Decyzja:** Opcja A — dopisać `schema_version` do `select` w `documents`. Aktualizuje także specyfikację (przykład w spec nie pokazuje pola, ale spec mówi „data" jest pełne; `schema_version` to metadane).
4. **Cast `data: Json` → `CanvasDocument`.** PostgREST zwraca `data` jako `Json`. Nie weryfikujemy schematu wyjściowego (UE art. 20 wymaga „udostępnienia w ustrukturyzowanym formacie" — JSON z `schemaVersion` to spełnia). Dla TS — `data as unknown as CanvasDocument` przy budowie body lub explicit type assertion na końcu.
5. **`exported_at` ISO** — `new Date().toISOString()`. Filename z `slice(0, 10)` (YYYY-MM-DD) — używać tego samego `exportedAt`, by data w pliku i w body była identyczna (nie generować dwa razy `Date()`).

### C. Mapper błędów (po dodaniu `src/lib/supabase/errors.ts`)

1. Po implementacji `mapPostgrestError` (api-plan.md §9) podpiąć go w handler — zmiana **tylko logu**, nie kontraktu (klient nadal dostaje `'internal_error'`).
2. Logować mapped value: `{ business: BusinessError, message: i18nKey, code: error.code }`.

### D. Rate limiting (TODO post-MVP, osobny task)

1. Wybrać backend (Upstash Ratelimit zalecany — kompatybilny z Vercel Edge/Node).
2. Limit: **1 req/min/user** + **5 req/dzień/user**, klucz `user.id` (po `auth.getUser()`).
3. Przy przekroczeniu: 429 z `Retry-After`. Dodać kod `'rate_limited'` do `UserExportApiErrorCode` w `src/types/api.ts`.

### E. Testy

#### E.1 Vitest (integration, mockowany Supabase)

Plik: `src/app/api/user/export/route.test.ts` (co-located, jak `ipAnonymize.test.ts`).

Pokrycie:

- **401** — `auth.getUser()` zwraca `{ data: { user: null } }`.
- **500** — `profileRes.error` (każde z trzech zapytań po kolei).
- **200** — happy path: kompozycja body, `Content-Disposition` z dzisiejszą datą, `email` z `user.email`, sortowanie consent po `accepted_at desc`.
- **200 — pusty użytkownik** — `documents = []` (Free user bez projektów), `consent_log = []` (edge — choć w praktyce zawsze są zgody z rejestracji).
- **200 — kształt zgodny z `UserExportDto`** — assertion na klucze body (test typu „contract").

Uwaga: zgodnie z `vitest.config.ts` thresholdy coverage 80/80/70/80 obejmują **`src/lib/**`** — Route Handlery (`src/app/**`) są poza thresholdem, ale i tak warto utrzymać >80 % pokrycia jednostkowego. UI testy są w Playwright, ale Route Handler nie jest UI — Vitest jest właściwym narzędziem.

#### E.2 Playwright (E2E, opcjonalnie)

Scenariusz: po zalogowaniu użytkownik klika „Eksport danych" w settings → przeglądarka inicjuje pobieranie pliku z poprawnym `Content-Disposition`. Walidacja struktury JSON-a po stronie testu.

Plik: `e2e/user-export.spec.ts`. Niskii priorytet — pokrycie jednostkowe wystarcza dla MVP.

### F. Dokumentacja

1. Zaktualizować `CLAUDE.md` — przenieść `/api/user/export` z listy „Route Handlers implemented" do osobnej linii „Implementation complete: tests + error mapper" gdy te elementy zostaną dodane (już jest na liście implemented; status nie zmieni się przy tym tasku).
2. Brak nowych pól w typach API — `src/types/api.ts` nie wymaga zmian (jeśli wybrana opcja A z B.3, to **bez zmian** — `DocumentDto` już ma `schema_version`).

### G. Skrypt weryfikacyjny

Skrypt `pnpm verify:routes` (`scripts/verify-routes.sh`) sprawdza obecność `src/app/api/user/export/route.ts` (per CLAUDE.md). Uruchomić po PR-ze, by potwierdzić, że ścieżka istnieje i eksportuje `GET`.

---

## Appendix — Final handler shape (reference)

Pełny, docelowy kształt handlera po wszystkich krokach A–C (bez rate-limitera D, który dochodzi później):

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type {
  UserExportDto,
  TypedApiErrorDto,
  UserExportApiErrorCode,
  CanvasDocument
} from '@/types/api';

type ErrorBody = TypedApiErrorDto<UserExportApiErrorCode>;

export async function GET(): Promise<NextResponse<UserExportDto | ErrorBody>> {
  const supabase = await createClient();

  // Krytyczne: pierwsze działanie — refresh JWT cookies (proxy nie wchodzi na /api/*).
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json<ErrorBody>({ error: 'unauthorized' }, { status: 401 });
  }

  const [profileRes, documentsRes, consentRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('plan, locale, current_consent_version, created_at')
      .eq('id', user.id)
      .single(),
    supabase
      .from('documents')
      .select('id, name, schema_version, created_at, updated_at, data')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('consent_log')
      .select('consent_type, version, accepted, accepted_at')
      .eq('user_id', user.id)
      .order('accepted_at', { ascending: false })
  ]);

  if (profileRes.error) {
    console.error('[user/export] profile_error', {
      user_id: user.id,
      code: profileRes.error.code,
      message: profileRes.error.message
    });
    return NextResponse.json<ErrorBody>({ error: 'internal_error' }, { status: 500 });
  }
  if (documentsRes.error) {
    console.error('[user/export] documents_error', {
      user_id: user.id,
      code: documentsRes.error.code,
      message: documentsRes.error.message
    });
    return NextResponse.json<ErrorBody>({ error: 'internal_error' }, { status: 500 });
  }
  if (consentRes.error) {
    console.error('[user/export] consent_error', {
      user_id: user.id,
      code: consentRes.error.code,
      message: consentRes.error.message
    });
    return NextResponse.json<ErrorBody>({ error: 'internal_error' }, { status: 500 });
  }

  const exportedAt = new Date().toISOString();
  const filename = `welderdoc-export-${exportedAt.slice(0, 10)}.json`;

  const body: UserExportDto = {
    user_id: user.id,
    exported_at: exportedAt,
    email: user.email ?? '',
    profile: profileRes.data,
    documents: (documentsRes.data ?? []).map((d) => ({
      ...d,
      data: d.data as unknown as CanvasDocument
    })),
    consent_log: consentRes.data ?? []
  };

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
```

> Diff w stosunku do obecnego pliku jest minimalny: dodanie `schema_version` do select, rozdzielony logging per error, jawne typy `ErrorBody`/`UserExportDto`, cast `data` na `CanvasDocument`. Zachowanie i kontrakt klienta — bez zmian.
