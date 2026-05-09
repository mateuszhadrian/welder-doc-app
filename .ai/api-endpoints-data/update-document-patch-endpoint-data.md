# Endpoint
PATCH /rest/v1/documents?id=eq.{id}

## Description
Aktualizacja dokumentu — autosave sceny (US-009), zmiana nazwy (US-013), zmiana rozmiaru canvasu (US-014, read-modify-write). Wywołanie przez Supabase JS SDK z PostgREST.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `documents`: `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`.

## Request

### URL
```
PATCH /rest/v1/documents?id=eq.{id}
Content-Type: application/json
Prefer: return=representation
```

### SDK call (rename — US-013)
```typescript
const { data, error } = await supabase
  .from('documents')
  .update({ name: 'Nowa nazwa' })
  .eq('id', documentId)
  .select()
  .single()
```

### SDK call (autosave sceny — US-009)
```typescript
const { data, error } = await supabase
  .from('documents')
  .update({ data: canvasDocument })
  .eq('id', documentId)
  .select('id, name, updated_at')
  .single()
```

### SDK call (rozmiar canvasu — US-014, read-modify-write)
PostgREST nie wspiera atomic JSONB-merge w jednym żądaniu — wymagana sekwencja:
```typescript
// Krok 1: pobierz obecny blob
const { data: doc } = await supabase
  .from('documents')
  .select('data')
  .eq('id', documentId)
  .single()
if (!doc) throw new Error('not_found')

// Krok 2: zmodyfikuj canvas dimensions w pamięci
const updated = { ...doc.data, canvasWidth: 4000, canvasHeight: 3000 }

// Krok 3: PATCH całego blob'a
await supabase
  .from('documents')
  .update({ data: updated })
  .eq('id', documentId)
```
Race condition: między krokiem 1 a 3 inna zakładka może nadpisać `data`. W MVP akceptowalne (single-tab dominujący).

### Body Schema (PATCH partial)
| Pole | Typ | Reguła |
|---|---|---|
| `name` | `string` | Niepusty po trim, max 100 znaków |
| `data` | `JSONB` | Object z `schemaVersion`, `shapes` (array), `weldUnits` (array); ≤ 5 MB raw |
| `owner_id` | `UUID` | (Transfer projektu — uruchamia trigger limit Free) |

> **Nie należy zmieniać `id`, `created_at`, `updated_at` (trigger ustawia automatycznie), `schema_version` (sync z data).**

## Response

### 200 OK
```json
{
  "id": "uuid-...",
  "name": "Nowa nazwa",
  "data": { ... },
  "schema_version": 1,
  "updated_at": "2026-05-08T12:00:00Z"
}
```

## Error Codes
| Kod | Code DB | Powód | Mapowanie |
|---|---|---|---|
| 500 | `P0001` | `project_limit_exceeded` (przy zmianie `owner_id`) | `BusinessError.PROJECT_LIMIT_EXCEEDED` |
| 400 | `23514` | `octet_length` (>5 MB) | `BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE` |
| 400 | `23514` | `length(trim(name))` / `length(name)` | `BusinessError.DOCUMENT_NAME_INVALID` |
| 400 | `23514` | `jsonb_typeof` | `BusinessError.DOCUMENT_DATA_SHAPE_INVALID` |
| 401/403 | — | RLS odrzuca | `BusinessError.UNAUTHORIZED` |

## Database Tables Involved

### `public.documents`
| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `name` | `TEXT` | `CHECK (length(trim(name)) > 0 AND length(name) <= 100)` |
| `data` | `JSONB` | `CHECK (jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array')`, `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` |
| `schema_version` | `INT` | Sync trigger |
| `updated_at` | `TIMESTAMPTZ` | Trigger `documents_before_update_set_updated_at` |

### Triggers
1. **`documents_before_iu_sync_schema_version`** (BEFORE INSERT OR UPDATE OF `data`) — sync `schema_version`.
2. **`documents_before_iu_check_free_limit`** (BEFORE INSERT OR UPDATE OF `owner_id`) — limit Free przy transferze.
3. **`documents_before_update_set_updated_at`** — wspólna `set_updated_at()`.

### RLS Policy (USING + WITH CHECK)
```sql
USING (owner_id = auth.uid() AND email_confirmed)
WITH CHECK (owner_id = auth.uid() AND email_confirmed)
```

## Business Logic

### 1. Autosave (US-009)
- Klient debounce'uje (np. 1-2s) i wysyła PATCH z `data: canvasDocument`.
- Trigger sync `schema_version`.
- `updated_at` aktualizowany triggerem.

### 2. Rename (US-013)
- PATCH `{ name: ... }`.
- Walidacja: `length(trim(name))` ∈ [1, 100].

### 3. Resize canvas (US-014, m1)
- Pola `canvasWidth`/`canvasHeight` żyją wewnątrz `data` JSONB.
- Sekwencja read → modify → write (3 kroki, patrz wyżej).

### 4. Sortowanie listy dokumentów (m3)
- PostgREST `order` akceptuje dowolne pole z `select`: `?order=name.asc`, `?order=created_at.desc`.

## Validation Rules

### Server-side (DB CHECK + triggers)
- `name`: `length(trim(name)) > 0 AND length(name) <= 100`.
- `data`: jsonb_typeof + klucze + array + ≤ 5 MB.
- Free user przy zmianie `owner_id`: max 1 projekt.

### Client-side preflight
- `name.trim().length` ∈ [1, 100].
- `JSON.stringify(canvasDocument).length < 5 * 1024 * 1024` (m4).

## Rate Limiting
- Brak (autosave debounce po stronie klienta).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- Autosave: implementuj w `DocumentSlice` (jeszcze nie zaimplementowane, CLAUDE.md).
- localStorage autosave key: `welderdoc_autosave` (`{ schemaVersion, scene: CanvasDocument, history: HistoryEntry[], historyIndex, savedAt: ISO }`); fallback dla niezalogowanego usera.
- `QuotaExceededError` (localStorage): trim history do 50 entries, retry; druga porażka → toast „zalecamy save w chmurze".
- Optimistic concurrency (post-MVP): rozważyć `eq('updated_at', expected)` w PATCH.
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
