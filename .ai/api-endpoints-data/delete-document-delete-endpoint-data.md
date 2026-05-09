# Endpoint
DELETE /rest/v1/documents?id=eq.{id}

## Description
Usunięcie dokumentu (US-011). Wywołanie przez Supabase JS SDK z PostgREST.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `documents`: `owner_id = auth.uid() AND email_confirmed_at IS NOT NULL`.

## Request

### URL
```
DELETE /rest/v1/documents?id=eq.{id}
```

### SDK call
```typescript
const { error } = await supabase
  .from('documents')
  .delete()
  .eq('id', documentId)
```

### Query Parameters
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `id=eq.{id}` | string | tak | UUID dokumentu |

## Response

### 204 No Content
- Brak treści.

## Error Codes
| Kod | Powód |
|---|---|
| 401/403 | RLS odrzuca (`owner_id ≠ auth.uid()` lub niepotwierdzony email) |
| 500 | błąd DB |

## Database Tables Involved

### `public.documents`
| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY` |
| `owner_id` | `UUID` | RLS: musi być `= auth.uid()` |

### RLS Policy
```sql
CREATE POLICY documents_owner_all ON public.documents
  FOR ALL TO authenticated
  USING (owner_id = auth.uid() AND email_confirmed)
  WITH CHECK (owner_id = auth.uid() AND email_confirmed);
```

### Cascade
- Brak FK z `documents` do innych tabel — DELETE jest "leaf" operation.
- `auth.users → documents.owner_id` to `ON DELETE CASCADE` (RODO art. 17, ale to inne kierunek — przy delete usera).

## Business Logic

### 1. Klient DELETE
- SDK wysyła DELETE z filtrem `id=eq.{id}`.
- RLS sprawdza `owner_id = auth.uid()` i email confirmed.

### 2. UI flow (US-011)
- User klika „Usuń projekt" → confirmation modal.
- Po potwierdzeniu → DELETE.
- Sukces → usuń z store'a (Zustand) i z listy.

### 3. Free user — re-enable create
- Po usunięciu jedynego projektu, Free user może utworzyć nowy (trigger `check_free_project_limit` przepuści).

## Validation Rules
- Brak walidacji wejścia (idempotentne — nieistniejący ID też zwróci 204).

## Rate Limiting
- Brak (operacja niska-frequency, UI confirmation).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- Hard delete (RODO art. 17 — żadnego soft-delete'u w MVP).
- Idempotentne — DELETE nieistniejącego ID zwróci 204 bez błędu (PostgREST behavior).
- UI confirmation jest wymagany (operacja destrukcyjna).
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
