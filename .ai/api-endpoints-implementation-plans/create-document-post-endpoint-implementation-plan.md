# API Endpoint Implementation Plan: POST /rest/v1/documents (Create Document, US-008)

## 1. Endpoint Overview

Tworzy nowy dokument projektu (cross-section + sekwencja spoin) dla zalogowanego użytkownika. Endpoint jest wywoływany **bezpośrednio przez Supabase JS SDK** (PostgREST), bez własnego Route Handlera w `src/app/api/*` (zgodnie z `api-plan.md` §2.2 oraz endpoint specem).

Cechy charakterystyczne:

- **Nie ma własnego pliku `route.ts`** — wszystko dzieje się po stronie klienta przez `supabase.from('documents').insert(...).select().single()`.
- **RLS** wymusza `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL` (USING + WITH CHECK) — niepotwierdzeni użytkownicy oraz niezalogowani goście nie mogą zapisać projektu.
- **Trigger DB** `check_free_project_limit` egzekwuje limit Free=1 projektu (defense-in-depth obok client-side guard, chroni przed race condition dwu zakładek + bezpośrednim wywołaniem REST API).
- **Trigger DB** `sync_schema_version_from_data` automatycznie synchronizuje kolumnę `schema_version` z `data->>'schemaVersion'`, co eliminuje desynchronizację w trakcie migracji schematu.
- **Use case migracji gościa do chmury (US-007)** uruchamia ten endpoint z payloadem z `localStorage.welderdoc_autosave` po pierwszym sign-in.
- **Use case duplikowania dokumentu (US-012)** to operacja dwuetapowa: GET (load) + POST (insert) — drugi etap to ten endpoint.

Implementacja powinna być opakowana w cienki helper-serwis (`src/lib/supabase/documents.ts`) zamiast surowych wywołań SDK rozsianych po komponentach. Helper trzyma logikę walidacji preflight, trim nazwy, spójne mapowanie błędów przez `mapPostgrestError` (`src/lib/supabase/errors.ts`) i jednolity kontrakt zwrotny `{ data, error }` z `MappedError`.

## 2. Request Details

- **HTTP Method:** `POST`
- **URL Structure:** `POST /rest/v1/documents` (PostgREST endpoint Supabase, nie własny Route Handler)
- **Content-Type:** `application/json`
- **Prefer:** `return=representation` (ustawiane automatycznie przez `.select().single()` w SDK)

### Parameters

- **Required (body):**
  - `owner_id: UUID` — musi być równy `auth.uid()` (RLS WITH CHECK; jeśli klient nie poda lub poda inną wartość, INSERT jest odrzucany).
  - `name: string` — niepusty po `trim()`, długość ≤ 100 znaków (DB CHECK).
  - `data: JSONB` — obiekt z kluczami `schemaVersion: number`, `canvasWidth: number`, `canvasHeight: number`, `shapes: unknown[]`, `weldUnits: unknown[]`. Rozmiar surowego JSON < 5 MB (DB CHECK na `octet_length(data::text)`).

- **Optional (body):**
  - `schema_version?: int` — pomijać; trigger `sync_schema_version_from_data` ustawi go z `data.schemaVersion`. Wysyłanie ręczne nie jest błędem (trigger nadpisze), ale jest redundantne.
  - `share_token?: string`, `share_token_expires_at?: TIMESTAMPTZ` — rezerwacja post-MVP, nie wysyłać w MVP.

### Request Body (przykład)

```json
{
  "owner_id": "11111111-2222-3333-4444-555555555555",
  "name": "Nowy projekt",
  "data": {
    "schemaVersion": 1,
    "canvasWidth": 2970,
    "canvasHeight": 2100,
    "shapes": [],
    "weldUnits": []
  }
}
```

### SDK call (źródło prawdy dla kodu produkcyjnego)

```typescript
const { data, error } = await supabase
  .from('documents')
  .insert({
    owner_id: userId,
    name: trimmedName,
    data: canvasDocument,
  })
  .select()
  .single();
```

## 3. Used Types

Wszystkie typy są już zdefiniowane w `src/types/api.ts` (poza `MappedError` / `BusinessError`, które mieszkają w `src/lib/supabase/errors.ts` — TODO).

