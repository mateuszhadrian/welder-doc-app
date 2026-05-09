# Endpoint
GET /rest/v1/documents

## Description
Lista projektów (dokumentów) zalogowanego użytkownika (US-008, US-010). Wywołanie przez Supabase JS SDK z PostgREST. Zwraca metadane (bez `data` blob — pełne dane przez `get-document-get-endpoint-data.md`).

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `documents`: `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`.
- Niepotwierdzeni użytkownicy nie zobaczą żadnych projektów.

## Request

### URL
```
GET /rest/v1/documents
  ?select=id,name,created_at,updated_at
  &owner_id=eq.{uid}
  &order=updated_at.desc
  &limit=50
  &offset=0
```

### SDK call
```typescript
const { data, error, count } = await supabase
  .from('documents')
  .select('id, name, created_at, updated_at', { count: 'exact' })
  .eq('owner_id', userId)
  .order('updated_at', { ascending: false })
  .range(offset, offset + limit - 1)
```

### Query Parameters
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `select` | string | nie | Lista kolumn (CSV) — defaultowo `*` |
| `owner_id=eq.{uid}` | string | nie* | Filtr po właścicielu (RLS i tak ogranicza) |
| `order` | string | nie | `updated_at.desc` (default), `name.asc`, `created_at.desc` |
| `limit` | int | nie | Domyślnie ustawiany przez klienta (np. 50) |
| `offset` | int | nie | Paginacja |

*RLS automatycznie filtruje po `auth.uid()`, ale eksplicytny filtr ułatwia debug.

## Response

### 200 OK
```json
[
  {
    "id": "uuid-...",
    "name": "Złącze T 1",
    "created_at": "2026-05-01T10:00:00Z",
    "updated_at": "2026-05-08T09:30:00Z"
  }
]
```

### Response Headers
- `Content-Range: 0-49/3` (offset-limit/total) — paginacja PostgREST przy `count: 'exact'`.

## Error Codes
- 401 — brak sesji (RLS odrzuca, klient SDK zwraca pustą listę bez sesji).
- 500 — błąd DB.

## Database Tables Involved

### `public.documents`
| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` |
| `owner_id` | `UUID` | `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `name` | `TEXT` | `NOT NULL`, `CHECK (length(trim(name)) > 0 AND length(name) <= 100)` |
| `data` | `JSONB` | `NOT NULL` (≤ 5 MB raw) — **NIE** zwracane w liście |
| `schema_version` | `INT` | `NOT NULL`, `DEFAULT 1` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` |

**Indeks:** `documents_owner_id_updated_at_idx (owner_id, updated_at DESC)` — hot-path dla listy projektów.

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

### 1. Klient wywołuje SDK z filtrem
- RLS odpowiada za izolację (nie trzeba dodawać `eq('owner_id', userId)` — RLS i tak filtruje, ale dodanie ułatwia czytelność).

### 2. Sortowanie (m3 — api-plan)
- Default: `order=updated_at.desc` (najświeższe edycje na górze).
- Możliwe: `order=name.asc` (alfabetycznie), `order=created_at.desc` (data utworzenia).

### 3. Paginacja
- `range(offset, offset + limit - 1)` w SDK.
- `count: 'exact'` zwraca total — nagłówek `Content-Range`.

## Validation Rules
- Brak walidacji wejścia (read-only).
- RLS automatycznie filtruje.

## Rate Limiting
- Brak osobnego limitu (workload niski — Free user = 1 projekt, Pro user ~50).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- **Nie wybierać `data`** w liście — duże blob'y (do 5 MB) niepotrzebnie obciążają query.
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
- Indeks `documents_owner_id_updated_at_idx` zapewnia szybki sort.
