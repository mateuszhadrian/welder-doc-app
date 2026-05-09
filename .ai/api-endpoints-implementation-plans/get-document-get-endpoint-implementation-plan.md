# API Endpoint Implementation Plan: Get Document (GET /rest/v1/documents?id=eq.{id})

## 1. Endpoint Overview

Pobranie pełnych danych pojedynczego dokumentu canvas (kolumny skalarne + pełen blob `data` JSONB) przez bezpośrednie wywołanie Supabase JS SDK (PostgREST). Endpoint nie ma własnego Route Handlera — klient odpytuje `documents` z RLS chroniącym dostęp na `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`.

Cel funkcjonalny:

- US-009 / canvas editor: załadowanie sceny po wejściu na URL projektu (`/[locale]/project/[id]`).
- Post-bootstrap deserializacja przez `documentCodec.ts` (jeszcze nie zaimplementowane — patrz CLAUDE.md) z opcjonalną runtime migracją gdy `schema_version < CURRENT_CODEC_VERSION`.
- Atomowy odczyt całego projektu (nie partycjonowane per shape; cały `data` jest jednym blobem).

Kluczowe założenia architektoniczne (z `api-plan.md` §2.6, `architecture-base.md` §15, `tech-stack.md` §7):

- Brak Route Handlera w `src/app/api/...` — wywołanie idzie z Server Component lub Client Component przez odpowiedni helper Supabase.
- RLS jest jedynym mechanizmem autoryzacji; klient nie może przekazać własnego `owner_id`.
- Mapowanie błędów obowiązkowo przez `mapPostgrestError` z `src/lib/supabase/errors.ts` (do zaimplementowania zgodnie z `api-plan.md` §9) — żaden komponent nie może dotykać `error.message` bezpośrednio.

## 2. Request Details

- **HTTP Method:** `GET`
- **URL Structure (PostgREST):** `GET /rest/v1/documents?id=eq.{id}&select=id,name,data,schema_version,created_at,updated_at`
- **SDK call (canonical):**
  ```typescript
  const { data, error } = await supabase
    .from('documents')
    .select('id, name, data, schema_version, created_at, updated_at')
    .eq('id', documentId)
    .single();
  ```
- **Parameters:**
  - **Required:**
    - `id` — UUID dokumentu (path/query level: `?id=eq.{uuid}`).
  - **Optional:**
    - `select` — CSV listy kolumn; w MVP zawsze ten sam zestaw 6 kolumn (patrz wyżej). Nie eksponować `owner_id`, `share_token`, `share_token_expires_at` na ten odczyt — dane wewnętrzne.
- **Headers (zarządzane przez SDK):**
  - `Authorization: Bearer <user JWT>` — automatycznie z `@supabase/ssr` (Server Component / Route Handler) lub `@supabase/supabase-js` browser client przez cookies.
  - `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>` — dodawany przez SDK.
  - `Accept: application/vnd.pgrst.object+json` — dodawany automatycznie przez `.single()`.
- **Request Body:** brak (GET).

## 3. Used Types

Plik: `src/types/api.ts` (już istnieje):

- `CanvasDocument` — typowana reprezentacja blobu `documents.data` (`schemaVersion`, `canvasWidth`, `canvasHeight`, `shapes`, `weldUnits`).
- `DocumentDto` — pełen DTO z typowanym `data: CanvasDocument`:
  ```typescript
  type DocumentDto = Pick<
    Tables<'documents'>,
    'id' | 'name' | 'schema_version' | 'created_at' | 'updated_at'
  > & { data: CanvasDocument };
  ```
- Pomocniczo `Tables<'documents'>` z `src/types/database.ts` — używane do walidacji typu `data: Json` przed kastowaniem do `CanvasDocument`.

Nowe typy do dodania (helper service):

- `GetDocumentResult` — discriminated union na poziomie service:
  ```typescript
  type GetDocumentResult =
    | { ok: true; document: DocumentDto }
    | { ok: false; error: MappedError };
  ```
  (`MappedError` z `src/lib/supabase/errors.ts` — `api-plan.md` §9.1).