- **Command Models (input):**
  - `CreateDocumentCommand` (`src/types/api.ts`):
    ```ts
    interface CreateDocumentCommand {
      name: string;
      data: CanvasDocument;
    }
    ```
  - `CanvasDocument` (`src/types/api.ts`) — typed shape JSONB blob (`schemaVersion`, `canvasWidth`, `canvasHeight`, `shapes`, `weldUnits`).

- **DTOs (output):**
  - `DocumentDto` (`src/types/api.ts`):
    ```ts
    type DocumentDto = Pick<
      Tables<'documents'>,
      'id' | 'name' | 'schema_version' | 'created_at' | 'updated_at'
    > & { data: CanvasDocument };
    ```
  - W razie potrzeby listy → `DocumentListItemDto` (poza zakresem tego endpointu, ale używany w US-007 obok migracji).

- **Error types (`src/lib/supabase/errors.ts` — TODO, szkic w `api-plan.md` §9):**
  - `BusinessError` enum — w szczególności: `PROJECT_LIMIT_EXCEEDED`, `DOCUMENT_PAYLOAD_TOO_LARGE`, `DOCUMENT_NAME_INVALID`, `DOCUMENT_DATA_SHAPE_INVALID`, `UNAUTHORIZED`, `UNKNOWN`.
  - `MappedError` interface — `{ business: BusinessError; message: string (i18n key); rawCode?: string; rawMessage?: string }`.
  - `mapPostgrestError(err: PostgrestError | null): MappedError | null` — używany w helperze serwisu.

- **DB types** (`src/types/database.ts`, generowane z Supabase): `Tables<'documents'>`, `TablesInsert<'documents'>`, `Database`. **Uwaga:** kolumna `data` jest typu `Json` — helper musi rzutować payload do `Json` przy INSERT i z powrotem do `CanvasDocument` przy odczycie.

## 4. Response Details

### 201 Created

Body: pełny rekord dokumentu (PostgREST + `Prefer: return=representation` + `.single()`).

```json
{
  "id": "uuid-...",
  "owner_id": "uuid-...",
  "name": "Nowy projekt",
  "data": {
    "schemaVersion": 1,
    "canvasWidth": 2970,
    "canvasHeight": 2100,
    "shapes": [],
    "weldUnits": []
  },
  "schema_version": 1,
  "share_token": null,
  "share_token_expires_at": null,
  "created_at": "2026-05-08T12:00:00Z",
  "updated_at": "2026-05-08T12:00:00Z"
}
```

Helper serwisu zwraca przefiltrowany kształt dopasowany do `DocumentDto` (bez `owner_id`, `share_token*`, których UI nie konsumuje).

### Status code mapping

| Kod | Sytuacja |
|-----|----------|
| 201 | Sukces — dokument utworzony, trigger zsynchronizował `schema_version` |
| 400 | Walidacja DB (CHECK constraint): nazwa, kształt JSONB, rozmiar > 5 MB |
| 401 | Brak sesji Supabase (cookies wygasłe) — PostgREST zwraca 401 |
| 403 | RLS odrzuca: `owner_id ≠ auth.uid()` lub email nie potwierdzony |
| 500 | Trigger `check_free_project_limit` (`P0001 project_limit_exceeded`) lub inny błąd serwera |

## 5. Data Flow

```
[Komponent UI: NewProjectButton / GuestMigration / DuplicateAction]
        │
        │ wywołuje useDocumentsService().createDocument({ name, data })
        ▼
[Hook: useDocumentsService (src/lib/supabase/documents.ts)]
        │ 1. preflightValidate(name, data)            ← client-side
        │    - name.trim().length ∈ [1, 100]
        │    - JSON.stringify(data).length < 5 MB
        │    - data.schemaVersion present, shapes/weldUnits arrays
        │ 2. supabase.auth.getUser() → userId         ← bez userId zwróć MappedError UNAUTHORIZED
        │ 3. supabase.from('documents').insert({ owner_id: userId, name: name.trim(), data }).select().single()
        ▼
[Supabase PostgREST]
        │ a. RLS WITH CHECK: owner_id = auth.uid() AND email_confirmed_at IS NOT NULL
        │ b. Trigger documents_before_iu_check_free_limit
        │      → SELECT 1 FROM user_profiles WHERE id = NEW.owner_id AND plan = 'free'
        │      → SELECT count(*) FROM documents WHERE owner_id = NEW.owner_id
        │      → IF free AND count >= 1 → RAISE EXCEPTION 'project_limit_exceeded'
        │ c. CHECK constraints: name length, jsonb_typeof, octet_length
        │ d. Trigger documents_before_iu_sync_schema_version
        │      → NEW.schema_version := COALESCE((NEW.data->>'schemaVersion')::int, NEW.schema_version, 1)
        │ e. INSERT do public.documents
        ▼
[Helper: documents.ts]
        │ if (error) return { data: null, error: mapPostgrestError(error) }
        │ return { data: toDocumentDto(row), error: null }
        ▼
[Komponent UI]
        │ if (error?.business === BusinessError.PROJECT_LIMIT_EXCEEDED)
        │     toast.error(t(error.message)) + showUpgradeCTA()
        │ else
        │     useDocumentsSlice.setActiveDocument(data)
        │     router.push('/canvas/' + data.id)
```

