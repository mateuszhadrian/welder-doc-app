# Endpoint
POST /rest/v1/documents

## Description
Utworzenie nowego dokumentu (US-008). Wywołanie przez Supabase JS SDK z PostgREST. Trigger DB egzekwuje limit Free=1 projektu.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `documents`: `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL` (USING + WITH CHECK).
- Niepotwierdzeni użytkownicy nie zapiszą projektu.

## Request

### URL
```
POST /rest/v1/documents
Content-Type: application/json
Prefer: return=representation
```

### SDK call
```typescript
const { data, error } = await supabase
  .from('documents')
  .insert({
    owner_id: userId,
    name: 'Nowy projekt',
    data: {
      schemaVersion: 1,
      canvasWidth: 2970,
      canvasHeight: 2100,
      shapes: [],
      weldUnits: []
    }
  })
  .select()
  .single()
```

### Body Schema
| Pole | Typ | Wymagane | Reguła |
|---|---|---|---|
| `owner_id` | `UUID` | tak | Musi być = `auth.uid()` (RLS WITH CHECK) |
| `name` | `string` | tak | Niepusty po trim, max 100 znaków |
| `data` | `JSONB` | tak | Object z kluczami `schemaVersion`, `shapes` (array), `weldUnits` (array); ≤ 5 MB raw |
| `schema_version` | `int` | nie | Auto-sync z `data->>'schemaVersion'` przez trigger |
| `share_token`, `share_token_expires_at` | `text`, `TIMESTAMPTZ` | nie | Rezerwacja post-MVP |

## Response

### 201 Created
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
  "created_at": "2026-05-08T12:00:00Z",
  "updated_at": "2026-05-08T12:00:00Z"
}
```

## Error Codes
| Kod | Code DB | Powód | Mapowanie |
|---|---|---|---|
| 500 | `P0001` | `RAISE EXCEPTION 'project_limit_exceeded'` (trigger `check_free_project_limit`) | `BusinessError.PROJECT_LIMIT_EXCEEDED` → `errors.project_limit_exceeded` |
| 400 | `23514` | `octet_length` (>5 MB) | `BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE` |
| 400 | `23514` | `length(trim(name))` lub `length(name)` | `BusinessError.DOCUMENT_NAME_INVALID` |
| 400 | `23514` | `jsonb_typeof` | `BusinessError.DOCUMENT_DATA_SHAPE_INVALID` |
| 401 | — | brak sesji | `BusinessError.UNAUTHORIZED` |
| 403 | — | RLS odrzuca (np. `owner_id ≠ auth.uid()` lub niepotwierdzony email) | (PostgREST 401/403) |

## Database Tables Involved

### `public.documents`
| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` |
| `owner_id` | `UUID` | `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `name` | `TEXT` | `NOT NULL`, `CHECK (length(trim(name)) > 0 AND length(name) <= 100)` |
| `data` | `JSONB` | `NOT NULL`, `CHECK (jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array')`, `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` |
| `schema_version` | `INT` | `NOT NULL`, `DEFAULT 1` |
| `share_token` | `TEXT` | `UNIQUE`, nullable |
| `share_token_expires_at` | `TIMESTAMPTZ` | nullable |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` |

### Triggers (BEFORE INSERT)
1. **`documents_before_iu_check_free_limit`** (BEFORE INSERT OR UPDATE OF `owner_id`):
   - Funkcja `check_free_project_limit()` (`SECURITY DEFINER`).
   - Rzuca `RAISE EXCEPTION 'project_limit_exceeded'` gdy `user_profiles.plan = 'free'` i istnieje już ≥ 1 wiersz dla `owner_id`.
2. **`documents_before_iu_sync_schema_version`** (BEFORE INSERT OR UPDATE OF `data`):
   - Funkcja `sync_schema_version_from_data()`.
   - `NEW.schema_version := COALESCE((NEW.data->>'schemaVersion')::int, NEW.schema_version, 1)`.

### RLS Policy
```sql
CREATE POLICY documents_owner_all ON public.documents
  FOR ALL TO authenticated
  USING (...)
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL)
  );
```

## Business Logic

### 1. Klient INSERT
- SDK wysyła POST z body.
- RLS WITH CHECK weryfikuje `owner_id = auth.uid()` + email confirmed.

### 2. Trigger `check_free_project_limit`
- Plan `free` + ≥1 projekt → `project_limit_exceeded`.
- Klient mapuje przez `error.message.includes('project_limit_exceeded')` → toast z CTA upgrade.

### 3. Trigger `sync_schema_version_from_data`
- Auto-aktualizuje kolumnę `schema_version` z `data->>'schemaVersion'`.

### 4. Migracja gościa do chmury (US-007)
- Po pierwszym sign-in klient odczytuje `welderdoc_autosave` z localStorage.
- `INSERT INTO documents (owner_id, name, data)` z payloadem.
- Sukces → `localStorage.setItem('welderdoc_migrated_at', now())` PRZED `removeItem('welderdoc_autosave')`.
- Free user z błędem `project_limit_exceeded` → toast z upgrade CTA, **zachowaj** localStorage.

## Validation Rules

### Server-side (DB)
- `name`: `length(trim(name)) > 0 AND length(name) <= 100`.
- `data`: `jsonb_typeof(data) = 'object' AND data ? 'schemaVersion' AND jsonb_typeof(data->'shapes') = 'array' AND jsonb_typeof(data->'weldUnits') = 'array'`.
- `data` size: `octet_length(data::text) < 5 * 1024 * 1024`.
- Free plan: max 1 dokument (trigger).

### Client-side preflight
- `name.trim().length` ∈ [1, 100].
- `JSON.stringify(canvasDocument).length < 5 * 1024 * 1024`.
- `data.shapes.length + data.weldUnits.length ≤ 3` dla Guest/Free (US-005, client-side only — nie ma triggera DB).

## Rate Limiting
- Brak (workload niski — Free user = 1 projekt, Pro = ~50).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- Free=1 limit: trigger DB jest defense-in-depth obok client-side guard (chroni przed race condition dwu zakładek + bezpośrednim REST API).
- Limit 3 elementów Guest/Free — wyłącznie client-side w `ShapesSlice.addShape()`.
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
- Duplikowanie projektu (US-012): odczyt + INSERT (operacja dwuetapowa).