Brak nowego Command Modelu (read-only operacja).

## 4. Response Details

### 200 OK (sukces)

```json
{
  "id": "uuid-...",
  "name": "Złącze T 1",
  "data": {
    "schemaVersion": 1,
    "canvasWidth": 2970,
    "canvasHeight": 2100,
    "shapes": [],
    "weldUnits": []
  },
  "schema_version": 1,
  "created_at": "2026-05-01T10:00:00Z",
  "updated_at": "2026-05-08T09:30:00Z"
}
```

Klient po deserializacji:

1. Waliduje strukturalnie `data` przez kontrakt `CanvasDocument`.
2. Jeśli `schema_version < CURRENT_CODEC_VERSION` → odpala `documentCodec.migrate(data, schema_version)` (TODO — `documentCodec.ts` nie istnieje).
3. Hydruje store (`useCanvasStore`) przez akcję `loadDocument()` z `DocumentSlice`.

### Status codes przekazywane przez PostgREST

| Code | Sytuacja | Mapping w UI                                                                                                                                                                                                       |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200  | OK       | `loadDocument(data)`                                                                                                                                                                                               |
| 401  | Brak / wygasła sesja | Redirect do `/[locale]/sign-in` (Server Component fallback)                                                                                                                                                        |
| 406  | `single()` zwrócił 0 lub >1 wierszy (RLS odrzuciło lub nieistniejące UUID) | Toast `errors.document_not_found` + redirect do listy `/[locale]/projects` (oba przypadki traktowane identycznie — nie ujawniamy istnienia czyichś dokumentów)                                                     |
| 500  | Błąd DB / nieobsłużony PostgrestError | Toast `errors.unknown` + retry button                                                                                                                                                                              |

> **Note:** PostgREST nie zwraca 404 dla `single()` — zwraca `406 Not Acceptable` z `code: PGRST116` gdy liczba wierszy ≠ 1. Mapowanie 404 odbywa się po stronie warstwy service.

## 5. Data Flow

### 5.1 Sequence

```
[Client / Server Component]
        |
        | (1) supabase.from('documents').select(...).eq('id', id).single()
        v
[Supabase JS SDK + @supabase/ssr]
        |
        | (2) Adds Authorization (cookies → JWT) + apikey headers
        v
[PostgREST endpoint /rest/v1/documents]
        |
        | (3) PostgREST translates query → SQL
        v
[PostgreSQL + RLS]
        |
        | (4) RLS USING (owner_id = auth.uid() AND
        |                EXISTS auth.users WHERE email_confirmed_at IS NOT NULL)
        | (5) Returns row | 0 rows
        v
[SDK]
        |
        | (6) `.single()` materialises → Object | PGRST116 error
        v
[Service layer (`getDocument`)]
        |
        | (7) error → mapPostgrestError() → MappedError
        | (8) data → cast to DocumentDto + structural validation of data shape
        v
[Caller (page / store action)]
```

### 5.2 Choice of Supabase client variant

Zgodnie z `tech-stack.md` §7:

- **Server Component (`/[locale]/project/[id]/page.tsx`):** użyć `await createClient()` z `src/lib/supabase/server.ts` (cookies-based JWT).
- **Client Component (np. lazy reload sceny w canvas editorze):** użyć `createClient()` z `src/lib/supabase/client.ts`.
- **NIE używać** `createAdminClient()` — omija RLS, pobiłoby autoryzację per-user.

Preferowana ścieżka: server-side load przez Server Component → przekaż `DocumentDto` jako prop do `<CanvasApp document={...} />` (Client Component z `next/dynamic({ ssr: false })`). Pozwala uniknąć FOUC i double-fetch.

### 5.3 External services / data sources

- Supabase Postgres (region `eu-central-1` Frankfurt — zgodne z RODO).
- Brak innych integracji (Paddle, Sentry, blob storage) — wyłącznie odczyt z `public.documents`.