### Wariant US-007 (migracja gościa do chmury)

```
Po pierwszym sign-in (LocaleGuard / sign-in callback):
1. const autosave = JSON.parse(localStorage.getItem('welderdoc_autosave') ?? 'null')
2. if (!autosave) → skip
3. const { data, error } = await createDocument({ name: 'Mój pierwszy projekt', data: autosave.scene })
4. if (error?.business === PROJECT_LIMIT_EXCEEDED) → toast + showUpgradeCTA(); ZACHOWAJ localStorage
5. if (error) → toast.error; ZACHOWAJ localStorage (retry przy następnym wejściu)
6. if (data):
     localStorage.setItem('welderdoc_migrated_at', new Date().toISOString())   ← marker PRZED removeItem
     localStorage.removeItem('welderdoc_autosave')
```

Marker `welderdoc_migrated_at` jest sentinelem zgodnie z CLAUDE.md i `architecture-base.md` §13: `migrated_at` musi być zapisany **przed** `removeItem`, żeby crash w środku nie odtworzył pętli migracji.

## 6. Security Considerations

1. **Authentication** — RLS na `documents` wymaga `auth.uid()` z aktywnej sesji JWT. Brak sesji → PostgREST zwraca 401 zanim INSERT dotrze do triggerów.
2. **Authorization** — RLS WITH CHECK egzekwuje:
   - `owner_id = auth.uid()` — klient nie może utworzyć projektu w cudzym koncie nawet znając jego UUID.
   - `EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL)` — niepotwierdzeni użytkownicy nie zapisują projektów (US-001 wymaga email verify przed pełnym dostępem). Komunikat klienta: `errors.email_not_confirmed`.
3. **Free plan limit (defense-in-depth)** — trigger `check_free_project_limit` jest funkcją `SECURITY DEFINER`, więc nie da się go obejść z poziomu klienta nawet z poprawnym JWT.
4. **Walidacja danych:**
   - **Client-side preflight (UX):** szybki feedback bez round-trip do bazy:
     - `name.trim().length ∈ [1, 100]`
     - `JSON.stringify(canvasDocument).length < 5 * 1024 * 1024`
     - `typeof data.schemaVersion === 'number'`, `Array.isArray(data.shapes)`, `Array.isArray(data.weldUnits)`
     - **Guest/Free 3-element guard** (US-005): `data.shapes.length + data.weldUnits.length ≤ 3` — **wyłącznie client-side w `ShapesSlice.addShape()`** (brak triggera DB; nie egzekwujemy w `documents.ts`, bo dotyczy też trybu gościa bez sesji).
   - **Server-side (DB):**
     - `CHECK (length(trim(name)) > 0 AND length(name) <= 100)`
     - `CHECK (jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array')`
     - `CHECK (octet_length(data::text) < 5 * 1024 * 1024)`
5. **Brak service-role key na tej ścieżce** — używamy wyłącznie sesyjnego klienta (`createBrowserClient` z `src/lib/supabase/client.ts` w komponentach, lub `createClient()` z `src/lib/supabase/server.ts` jeżeli wywołujemy z Server Action). `createAdminClient()` nie używamy — rozluźniłby RLS i obszedł trigger limitu Free.
6. **CSRF / cookie hardening** — Supabase SSR cookies są `HttpOnly + SameSite=Lax`, `updateSession()` w `src/proxy.ts` odświeża access token przed każdym żądaniem (chain Supabase → next-intl).
7. **Rate limiting** — brak. Free user = max 1 projekt, Pro user = ~50; obciążenie pomijalne. Jeśli w przyszłości pojawi się abuse, dodać Rate Limit w Supabase (PostgREST request limits).
8. **PII / RODO** — `documents.data` może zawierać tytuł / nazwę projektu pisaną przez użytkownika; eksport RODO art. 20 (`/api/user/export`) zawiera całą tabelę — żadne ukryte pola.

