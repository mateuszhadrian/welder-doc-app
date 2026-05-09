# Endpoint
GET /rest/v1/user_profiles?id=eq.{uid}

## Description
Pobranie profilu użytkownika (plan, locale, wersja zgody). Wywołanie przez Supabase JS SDK z PostgREST.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `user_profiles`: `id = auth.uid()`.

## Request

### URL
```
GET /rest/v1/user_profiles
  ?id=eq.{uid}
  &select=id,plan,locale,current_consent_version,created_at,updated_at
```

### SDK call
```typescript
const { data: profile, error } = await supabase
  .from('user_profiles')
  .select('id, plan, locale, current_consent_version, created_at, updated_at')
  .eq('id', userId)
  .single()
```

### Query Parameters
| Pole | Typ | Wymagane | Opis |
|---|---|---|---|
| `id=eq.{uid}` | string | tak | UUID usera (= `auth.uid()`) |
| `select` | string | nie | Lista kolumn |

## Response

### 200 OK
```json
{
  "id": "uuid-...",
  "plan": "free",
  "locale": "pl",
  "current_consent_version": "1.0",
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-05-08T09:00:00Z"
}
```

## Error Codes
| Kod | Powód |
|---|---|
| 401 | brak sesji |
| 406 | `single()` zwrócił 0/>1 rekordów |
| 500 | błąd DB |

## Database Tables Involved

### `public.user_profiles`
| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `id` | `UUID` | `PRIMARY KEY`, `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `plan` | `TEXT` | `NOT NULL`, `DEFAULT 'free'`, `CHECK (plan IN ('free','pro'))` |
| `paddle_customer_id` | `TEXT` | `UNIQUE`, nullable |
| `current_consent_version` | `TEXT` | nullable |
| `locale` | `TEXT` | `NOT NULL`, `DEFAULT 'pl'`, `CHECK (locale IN ('pl','en'))` |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` |

### RLS Policy
```sql
CREATE POLICY user_profiles_select_authenticated ON public.user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());
```

## Business Logic

### Kiedy używać cache (`user_profiles.plan`) vs RPC `effective_plan()`
- **Standardowo**: odczytuj `user_profiles.plan` (cache aktualizowany przez triggery DB) — wystarczy przy starcie sesji i nawigacji.
- **RPC `effective_plan(uid)`**: wywołuj wyłącznie po powrocie ze strony płatności Paddle (gdy webhook mógł jeszcze nie dotrzeć) lub gdy podejrzewasz desynchronizację. Patrz `effective-plan-rpc-post-endpoint-data.md`.

### Use cases
1. **Bootstrap aplikacji**: po sign-in pobierz profil, ustaw store, zdecyduj o redirect (locale) i consent re-check.
2. **Plan check**: `useUserProfile().plan === 'pro'` przed feature-gated akcjami.
3. **Locale guard**: `[locale]/layout.tsx` używa `user_profiles.locale` jako autorytatywnego źródła.
4. **Consent re-check**: `current_consent_version` porównywane z aktualną wersją TOS/PP.

## Validation Rules
- Brak walidacji wejścia (read-only).

## Rate Limiting
- Brak (operacja read po PK, indeks `user_profiles_pkey`).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- 1 wiersz per user (PK = `auth.users.id`).
- Profile tworzone automatycznie triggerem `on_auth_user_created` (funkcja `handle_new_user()`) przy `signUp`.
- Pola chronione (`plan`, `paddle_customer_id`, `current_consent_version`) są **read-only** dla `authenticated` przez trigger `block_protected_columns_update` — patrz `update-user-profile-patch-endpoint-data.md`.
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