### 5.4 Service layer

Wprowadzić nowy plik `src/lib/supabase/documents.ts`:

```typescript
// src/lib/supabase/documents.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { CanvasDocument, DocumentDto } from '@/types/api';
import { mapPostgrestError, BusinessError, type MappedError } from './errors';

const DOCUMENT_COLUMNS =
  'id, name, data, schema_version, created_at, updated_at' as const;

type GetDocumentResult =
  | { ok: true; document: DocumentDto }
  | { ok: false; error: MappedError };

/**
 * Fetch a single document by id. RLS enforces ownership and email-confirmed.
 *
 * Maps PostgREST `PGRST116` (0/>1 rows) → BusinessError-style not_found.
 */
export async function getDocument(
  supabase: SupabaseClient<Database>,
  documentId: string
): Promise<GetDocumentResult> {
  const { data, error } = await supabase
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', documentId)
    .single();

  if (error) {
    // PGRST116 = 0 or >1 rows — present as not_found (RLS-safe wording)
    if (error.code === 'PGRST116') {
      return {
        ok: false,
        error: {
          business: BusinessError.UNKNOWN, // extend enum: DOCUMENT_NOT_FOUND
          message: 'errors.document_not_found',
          rawCode: error.code,
        },
      };
    }
    return { ok: false, error: mapPostgrestError(error)! };
  }

  if (!isCanvasDocument(data.data)) {
    return {
      ok: false,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid',
      },
    };
  }

  return {
    ok: true,
    document: {
      id: data.id,
      name: data.name,
      schema_version: data.schema_version,
      created_at: data.created_at,
      updated_at: data.updated_at,
      data: data.data,
    },
  };
}

function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schemaVersion === 'number' &&
    typeof v.canvasWidth === 'number' &&
    typeof v.canvasHeight === 'number' &&
    Array.isArray(v.shapes) &&
    Array.isArray(v.weldUnits)
  );
}
```

> Action item: rozszerzyć `BusinessError` w `src/lib/supabase/errors.ts` o `DOCUMENT_NOT_FOUND = 'document_not_found'`. Dodać klucz `errors.document_not_found` do `src/messages/pl.json` i `src/messages/en.json`.

## 6. Security Considerations

### 6.1 Authentication

- Sesja Supabase wymagana — JWT w cookies HTTP-Only, set-by-`@supabase/ssr`.
- W Server Component **zawsze** wywołać `auth.getUser()` przed `getDocument()`. `getUser()` waliduje JWT w Auth API (nie tylko lokalny decode) — zgodnie z architektonicznymi regułami CLAUDE.md.
- Brak sesji → klient SDK zwraca `401`. Server Component fallback: `redirect('/[locale]/sign-in?next=...')`.

### 6.2 Authorization (RLS)

Polityka aktywna na `public.documents`:

```sql
CREATE POLICY documents_owner_all ON public.documents
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  );
```

Konsekwencje:

- IDOR niemożliwy z poziomu klienta — RLS zwróci pusty result-set zamiast cudzy dokument. `.single()` → `PGRST116` → `errors.document_not_found`.
- Użytkownik z niezweryfikowanym emailem nie zobaczy nawet własnych dokumentów (zamierzony grace state — UI musi blokować nawigację do `/projects/...` z toast `errors.email_not_confirmed`).
- `owner_id` celowo nie jest zwracany w `select()` — nie ma wartości dla klienta i wyciekałby identyfikator wewnętrzny.

### 6.3 Input validation

- `documentId` musi być stringiem UUID v4. Walidacja przed wywołaniem SDK po stronie klienta (regex lub `crypto.randomUUID`-compatible test). Bez tego PostgREST zwróci `22P02` (`invalid_text_representation`) → mapowane do `BusinessError.UNKNOWN`.
- Walidacja struktury `data` po stronie service (`isCanvasDocument`) — defense-in-depth na wypadek korupcji blobu DB lub regresji w codec'u.

