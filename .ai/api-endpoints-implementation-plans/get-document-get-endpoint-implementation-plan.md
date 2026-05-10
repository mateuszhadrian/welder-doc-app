# API Endpoint Implementation Plan: Get Document (GET /rest/v1/documents?id=eq.{id})

> **STATUS:** ✅ Implemented on 2026-05-10. As-built deviations from this plan are tracked in §11 (Implementation Log). Sections 1–10 have been edited in place to reflect the shipped behaviour; the original plan rationale is preserved.

## 1. Endpoint Overview

Pobranie pełnych danych pojedynczego dokumentu canvas (kolumny skalarne + pełen blob `data` JSONB) przez bezpośrednie wywołanie Supabase JS SDK (PostgREST). Endpoint nie ma własnego Route Handlera — klient odpytuje `documents` z RLS chroniącym dostęp na `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`.

Cel funkcjonalny:

- US-009 / canvas editor: załadowanie sceny po wejściu na URL projektu (`/[locale]/canvas/[id]` — patrz §11.1 dla decyzji `project` → `canvas`).
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

- `GetDocumentResult` — discriminated union na poziomie service. **As-built shape** (zgodne z `createDocument` / `getUserProfile` w tym samym module — patrz §11.2):
  ```typescript
  export type GetDocumentResult =
    | { data: DocumentDto; error: null }
    | { data: null; error: MappedError };
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

| Code | Sytuacja | Mapping w UI (as-built)                                                                                                                                                                                           |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200  | OK       | Render `<ProjectLoadedShell document={result.data} />` (placeholder; `<CanvasApp>` integration — patrz §11.5)                                                                                                       |
| 401  | Brak / wygasła sesja | `redirect('/[locale]/login?next=<encoded canvas path>')` (sign-in route to `/login`, nie `/sign-in` — patrz §11.1)                                                                                                  |
| 406  | `single()` zwrócił 0 lub >1 wierszy (RLS odrzuciło lub nieistniejące UUID) | `notFound()` z `next/navigation` → standardowa strona 404 Next.js (oba przypadki traktowane identycznie — nie ujawniamy istnienia czyichś dokumentów). Plan zakładał redirect do `/[locale]/projects`, ale taka strona nie istnieje w MVP — patrz §11.4.        |
| 500  | Błąd DB / nieobsłużony PostgrestError | Inline error component (`<ProjectLoadError>`) z `t(result.error.message)` + przycisk `back_to_projects` na `/[locale]/`                                                                                            |

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

- **Server Component (`/[locale]/canvas/[id]/page.tsx`):** użyć `await createClient()` z `src/lib/supabase/server.ts` (cookies-based JWT). **As-built — patrz `src/app/[locale]/canvas/[id]/page.tsx`.**
- **Client Component (np. lazy reload sceny w canvas editorze):** użyć `createClient()` z `src/lib/supabase/client.ts`.
- **NIE używać** `createAdminClient()` — omija RLS, pobiłoby autoryzację per-user.

Preferowana ścieżka: server-side load przez Server Component → przekaż `DocumentDto` jako prop do `<CanvasApp document={...} />` (Client Component z `next/dynamic({ ssr: false })`). Pozwala uniknąć FOUC i double-fetch. **As-built status:** Server Component fetch jest gotowy; `<CanvasApp>` jeszcze nie istnieje, więc page renderuje `<ProjectLoadedShell>` placeholder z metadanymi dokumentu (patrz §11.5).

### 5.3 External services / data sources

- Supabase Postgres (region `eu-central-1` Frankfurt — zgodne z RODO).
- Brak innych integracji (Paddle, Sentry, blob storage) — wyłącznie odczyt z `public.documents`.

### 5.4 Service layer (as-built)

Helper jest dopisany do istniejącego pliku `src/lib/supabase/documents.ts` (obok wcześniej zaimplementowanego `createDocument`). Plan zakładał nowy plik — w trakcie implementacji okazało się że plik już istniał, więc dodano `getDocument()` do tego samego modułu (patrz §11.3).

Klucze zaprojektowane w czasie implementacji (różnice względem oryginalnego szkicu):

1. **Result shape** zmieniono z `{ ok, document } | { ok, error }` na `{ data, error: null } | { data: null, error }` — żeby zachować spójność z `createDocument` / `getUserProfile` w tym samym module.
2. **`PGRST116` mapping** żyje wewnątrz `getDocument()`, **nie** w `mapPostgrestError`. Powód: `PGRST116` to generyczny "0 or >1 rows" warunek dla `.single()` — semantyka „document not found" jest endpoint-specific (patrz §11.6).
3. **Const `SELECT_COLUMNS`** współdzielony z `createDocument()` (jedno źródło prawdy).

Skrócony as-built (pełna wersja: `src/lib/supabase/documents.ts`):

```typescript
const SELECT_COLUMNS = 'id, name, schema_version, data, created_at, updated_at' as const;