## 7. Error Handling

Wszystkie błędy z PostgREST są mapowane przez `mapPostgrestError` w `src/lib/supabase/errors.ts` (TODO; szkic gotowy w `api-plan.md` §9). Helper serwisu nie używa `error.message.includes(...)` w komponentach — tylko `MappedError.business === BusinessError.X`.

| Scenariusz | HTTP | DB code / mapper rule | `BusinessError` | i18n key | UI reakcja |
|------------|------|----------------------|-----------------|----------|-----------|
| Limit Free=1 osiągnięty | 500 | `P0001` + msg `project_limit_exceeded` | `PROJECT_LIMIT_EXCEEDED` | `errors.project_limit_exceeded` | Toast + CTA upgrade. **W US-007 zachowaj `localStorage`** żeby nie utracić sceny gościa. |
| Payload > 5 MB | 400 | `23514` + msg zawiera `octet_length` | `DOCUMENT_PAYLOAD_TOO_LARGE` | `errors.document_payload_too_large` | Toast: zmniejsz scenę, exportuj PNG. |
| Nazwa pusta / >100 znaków | 400 | `23514` + msg zawiera `length(trim(name))` lub `length(name)` | `DOCUMENT_NAME_INVALID` | `errors.document_name_invalid` | Toast + zaznacz pole `name` w formie. (Powinno być wyłapane preflight.) |
| `data` nie jest obiektem / brak `schemaVersion` / `shapes`/`weldUnits` nie tablica | 400 | `23514` + msg zawiera `jsonb_typeof` | `DOCUMENT_DATA_SHAPE_INVALID` | `errors.document_data_shape_invalid` | Toast: nieprawidłowy schemat dokumentu (typowo wskazuje na bug — zaloguj). |
| Brak sesji | 401 | (PostgREST 401, brak JWT) | `UNAUTHORIZED` | `errors.unauthorized` | Redirect na `/[locale]/sign-in` z `?next=`. |
| RLS reject (np. niepotwierdzony email) | 403 | (PostgREST 403, RLS) | `UNAUTHORIZED` (lub dedykowany `EMAIL_NOT_CONFIRMED` jeśli mamy ten kontekst — w MVP traktujemy jak `UNAUTHORIZED`) | `errors.unauthorized` / `errors.email_not_confirmed` | Toast + redirect na `/[locale]/email-verify-required` jeśli wiemy że user istnieje, ale email_confirmed_at IS NULL. |
| Network error / timeout | — | `fetch` reject | `NETWORK_ERROR` | `errors.network_error` | Toast: brak połączenia, spróbuj ponownie. **Zachowaj `localStorage`** w trybie US-007. |
| Inne (nieznany kod) | dowolny | fallback w mapperze | `UNKNOWN` | `errors.unknown` | Toast generyczny + console.error z `rawCode` / `rawMessage` (Sentry post-MVP). |

### Zasady logowania błędów

- **Brak własnej tabeli `error_log`** — błędy biznesowe nie są persystowane.
- W dev: helper loguje `{ rawCode, rawMessage }` przez `console.error` przy `UNKNOWN`.
- W prod (post-MVP): Sentry breadcrumb + capture (`init-project-setup-analysis.md` §4 — Sentry odroczone).

### Brzegowe przypadki

- **Race condition w US-007 (dwie zakładki migrują równolegle):** trigger DB odrzuci drugi INSERT z `project_limit_exceeded`. Helper zwróci `MappedError`, UI zachowa `localStorage`.
- **Pusty `data` (np. nowy projekt z UI):** `shapes: []`, `weldUnits: []` jest poprawne (`jsonb_typeof = 'array'` przechodzi).
- **`schemaVersion: 0` lub null:** trigger `sync_schema_version_from_data` użyje `COALESCE(..., 1)`. Preflight odrzuci null/missing zanim dotrze do bazy.

