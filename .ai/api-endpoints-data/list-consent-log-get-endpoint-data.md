# Endpoint
GET /rest/v1/consent_log?user_id=eq.{uid}

## Description
Pobranie historii zgód RODO użytkownika (TOS, PP, cookies). Wywołanie przez Supabase JS SDK z PostgREST. Append-only audit — INSERT wyłącznie przez `POST /api/consent`.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `consent_log`: SELECT/INSERT (`user_id = auth.uid()`); brak UPDATE/DELETE → append-only.

## Request

### URL
```
GET /rest/v1/consent_log
  ?user_id=eq.{uid}
  &select=consent_type,version,accepted,accepted_at
  &order=accepted_at.desc
```

### SDK call
```typescript
const { data: consentLog, error } = await supabase
  .from('consent_log')
  .select('consent_type, version, accepted, accepted_at')
  .eq('user_id', userId)
  .order('accepted_at', { ascending: false })
```

### Query Parameters
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `user_id=eq.{uid}` | string | nie* | Filtr (RLS i tak ogranicza) |
| `select` | string | nie | Lista kolumn |
| `order` | string | nie | `accepted_at.desc` (default — najświeższe na górze) |

## Response

### 200 OK
```json
[
  {
    "consent_type": "terms_of_service",
    "version": "1.0",
    "accepted": true,
    "accepted_at": "2026-01-01T00:00:00Z"
  },
  {
    "consent_type": "cookies",
    "version": "1.0",
    "accepted": false,
    "accepted_at": "2026-03-01T00:00:00Z"
  }
]
```

## Error Codes
- 401 — brak sesji.
- 500 — błąd DB.

## Database Tables Involved

### `public.consent_log`
Append-only audyt zgód RODO. Odwołanie zgody = nowy wiersz `accepted = FALSE`.

| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` |
| `user_id` | `UUID` | `NOT NULL`, `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `consent_type` | `TEXT` | `CHECK (consent_type IN ('terms_of_service','privacy_policy','cookies'))` |
| `version` | `TEXT` | `NOT NULL` |
| `accepted` | `BOOLEAN` | `NOT NULL` |
| `accepted_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` |
| `ip_address` | `INET` | nullable, anonimizowany przed INSERT (motyw 30 RODO) |
| `user_agent` | `TEXT` | nullable |

**Indeks:** `consent_log_user_id_type_accepted_at_idx (user_id, consent_type, accepted_at DESC)` — wyszukiwanie ostatniej decyzji per typ.

### RLS Policy
```sql
CREATE POLICY consent_log_select_authenticated ON public.consent_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY consent_log_insert_authenticated ON public.consent_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
```
Brak UPDATE/DELETE → strukturalnie append-only.

## Business Logic

### 1. Use cases
- **Strona ustawień prywatności**: pokaż historię zgód, ostatnią wersję per typ.
- **`GET /api/user/export`**: dołącza `consent_log` do eksportu RODO art. 20.
- **Audyt RODO art. 7 ust. 1**: każdej wartości `current_consent_version` w `user_profiles` odpowiada bundle wpisów w `consent_log`.

### 2. Reconstruction stanu zgód
- Najświeższy wiersz per `consent_type` = aktualny stan.
- Klient: `consentLog.find(c => c.consent_type === 'cookies')?.accepted`.

### 3. INSERT (write path) — przez `POST /api/consent`
- Bundle (rejestracja): atomowo TOS+PP+cookies + `current_consent_version` przez RPC `record_consent_bundle()`.
- Per-type (wycofanie): single INSERT przez klienta sesji + RLS.
- Patrz `consent-post-endpoint-data.md`.

## Validation Rules
- Brak walidacji wejścia (read-only).

## TypeScript types
```typescript
// supabase gen types mapuje INET na unknown — wrapper:
import type { Tables } from '@/types/database'
export type ConsentLogRow = Omit<Tables<'consent_log'>, 'ip_address'> & { ip_address: string | null }
```
(db-plan §1.6 uwaga TypeScript)

## Rate Limiting
- Brak (read-only).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- Append-only: brak triggera `set_updated_at` (nie ma kolumny `updated_at`).
- `ip_address` zwracany jako string (PostgREST mapuje INET → string).
- Po RODO-delete (`auth.users` deleted) wpisy są kaskadowo usuwane (`ON DELETE CASCADE`).
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