export type GetDocumentResult =
  | { data: DocumentDto; error: null }
  | { data: null; error: MappedError };

export async function getDocument(
  supabase: SupabaseClient<Database>,
  documentId: string
): Promise<GetDocumentResult> {
  const { data, error } = await supabase
    .from('documents')
    .select(SELECT_COLUMNS)
    .eq('id', documentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return {
        data: null,
        error: {
          business: BusinessError.DOCUMENT_NOT_FOUND,
          message: 'errors.document_not_found',
          rawCode: error.code
        }
      };
    }
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  if (!isCanvasDocument(data.data)) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid'
      }
    };
  }

  return {
    data: {
      id: data.id,
      name: data.name,
      schema_version: data.schema_version,
      data: data.data,
      created_at: data.created_at,
      updated_at: data.updated_at
    },
    error: null
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

> ✅ Action items (zrealizowane): `BusinessError.DOCUMENT_NOT_FOUND` dodany w `src/lib/supabase/errors.ts`. Klucze `errors.document_not_found`, `errors.invalid_document_id` dodane w `src/messages/{pl,en}.json` (klucz `errors.document_data_shape_invalid` był już wcześniej zdefiniowany).

## 6. Security Considerations

### 6.1 Authentication

- Sesja Supabase wymagana — JWT w cookies HTTP-Only, set-by-`@supabase/ssr`.
- W Server Component **zawsze** wywołać `auth.getUser()` przed `getDocument()`. `getUser()` waliduje JWT w Auth API (nie tylko lokalny decode) — zgodnie z architektonicznymi regułami CLAUDE.md.
- Brak sesji → klient SDK zwraca `401`. Server Component fallback: `redirect('/[locale]/login?next=...')` (route to `/login`, nie `/sign-in` — `/sign-in` w tym repo nie istnieje, patrz §11.1).

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
- Użytkownik z niezweryfikowanym emailem nie zobaczy nawet własnych dokumentów (zamierzony grace state — UI musi blokować nawigację do `/canvas/...` z toast `errors.email_not_confirmed`).
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

| Sytuacja                                     | Source              | Code             | Service mapping (as-built)                                       | UI action (as-built)                                                            |
| -------------------------------------------- | ------------------- | ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sukces                                        | PostgREST           | 200              | `{ data: DocumentDto, error: null }`                             | Render `<ProjectLoadedShell>` (placeholder; `<CanvasApp>` integration pending)  |
| Brak sesji / wygasła (przed fetchem)         | Server Component    | n/a (`auth.getUser()`) | n/a                                                            | `redirect('/[locale]/login?next=<encoded canvas path>')`                        |
| Brak sesji / wygasła (mid-flow)              | SDK                 | 401              | `{ data: null, error: { business: UNAUTHORIZED, ... } }`         | `redirect('/[locale]/login')`                                                   |
| Email niepotwierdzony (RLS zwraca 0 wierszy)  | RLS                 | 406 (`PGRST116`) | `DOCUMENT_NOT_FOUND` (intentional — nie ujawniamy email-state)   | `notFound()` (Next.js 404). LocaleGuard w layout powinien wcześniej zredirectować do `/[locale]/email-verification` jeśli ekran istnieje. |
| Dokument nie istnieje                         | RLS                 | 406 (`PGRST116`) | `DOCUMENT_NOT_FOUND`                                             | `notFound()` (Next.js 404)                                                      |
| `id` nie jest UUID                           | Page (preflight)    | n/a (`isUuid`)    | n/a — preflight short-circuit przed SDK                          | `notFound()` (zero round-trip do DB; klucz `errors.invalid_document_id` zachowany jako fallback gdyby preflight padł) |
| `data` JSONB skorumpowany (failed `isCanvasDocument`) | Service             | n/a              | `DOCUMENT_DATA_SHAPE_INVALID`                                    | `<ProjectLoadError messageKey="errors.document_data_shape_invalid">` z linkiem do `/[locale]/`  |
| Network error / DB down                      | SDK / PostgREST     | 5xx / `fetch` failure | `mapPostgrestError` → `UNKNOWN`                              | `<ProjectLoadError messageKey="errors.unknown">` + link `back_to_projects`      |
| Schema version niewspierana przez codec      | Klient (post-fetch) | n/a              | poza scope service'u                                             | Codec rzuca `UnsupportedSchemaError`; UI: toast `errors.codec_too_new` (deferred — codec nie istnieje) |

### 7.2 Error logging

- **Brak tabeli `error_log`** — projekt nie posiada dedykowanej tabeli błędów (potwierdzone w `db-plan.md` / migracjach `20260507000000_complete_schema.sql`).
- Errory `5xx` i nieoczekiwane `MappedError.business === UNKNOWN` należy logować przez `console.error` w Server Component (Vercel zbiera do log drain) z payloadem ograniczonym do `{ documentId, business, rawCode }` — nie pełen `error` object (może zawierać query payload).
- Sentry: out-of-scope MVP (`init-project-setup-analysis.md` §4) — TODO: dodać `Sentry.captureException(error)` po hookupie.

### 7.3 Error mapping rule

Każdy konsument `getDocument()` MUSI używać discriminated union (`if (result.error)`), nigdy `error?.message.includes(...)`. Linter/PR review pilnują braku stringowego porównywania (CLAUDE.md, "Error handling uses BusinessError enum").

## 8. Performance Considerations

### 8.1 Workload baseline

- Free user: max 1 dokument; Pro user: ~50 dokumentów (PRD `.ai/prd.md`).
- Pojedynczy `data` blob ograniczony CHECK constraintem do `< 5 MB`.
- Read pattern: 1 fetch przy wejściu na `/[locale]/canvas/[id]` + okazjonalny reload (np. po wyjściu z błędu codec'a).

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

1. ✅ **Rozszerzony `BusinessError` enum** — `DOCUMENT_NOT_FOUND = 'document_not_found'` dodany w `src/lib/supabase/errors.ts:8`. `mapPostgrestError` celowo NIE mapuje `PGRST116` (uzasadnienie: §11.6); mapping żyje wewnątrz `getDocument()`.

2. ✅ **Klucze i18n** dodane w `src/messages/pl.json` i `src/messages/en.json`:
   - `errors.document_not_found` ("Nie znaleziono projektu." / "Project not found.")
   - `errors.invalid_document_id` ("Nieprawidłowy identyfikator projektu." / "Invalid project identifier.")
   - `errors.document_data_shape_invalid` — był już zdefiniowany.
   - Dodano też namespace `project.*` (editor_pending_title, back_to_projects, load_error_title, retry).

3. ✅ **Helper service** `getDocument()` dopisany do istniejącego `src/lib/supabase/documents.ts` (plik istniał z `createDocument()` z US-008). Współdzielony `SELECT_COLUMNS`. Lokalna `isCanvasDocument()` guard. DI klienta zachowane.

4. ✅ **Walidacja UUID** — `src/lib/uuid.ts` z `isUuid(value: string): boolean` (RFC 4122 anchored regex, case-insensitive, v1–v5 + nil). Wywoływane w Server Component przed `getDocument()`.

5. ✅ **Server Component** `src/app/[locale]/canvas/[id]/page.tsx` (route `canvas`, nie `project` — patrz §11.1):
   - `setRequestLocale(locale)` ✓
   - `isUuid(id)` → `notFound()` jeśli false ✓
   - `auth.getUser()` → `redirect('/[locale]/login?next=<encoded canvas path>')` jeśli anonimowy ✓
   - `getDocument(supabase, id)` → discriminated union (`result.error`):
     - `DOCUMENT_NOT_FOUND` → `notFound()` ✓
     - `UNAUTHORIZED` → `redirect('/[locale]/login')` ✓
     - inne → `<ProjectLoadError messageKey={result.error.message} />` ✓
     - `result.error === null` → `<ProjectLoadedShell document={result.data} />` (placeholder; `<CanvasApp>` jeszcze nie istnieje — patrz §11.5)

6. ⏸️ **`DocumentSlice` / `loadDocument(dto)` deferred** — `useCanvasStore` jest jeszcze placeholder (`src/store/use-canvas-store.ts`); `ShapesSlice`/`HistorySlice`/`CanvasSlice`/`UISlice`/`DocumentSlice` nie istnieją. Wprowadzenie `loadDocument` bez slice'ów do których pisze byłoby half-finished implementation. Integration seam udokumentowany w komentarzu w `canvas/[id]/page.tsx:79-82`. Patrz §11.5.

7. ✅ **Testy jednostkowe** — `src/lib/supabase/documents.test.ts` rozszerzone o 8 testów `getDocument()`:
   - Happy path z assercjami nazw kolumn projection ✓
   - `PGRST116` → `DOCUMENT_NOT_FOUND` ✓
   - `PGRST301` → `UNAUTHORIZED` (przez `mapPostgrestError`) ✓
   - `22P02` → `UNKNOWN` ✓
   - 3 warianty `DOCUMENT_DATA_SHAPE_INVALID` (missing `schemaVersion`, null data, non-array shapes) ✓
   - Total: 24 testy w pliku.
   - Dodatkowo: `src/lib/uuid.test.ts` — 10 testów dla validatora.

8. ✅ **Test E2E** — `e2e/canvas-load.spec.ts` (5 scenariuszy, wszystkie pass na `chromium-desktop`):
   - Happy path: owner ładuje swój dokument, `<h1>` z nazwą widoczne ✓
   - Non-existent UUID → 404 ✓
   - **Cross-tenant RLS leak test:** EN_DOC_ID istnieje w bazie ale należy do `e2e-en-ok` — PL user dostaje 404 identyczne jak dla nieistniejącego UUID ✓ **(load-bearing assertion)**
   - Invalid UUID syntax → 404 (preflight, no DB round-trip) ✓
   - Anonymous → redirect na `/login?next=%2Fcanvas%2F<uuid>` ✓
   - Visual regression (`toHaveScreenshot`) celowo pominięty — `<CanvasApp>` placeholder zmieni się przy integracji silnika; baseline byłby od razu nieaktualny.

9. ✅ **Quality gate** — wszystkie zielone:
   ```bash
   pnpm lint                                                # ✓
   pnpm typecheck                                           # ✓
   pnpm test:run                                            # ✓ 201/201 unit
   pnpm test:e2e e2e/canvas-load.spec.ts --project=chromium-desktop  # ✓ 5/5
   ```

10. ✅ **PR checklist (zweryfikowany 2026-05-10):**
    - `getDocument()` używany w nowym page'u; jedyne inline `supabase.from('documents')` poza helperem to `src/app/api/health/route.ts` (DB connectivity probe — `head: true`) i `src/app/api/user/export/route.ts` (RODO art. 20 — wymaga `owner_id` w projekcji, którą `getDocument` celowo wyklucza). Oba istniały wcześniej i są legitimate. ✓
    - Żaden nowy kod nie używa `error.message.includes(...)` ani innego stringowego porównania. Czytanie `result.error.message` jako i18n key (typed `MappedError.message`) jest poprawne. ✓
    - Server Component wywołuje `auth.getUser()` przed pierwszym query; LocaleGuard w `[locale]/layout.tsx` sprawdza `current_consent_version` osobno (route `/canvas/...` nie jest w `PUBLIC_SEGMENTS`, więc gate się uruchamia). ✓
    - Brak `console.log(result.data.data)` w produkcji. ✓
    - Wszystkie 3 wymagane klucze i18n (`document_not_found`, `invalid_document_id`, `document_data_shape_invalid`) obecne w obu plikach `pl.json` i `en.json`. ✓

## 11. Implementation Log (deviations from plan, as of 2026-05-10)

### 11.1 Route: `/[locale]/project/[id]` → `/[locale]/canvas/[id]`

**Plan:** route segment `project`.
**As-built:** route segment `canvas`.
**Reason:** `src/components/projects/NewProjectButton.tsx:61` already redirects to `/canvas/${id}` after `createDocument` (US-008), and `e2e/documents-create.spec.ts` asserts `/canvas/<uuid>` URL patterns. Standardising on `canvas` aligns the new GET page with the existing CREATE flow — alternative would have required changing the button's redirect + e2e assertions in another task's territory.

**Sign-in route:** plan referenced `/[locale]/sign-in` — actual repo uses `/[locale]/login` (page.tsx + LoginForm.tsx already shipped with US-002).

### 11.2 Result type: `{ ok, ... }` → `{ data, error }`

**Plan:** `{ ok: true, document } | { ok: false, error }`.
**As-built:** `{ data: DocumentDto, error: null } | { data: null, error: MappedError }`.
**Reason:** matches the existing pattern of `createDocument()` (same module) and `getUserProfile()` (`src/lib/supabase/profile.ts`). Using two different result-shape conventions in the same module would force callers to remember which helper uses which shape. This shape also mirrors `PostgrestSingleResponse` from `@supabase/supabase-js`, so destructuring is mechanically identical to a raw SDK call.

### 11.3 Helper added to existing file, not new file

**Plan:** "Utwórz nowy plik `src/lib/supabase/documents.ts`".
**As-built:** appended to existing `src/lib/supabase/documents.ts` (file existed from US-008 with `createDocument()`).
**Reason:** keep all `documents`-table helpers in one module; share the `SELECT_COLUMNS` constant.

### 11.4 404 surface: `notFound()` instead of toast + redirect

**Plan:** "Toast `errors.document_not_found` + redirect do listy `/[locale]/projects`".
**As-built:** `notFound()` from `next/navigation` → standard Next.js 404 page. Inline error component (`<ProjectLoadError>`) for non-404 errors with a back-to-home link.
**Reason:** there is no `/[locale]/projects` listing page in MVP — `[locale]/page.tsx` (home) is currently the only "list" surrogate, and it doesn't have a project list yet. Standard 404 is the cleanest signal until a real listing page lands. The decision is reversible — swap `notFound()` for `redirect(buildLocalePath(locale, '/projects'))` once that page exists.

### 11.5 `<CanvasApp>` not rendered — placeholder shell instead

**Plan:** server-side load → pass `DocumentDto` as prop to `<CanvasApp document={...} />` (`next/dynamic({ ssr: false })`).
**As-built:** `<ProjectLoadedShell>` placeholder rendering document name, ID, schema version, canvas size, and updated_at + a "Canvas editor coming soon" panel.
**Reason:** `src/components/canvas/` is empty per CLAUDE.md "post-bootstrap, pre-implementation" state; `<CanvasApp>` doesn't exist yet. Stubbing it would have been a half-finished implementation. The integration seam is documented in `canvas/[id]/page.tsx:79-82` so the swap-in is grep-able.

`DocumentSlice.loadDocument(dto)` (plan step 6) is deferred for the same reason — `useCanvasStore` is still a `_placeholder` (matching the existing `resetUserScoped` no-op pattern).

### 11.6 `PGRST116` mapping lives in `getDocument()`, not `mapPostgrestError`

**Plan step 1 wording:** "Upewnić się, że `mapPostgrestError` mapuje `error.code === 'PGRST116'` na `DOCUMENT_NOT_FOUND`".
**Plan §5.4 sketch:** maps `PGRST116` inside `getDocument()` itself.
**As-built:** `PGRST116` mapping lives in `getDocument()` (matches §5.4).
**Reason:** `PGRST116` is a generic "0 or >1 rows" condition for `.single()` / `.maybeSingle()` — it can occur on any table. Mapping it to the document-specific `DOCUMENT_NOT_FOUND` in the shared `mapPostgrestError` would leak document semantics into other endpoints (e.g. `getUserProfile()` would want `PROFILE_NOT_FOUND`). Endpoint-specific handling is correct. The plan's two sections were internally inconsistent; §5.4 won.

### 11.7 Deferred items (out-of-scope for this PR)

- **`DocumentSlice.loadDocument(dto)`** — picks up alongside the canvas-implementation task when `ShapesSlice`/`HistorySlice`/`CanvasSlice`/`UISlice` land.
- **`<CanvasApp>` integration** — replace `<ProjectLoadedShell>` once the canvas root component exists.
- **`documentCodec.migrate()`** — `documentCodec.ts` doesn't exist; plan-level deferral, not introduced by this PR.
- **Visual regression baseline** (`toHaveScreenshot`) — placeholder shell will change at canvas integration; baseline now would be immediately stale.
- **Production Sentry hookup for `MappedError.business === UNKNOWN` events** — Sentry is out-of-scope MVP per `init-project-setup-analysis.md` §4.

### 11.8 Files touched

| File | Status |
| --- | --- |
| `src/lib/supabase/errors.ts` | added `BusinessError.DOCUMENT_NOT_FOUND` |
| `src/lib/supabase/documents.ts` | added `getDocument()` + `isCanvasDocument()` |
| `src/lib/supabase/documents.test.ts` | +8 tests, +`makeSupabaseForGet()` factory |
| `src/lib/uuid.ts` | new — RFC 4122 validator |
| `src/lib/uuid.test.ts` | new — 10 tests |
| `src/messages/{pl,en}.json` | +`errors.document_not_found`, +`errors.invalid_document_id`, +`project.*` namespace |
| `src/app/[locale]/canvas/[id]/page.tsx` | new Server Component |
| `e2e/canvas-load.spec.ts` | new — 5 scenarios |