## 8. Performance Considerations

1. **Single round-trip** — INSERT + RETURNING (`select().single()`) w jednym wywołaniu PostgREST. Brak czytania osobno po INSERT.
2. **Brak N+1** — endpoint dotyka jednego wiersza; trigger Free-limit czyta jeden wiersz `user_profiles` + COUNT na partial indexie `documents(owner_id) WHERE plan = 'free'` (jeśli zdefiniowany w db-plan; sprawdzić). Jeden INSERT bez potencjalnych pętli.
3. **Payload preflight** — odrzucenie >5 MB po stronie klienta przed wysłaniem oszczędza pasmo i RTT (krytyczne na mobile).
4. **JSONB serialization** — Supabase JS automatycznie serializuje obiekty `data`, ale `JSON.stringify` jest synchroniczny i może zablokować main thread przy dużych scenach (~5 MB). Rozważyć `requestIdleCallback` lub Web Worker dla preflight w post-MVP; w MVP pomijalne.
5. **Trigger overhead** — dwa BEFORE INSERT triggery są tanie (każdy < 1 ms): jeden COUNT z indeksem, drugi SET kolumny. Brak wpływu na latency.
6. **Brak caching** — POST nie korzysta z cache; nowy dokument musi być widoczny natychmiast w liście (`useDocumentsList()` powinien zrobić `mutate()` lub optimistic update po sukcesie).
7. **Migracja gościa (US-007)** — pojedyncze wywołanie z payloadem do 5 MB; akceptowalne RTT < 500 ms na fra1 → EU-Frankfurt.

## 9. Implementation Steps

### Krok 1 — Zaimplementuj `src/lib/supabase/errors.ts` (preprequisite, TODO z `api-plan.md` §9)

Stwórz plik z pełnym `BusinessError` enum, `MappedError` interface, oraz `mapPostgrestError(err)` i `mapAuthError(err)`. Cały szkic jest w `api-plan.md` §9 (linie ~1446-1541) — przepisz 1:1.

Ten krok jest blokujący dla wszystkich endpointów dokumentów; CLAUDE.md odnotowuje że plik nie istnieje (`Project: backend implementation gaps`).

### Krok 2 — Stwórz helper-serwis `src/lib/supabase/documents.ts`

Plik nie istnieje (CLAUDE.md). Eksportuj funkcję `createDocument`:

```typescript
// src/lib/supabase/documents.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type {
  CreateDocumentCommand,
  DocumentDto,
  CanvasDocument,
} from '@/types/api';
import { mapPostgrestError, BusinessError, type MappedError } from './errors';

const MAX_NAME_LENGTH = 100;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

interface CreateResult {
  data: DocumentDto | null;
  error: MappedError | null;
}

export async function createDocument(
  supabase: SupabaseClient<Database>,
  command: CreateDocumentCommand
): Promise<CreateResult> {
  // 1. Preflight: nazwa
  const trimmedName = command.name.trim();
  if (trimmedName.length === 0 || trimmedName.length > MAX_NAME_LENGTH) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_NAME_INVALID,
        message: 'errors.document_name_invalid',
      },
    };
  }

  // 2. Preflight: kształt CanvasDocument
  if (
    typeof command.data?.schemaVersion !== 'number' ||
    !Array.isArray(command.data?.shapes) ||
    !Array.isArray(command.data?.weldUnits)
  ) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_DATA_SHAPE_INVALID,
        message: 'errors.document_data_shape_invalid',
      },
    };
  }

  // 3. Preflight: rozmiar payloadu
  const serialized = JSON.stringify(command.data);
  if (serialized.length >= MAX_PAYLOAD_BYTES) {
    return {
      data: null,
      error: {
        business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE,
        message: 'errors.document_payload_too_large',
      },
    };
  }

  // 4. Pobierz userId z sesji
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      data: null,
      error: { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' },
    };
  }

  // 5. INSERT
  const { data, error } = await supabase
    .from('documents')
    .insert({
      owner_id: user.id,
      name: trimmedName,
      data: command.data as unknown as Json,
    })
    .select('id, name, schema_version, data, created_at, updated_at')
    .single();

  if (error) return { data: null, error: mapPostgrestError(error) };

  return {
    data: {
      id: data.id,
      name: data.name,
      schema_version: data.schema_version,
      data: data.data as unknown as CanvasDocument,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
    error: null,
  };
}
```

