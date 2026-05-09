# Endpoint
GET /rest/v1/documents?id=eq.{id}

## Description
Pobranie pełnych danych pojedynczego dokumentu (canvas + scena JSONB). Wywołanie przez Supabase JS SDK z PostgREST.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `documents`: `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`.

## Request

### URL
```
GET /rest/v1/documents
  ?id=eq.{id}
  &select=id,name,data,schema_version,created_at,updated_at
```

### SDK call
```typescript
const { data, error } = await supabase
  .from('documents')
  .select('id, name, data, schema_version, created_at, updated_at')
  .eq('id', documentId)
  .single()
```

### Query Parameters
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `id=eq.{id}` | string | tak | UUID dokumentu |
| `select` | string | nie | Lista kolumn (CSV) |

## Response

### 200 OK
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

## Error Codes
- 401 — brak sesji (klient SDK zwróci pusty rezultat).
- 406 — `single()` zwrócił 0 lub >1 rekordu (np. nieistniejące ID lub RLS odrzuciło).
- 500 — błąd DB.

## Database Tables Involved

### `public.documents`
| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY` |
| `owner_id` | `UUID` | RLS: musi być = `auth.uid()` |
| `name` | `TEXT` | `NOT NULL`, `CHECK (length(trim(name)) > 0 AND length(name) <= 100)` |
| `data` | `JSONB` | `NOT NULL`, `CHECK (jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array')`, `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` |
| `schema_version` | `INT` | `NOT NULL`, `DEFAULT 1` — sync z `data->>'schemaVersion'` |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` |

### Schema `data` (JSONB)
```typescript
{
  schemaVersion: number,
  canvasWidth: number,
  canvasHeight: number,
  shapes: Shape[],         // wewnętrzny model — registry-driven
  weldUnits: WeldUnit[]    // unit grouping (locked/sequence/detached)
}
```

### RLS Policy
```sql
CREATE POLICY documents_owner_all ON public.documents
  FOR ALL
  TO authenticated
  USING (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  );
```

## Business Logic

### 1. Klient pobiera dokument
- RLS sprawdza `owner_id = auth.uid()` i `email_confirmed_at IS NOT NULL`.
- `data` jest zwracany jako blob — klient deserializuje przez `documentCodec.ts` (jeszcze nie zaimplementowane, CLAUDE.md).

### 2. Migracja codec'a
- Klient czyta `schema_version` (lub `data.schemaVersion`).
- Jeśli `schema_version < N` (current codec version) → uruchamia runtime migrację `documentCodec.migrate()`.
- Indeks `documents_schema_version_idx (schema_version)` wspiera batch scan przy bumpie codec'a.

## Validation Rules
- Brak walidacji wejścia (read-only).

## Rate Limiting
- Brak osobnego limitu (workload niski).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- `data` JSONB — pojedynczy zapis projektu (nie partycjonowane per shape; atomowy odczyt).
- Self-describing JSON realizuje portability art. 20 RODO (export = dump kolumny `data`).
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