### 6.4 Data minimisation

- `select` zawiera tylko 6 kolumn — `owner_id`, `share_token`, `share_token_expires_at` celowo poza listą.
- W odpowiedzi 200 nie ma email użytkownika ani innych PII.
- `data` JSONB jest self-contained — geometria sceny, brak metadanych typu `created_by_email`.

### 6.5 Transport / cookies

- `@supabase/ssr` wymaga współczesnego `getAll`/`setAll` cookies API (tech-stack.md §7) — zaimplementowane w `src/lib/supabase/{server,middleware}.ts`.
- HTTPS wymuszony na poziomie Vercel (region `fra1`).

### 6.6 Threats considered

| Threat                                         | Mitigation                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| IDOR (cross-tenant document read)              | RLS `owner_id = auth.uid()` + email-confirmed check                                |
| Bypass RLS via service role                    | `getDocument()` wymaga `SupabaseClient<Database>` z user JWT — admin client nieużywany |
| Stale JWT after password change                | `auth.getUser()` revalidates with Auth API; middleware `updateSession()` refreshes co request |
| Information leak (existence of others' UUIDs)  | 0 rows i RLS-blocked rows mapowane do tego samego `errors.document_not_found`      |
| Logging of user document content               | `MappedError.rawMessage` nie zawiera PII (PostgREST komunikaty są generic); nie logujemy całej kolumny `data` |

## 7. Error Handling

### 7.1 Error matrix

| Sytuacja                                     | Source              | Code             | Service mapping                                                  | UI action                                                                       |
| -------------------------------------------- | ------------------- | ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sukces                                        | PostgREST           | 200              | `{ ok: true, document }`                                         | Hydrate store + render canvas                                                   |
| Brak sesji / wygasła                         | SDK                 | 401              | `{ ok: false, error: { business: UNAUTHORIZED, ... } }`          | Redirect `/[locale]/sign-in?next=...`                                           |
| Email niepotwierdzony (RLS zwraca 0 wierszy)  | RLS                 | 406 (`PGRST116`) | `DOCUMENT_NOT_FOUND` (intentional — nie ujawniamy email-state)   | Layout guard powinien wcześniej wykryć i zredirectować do `/email-verification` |
| Dokument nie istnieje                         | RLS                 | 406 (`PGRST116`) | `DOCUMENT_NOT_FOUND`                                             | Toast `errors.document_not_found` + redirect na listę                           |
| `id` nie jest UUID                           | PostgREST           | 400 (`22P02`)    | `UNKNOWN` z `rawCode='22P02'`                                    | Toast `errors.invalid_document_id` + redirect na listę                          |
| `data` JSONB skorumpowany (failed `isCanvasDocument`) | Service             | n/a              | `DOCUMENT_DATA_SHAPE_INVALID`                                    | Toast `errors.document_data_shape_invalid` — eskalacja do supportu              |
| Network error / DB down                      | SDK / PostgREST     | 5xx / `fetch` failure | `mapPostgrestError` → `UNKNOWN`                              | Toast `errors.unknown` + retry button                                            |
| Schema version niewspierana przez codec      | Klient (post-fetch) | n/a              | poza scope service'u                                             | Codec rzuca `UnsupportedSchemaError`; UI: toast `errors.codec_too_new`           |

### 7.2 Error logging

- **Brak tabeli `error_log`** — projekt nie posiada dedykowanej tabeli błędów (potwierdzone w `db-plan.md` / migracjach `20260507000000_complete_schema.sql`).
- Errory `5xx` i nieoczekiwane `MappedError.business === UNKNOWN` należy logować przez `console.error` w Server Component (Vercel zbiera do log drain) z payloadem ograniczonym do `{ documentId, business, rawCode }` — nie pełen `error` object (może zawierać query payload).
- Sentry: out-of-scope MVP (`init-project-setup-analysis.md` §4) — TODO: dodać `Sentry.captureException(error)` po hookupie.

### 7.3 Error mapping rule

Każdy konsument `getDocument()` MUSI używać discriminated union (`if (!result.ok)`), nigdy `error?.message.includes(...)`. Linter/PR review pilnują braku stringowego porównywania (CLAUDE.md, "Error handling uses BusinessError enum").

## 8. Performance Considerations

### 8.1 Workload baseline

- Free user: max 1 dokument; Pro user: ~50 dokumentów (PRD `.ai/prd.md`).
- Pojedynczy `data` blob ograniczony CHECK constraintem do `< 5 MB`.
- Read pattern: 1 fetch przy wejściu na `/[locale]/project/[id]` + okazjonalny reload (np. po wyjściu z błędu codec'a).

### 8.2 Bottlenecks

| Bottleneck                                         | Impact                                          | Mitigation                                                                         |
| -------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Latency RTT klient → Vercel `fra1` → Supabase Frankfurt | <50 ms typowo                                | Region-pinning (zrobione)                                                          |
| Deserializacja 5 MB JSONB w SDK                    | Browser parse `JSON.parse` na 5 MB ~30-80 ms    | Codec validation lazy — najpierw header check, dopiero potem deep validation       |
| Konwersja stringów dat (ISO → Date)                | Negligible                                     | Pomijane — `created_at` zostawić jako string (ISO), parse on-demand w UI          |
| `auth.getUser()` przed każdym fetch (Server Component) | Auth API roundtrip ~50 ms                  | Cache na poziomie Next 16 (per-request memoization) — wystarczy                    |

### 8.3 Database

- Index na `documents.id` (PRIMARY KEY) — lookup jest O(1).
- Index `documents_schema_version_idx` — przyda się przy batch codec migration; nie używany w pojedynczym GET.
- Brak JOIN-ów — pojedyncza tabela.

### 8.4 Caching strategy

- **Vercel Runtime Cache:** świadomie poza scope MVP (`api-plan.md` §10) — invalidation przy PATCH/DELETE komplikuje, workload niski.
- **Browser cache:** brak (response nie ma `Cache-Control` od PostgREST, a JWT-bound endpoint nie powinien być cache'owany przez przeglądarkę).
- **Client-side memoization:** rozważyć `useSWR` lub `useQuery` (TanStack Query) dla deduplikacji w-tabach. MVP: bez SWR — zustand `loadDocument()` jest wystarczający.

### 8.5 Payload size

- Kolumna `data` może być duża (bliska 5 MB). Brak streaming response z PostgREST — całość transferowana naraz.
- Compression: Vercel + Supabase włączają `gzip` / `br` automatycznie. 5 MB JSON kompresuje się do ~500-800 KB.

## 9. Implementation Steps

1. **Rozszerz `BusinessError` enum.** W `src/lib/supabase/errors.ts` (do zaimplementowania zgodnie z `api-plan.md` §9 — obecnie stub w docs) dodać:
   - `DOCUMENT_NOT_FOUND = 'document_not_found'`
   - Upewnić się, że `mapPostgrestError` mapuje `error.code === 'PGRST116'` (lub status 406) na `DOCUMENT_NOT_FOUND` jako gałąź wcześniejsza od `UNKNOWN`.

2. **Dodaj klucze i18n.** W `src/messages/pl.json` i `src/messages/en.json`:
   - `errors.document_not_found` ("Nie znaleziono dokumentu" / "Document not found").
   - `errors.invalid_document_id` (na fallback dla `22P02`).
   - Zweryfikuj że istnieje już `errors.document_data_shape_invalid` (z `api-plan.md` §9 jest w stubie).

3. **Utwórz `src/lib/supabase/documents.ts`** zgodnie ze szkicem z §5.4 — eksporty `getDocument(supabase, documentId)` + lokalna `isCanvasDocument()` guard. Zachowaj zasadę: helper przyjmuje gotowy `SupabaseClient<Database>` (DI), nie tworzy klienta sam — pozwala wstrzyknąć browser/server variant.

4. **Dodaj walidację UUID** (klient-side, przed wywołaniem). Pomocniczo `src/lib/uuid.ts` z `isUuid(value: string): boolean` (regex v4 lub natywny). Wywołać w Server Component przed `getDocument()` — zwraca `notFound()` z Next.js gdy invalid (zamiast 22P02 round-trip).

5. **Stwórz Server Component `src/app/[locale]/project/[id]/page.tsx`** (lub odpowiednik wg architektury app routera):
   - `await setRequestLocale(locale)`.
   - `const supabase = await createClient()`.
   - `const { data: { user } } = await supabase.auth.getUser()`; jeśli brak → `redirect('/[locale]/sign-in?next=...')`.
   - Zweryfikować `isUuid(params.id)` → `notFound()` jeśli nie.
   - `const result = await getDocument(supabase, params.id)`.
   - Discriminated union:
     - `result.ok === false && result.error.business === DOCUMENT_NOT_FOUND` → `notFound()`.
     - `result.ok === false` → render error-state component z `t(result.error.message)`.
     - `result.ok === true` → przekaż jako prop do dynamic-loaded `<CanvasApp document={result.document} />`.

6. **Zaktualizuj `DocumentSlice` (Zustand)** o akcję `loadDocument(dto: DocumentDto)`:
   - Set `shapes`, `weldUnits`, `canvasWidth`, `canvasHeight` z `dto.data`.
   - Set `documentId`, `name`, `schemaVersion`, `updatedAt`.
   - Trigger `documentCodec.migrate()` (gdy `documentCodec.ts` powstanie) jeśli `dto.schema_version < CURRENT_CODEC_VERSION`.
   - Reset `history[]` + `historyIndex` (świeży load = brak historii).

7. **Testy jednostkowe service** (`src/lib/supabase/documents.test.ts`):
   - Mock `SupabaseClient` (z `vitest-mock-extended` lub ręczny).
   - Case: 200 z prawidłowym `data` → `{ ok: true, document }`.
   - Case: `error.code === 'PGRST116'` → `DOCUMENT_NOT_FOUND`.
   - Case: `error.code === '22P02'` → `UNKNOWN`.
   - Case: `data.data = { junk: true }` → `DOCUMENT_DATA_SHAPE_INVALID`.
   - Coverage threshold: lines 80, branches 70 (zgodnie z `vitest.config.ts` dla `src/lib/**`).

8. **Test E2E (Playwright `chromium-desktop`)** — `e2e/document-load.spec.ts`:
   - Sign in jako test user (fixture).
   - `goto /[locale]/project/<known-uuid>` → expect canvas to render with seeded shapes.
   - `goto /[locale]/project/<not-existing-uuid>` → expect 404 page lub redirect.
   - `goto /[locale]/project/<other-users-uuid>` → expect identical 404 (RLS leak test).
   - `await expect(page).toHaveScreenshot()` dla canvas regression.

9. **Run quality gate:**
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test:run src/lib/supabase/documents.test.ts
   pnpm test:e2e -- --project=chromium-desktop -g "document-load"
   ```
   Wszystkie muszą przejść przed merge'm do `main`.

10. **PR checklist (review):**
    - `getDocument()` używany **wszędzie** zamiast inline `supabase.from('documents').select(...)` w komponentach.
    - Żaden komponent nie czyta `error.message` bezpośrednio — tylko `result.error.business`.
    - Server Component wywołuje `auth.getUser()` przed pierwszym query (Layout guard z `architecture-base.md` §17 sprawdzi `current_consent_version` osobno).
    - Brak `console.log(result.document.data)` w produkcji — payload może zawierać 5 MB sceny.
    - i18n keys `errors.document_not_found`, `errors.invalid_document_id`, `errors.document_data_shape_invalid` istnieją w obu plikach `pl.json` i `en.json` — Prettier hook na pre-commit waliduje formatowanie.