Notki:
- Helper jest izomorficzny (działa z każdym wariantem `SupabaseClient<Database>` — browser, server, admin). Komponent decyduje który klient wstrzyknąć.
- Nie eksponuje `owner_id` w zwracanym DTO — zgodnie z `DocumentDto`.
- `data: command.data as unknown as Json` — wymuszenie kompatybilności z generowanym `Json` typem (CanvasDocument jest strukturalnie zgodny, ale TS wymaga jawnego rzutowania).

### Krok 3 — Stwórz hook `useCreateDocument` (UI-side)

W `src/lib/supabase/documents.ts` (lub osobnym `src/lib/supabase/useCreateDocument.ts`) dodaj hook React do użycia w komponentach:

```typescript
'use client';
import { useState } from 'react';
import { createClient } from './client';
import { createDocument } from './documents';
import type { CreateDocumentCommand, DocumentDto } from '@/types/api';
import type { MappedError } from './errors';

export function useCreateDocument() {
  const [pending, setPending] = useState(false);
  const supabase = createClient();

  async function mutate(
    command: CreateDocumentCommand
  ): Promise<{ data: DocumentDto | null; error: MappedError | null }> {
    setPending(true);
    try {
      return await createDocument(supabase, command);
    } finally {
      setPending(false);
    }
  }

  return { mutate, pending };
}
```

Ten hook dostarcza UI-side state (`pending`) używany do `disabled={pending}` na przycisku zgodnie z PR-checklistą `api-plan.md` §10 (idempotency przez UI guard).

### Krok 4 — Wywołanie z UI: New Project / Duplicate / Migration

#### 4a. Przycisk "Nowy projekt" (US-008)

```typescript
const { mutate, pending } = useCreateDocument();
const t = useTranslations();
const router = useRouter();
const locale = useLocale();

async function handleCreate() {
  const { data, error } = await mutate({
    name: t('documents.defaultName'),
    data: {
      schemaVersion: 1,
      canvasWidth: 2970,
      canvasHeight: 2100,
      shapes: [],
      weldUnits: [],
    },
  });

  if (error?.business === BusinessError.PROJECT_LIMIT_EXCEEDED) {
    toast.error(t('errors.project_limit_exceeded'));
    showUpgradeModal();
    return;
  }
  if (error) {
    toast.error(t(error.message));
    return;
  }
  router.push(`/${locale}/canvas/${data!.id}`);
}
```

#### 4b. Migracja gościa (US-007 — Locale Guard / sign-in callback)

W komponencie `LocaleGuard` (lub `[locale]/layout.tsx`) po pomyślnym `auth.getUser()` i przed renderowaniem dzieci:

```typescript
const raw = localStorage.getItem('welderdoc_autosave');
if (raw) {
  const autosave = JSON.parse(raw);
  const { data, error } = await createDocument(supabase, {
    name: t('documents.firstProjectName'),
    data: autosave.scene,
  });
  if (error) {
    if (error.business === BusinessError.PROJECT_LIMIT_EXCEEDED) {
      toast.error(t('errors.project_limit_exceeded'));
      showUpgradeModal();
    } else {
      toast.error(t(error.message));
    }
    // ZACHOWAJ localStorage — retry przy następnym wejściu
  } else {
    localStorage.setItem('welderdoc_migrated_at', new Date().toISOString());
    localStorage.removeItem('welderdoc_autosave');
  }
}
```

#### 4c. Duplikowanie dokumentu (US-012) — operacja dwuetapowa

```typescript
const { data: source } = await supabase.from('documents').select('*').eq('id', sourceId).single();
const { data, error } = await mutate({
  name: `${source.name} (kopia)`,
  data: source.data as CanvasDocument,
});
```

### Krok 5 — Guard 3-element dla Guest/Free w `ShapesSlice.addShape()`

To **nie** jest częścią helpera `documents.ts` — implementuje się w slice'ie store'a (TODO; CLAUDE.md odnotowuje że store nie jest jeszcze zaimplementowany). Reguła:

```typescript
// W src/store/shapesSlice.ts (TODO)
addShape: (shape) => {
  const isGuest = !get().userSession;
  const isFree = get().userPlan === 'free';
  if (isGuest || isFree) {
    const totalCount = get().shapes.length + get().weldUnits.length;
    if (totalCount >= 3) {
      // Toast + CTA upgrade — nie wykonuj insertu
      return;
    }
  }
  // ... kontynuuj
}
```

### Krok 6 — i18n keys w `src/messages/{pl,en}.json`

Dodaj sekcję `errors.*` z minimum:

- `errors.project_limit_exceeded`
- `errors.document_payload_too_large`
- `errors.document_name_invalid`
- `errors.document_data_shape_invalid`
- `errors.unauthorized`
- `errors.email_not_confirmed`
- `errors.network_error`
- `errors.unknown`

Oraz dla US-008/US-007:

- `documents.defaultName` (PL: "Nowy projekt", EN: "New project")
- `documents.firstProjectName` (PL: "Mój pierwszy projekt", EN: "My first project")

Wszystkie klucze zgodne z `api-plan.md` §9.3. Brakujący klucz = fallback w UI na `errors.unknown`.

### Krok 7 — Testy

#### 7a. Unit tests (`src/lib/supabase/documents.test.ts`)

- `createDocument` z pustą nazwą → `DOCUMENT_NAME_INVALID` bez round-trip do bazy.
- `createDocument` z nazwą >100 znaków → jw.
- `createDocument` z `data.schemaVersion = undefined` → `DOCUMENT_DATA_SHAPE_INVALID`.
- `createDocument` z `data.shapes = null` → `DOCUMENT_DATA_SHAPE_INVALID`.
- `createDocument` z payloadem >5 MB → `DOCUMENT_PAYLOAD_TOO_LARGE`.
- `createDocument` mock `auth.getUser()` zwraca `null` → `UNAUTHORIZED`.
- `createDocument` mock PostgREST zwraca `P0001 project_limit_exceeded` → `PROJECT_LIMIT_EXCEEDED`.
- `createDocument` happy path → zwraca `DocumentDto` bez `owner_id`.
- Coverage: musi spełnić progi 80/80/70/80 (lines/functions/branches/statements) z `vitest.config.ts`.

#### 7b. Unit tests (`src/lib/supabase/errors.test.ts`)

- `mapPostgrestError(null)` → `null`.
- `mapPostgrestError({ code: 'P0001', message: 'project_limit_exceeded ...' })` → `PROJECT_LIMIT_EXCEEDED`.
- `mapPostgrestError({ code: '23514', message: '... octet_length ...' })` → `DOCUMENT_PAYLOAD_TOO_LARGE`.
- itd. dla każdej gałęzi z §9.

#### 7c. E2E (`e2e/documents-create.spec.ts`)

- Sign-in jako Free user, kliknij "Nowy projekt" → URL zmienia się na `/canvas/<id>`, dokument widoczny w liście.
- Sign-in jako Free user który już ma 1 projekt → klik "Nowy projekt" → toast `errors.project_limit_exceeded` + modal upgrade.
- Guest → 3 kształty → próba dodania 4. → blokada client-side (zanim w ogóle dojdzie do create).

#### 7d. Visual regression (post-MVP)

Nie dotyczy — endpoint nie ma reprezentacji wizualnej.

### Krok 8 — Code review checklist

- Helper `createDocument` używa `mapPostgrestError`, nie `error.message.includes(...)`.
- Komponenty wywołujące helper sprawdzają `error.business === BusinessError.X`, nie `error.message`.
- US-007 zachowuje `localStorage.welderdoc_autosave` przy każdym błędzie INSERT (nie tylko `PROJECT_LIMIT_EXCEEDED`).
- US-007 zapisuje `welderdoc_migrated_at` PRZED `removeItem('welderdoc_autosave')`.
- Guard 3-element dla Guest/Free znajduje się w `ShapesSlice.addShape()`, nie w `documents.ts` (różne warstwy odpowiedzialności).
- Brak `import { createAdminClient }` w komponentach wywołujących `createDocument` — używamy wyłącznie sesyjnego klienta.
- `src/messages/{pl,en}.json` zawiera wszystkie nowe klucze i18n.
- Pre-commit hook (`lint-staged`) przechodzi bez `--no-verify`.
- Conventional Commit: `feat(documents): implement createDocument service + US-007 migration` (typ `feat`, scope `documents`).
