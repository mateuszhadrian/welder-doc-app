# Endpoint
PATCH /rest/v1/user_profiles?id=eq.{uid}

## Description
Aktualizacja ustawień użytkownika (US-050 — locale). Wywołanie przez Supabase JS SDK z PostgREST. Klient powinien używać wrappera `updateProfile()` z `src/lib/supabase/profile.ts` (M3) — TypeScript wymusza filtrowanie protected fields.

## Authentication / Authorization
- Aktywna sesja Supabase (`authenticated`).
- RLS na `user_profiles`: `id = auth.uid()` (USING + WITH CHECK).

## Request

### URL
```
PATCH /rest/v1/user_profiles?id=eq.{uid}
Content-Type: application/json
Prefer: return=representation
```

### SDK call (przez wrapper — zalecane)
```typescript
import { updateProfile } from '@/lib/supabase/profile'
const { data, error } = await updateProfile(userId, { locale: 'en' })
```

### SDK call (raw — niezalecane)
```typescript
const { data, error } = await supabase
  .from('user_profiles')
  .update({ locale: 'en' })
  .eq('id', userId)
  .select()
  .single()
```

### Body Schema
| Pole | Typ | Wymagane | Reguła |
|---|---|---|---|
| `locale` | `'pl' \| 'en'` | nie | `CHECK (locale IN ('pl','en'))` |
| `plan` | `text` | NIE NIGDY | **Chronione** triggerem `block_protected_columns_update` — silently ignored |
| `paddle_customer_id` | `text` | NIE NIGDY | **Chronione** — silently ignored |
| `current_consent_version` | `text` | NIE NIGDY | **Chronione** — wyłączny writer to `POST /api/consent` (RPC `record_consent_bundle`) |

### Wrapper `updateProfile()` (src/lib/supabase/profile.ts)
```typescript
const PROTECTED_FIELDS = ['plan', 'paddle_customer_id', 'current_consent_version'] as const
type SafeUpdate = Omit<UserProfileUpdate, typeof PROTECTED_FIELDS[number]>

export async function updateProfile(userId: string, patch: SafeUpdate) {
  if (process.env.NODE_ENV === 'development') {
    const leak = Object.keys(patch).filter((k) => (PROTECTED_FIELDS as readonly string[]).includes(k))
    if (leak.length > 0) console.warn(`[updateProfile] Protected fields silently dropped: ${leak.join(', ')}`)
  }
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!(PROTECTED_FIELDS as readonly string[]).includes(k)) safe[k] = v
  }
  return createClient().from('user_profiles').update(safe).eq('id', userId).select().single()
}
```

## Response

### 200 OK
```json
{
  "id": "uuid-...",
  "plan": "free",
  "locale": "en",
  "current_consent_version": "1.0",
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-05-08T12:00:00Z"
}
```

## Error Codes
| Kod | Code DB | Powód | Mapowanie |
|---|---|---|---|
| 400 | `23514` | `CHECK (locale IN ('pl','en'))` | `BusinessError.PROFILE_LOCALE_INVALID` → `errors.profile_locale_invalid` |
| 401/403 | — | RLS odrzuca | `BusinessError.UNAUTHORIZED` |

## Database Tables Involved

### `public.user_profiles`
| Kolumna | Typ | Ograniczenia |
|---|---|---|
| `locale` | `TEXT` | `CHECK (locale IN ('pl','en'))`, `DEFAULT 'pl'` |
| `plan` | `TEXT` | `CHECK (plan IN ('free','pro'))` — chronione |
| `paddle_customer_id` | `TEXT` | `UNIQUE` — chronione |
| `current_consent_version` | `TEXT` | chronione |
| `updated_at` | `TIMESTAMPTZ` | Trigger `user_profiles_before_update_set_updated_at` |

### Triggers (BEFORE UPDATE)
**Kolejność alfabetyczna (db-plan §5.7):**
1. **`user_profiles_before_update_block_protected`** — funkcja `block_protected_columns_update()`:
   - Bypass 1: `current_user = 'postgres'` (np. `record_consent_bundle()`, `refresh_user_plan_from_subscriptions()`, `sync_paddle_customer()` — wszystkie `SECURITY DEFINER`).
   - Bypass 2: `auth.role() = 'service_role'` (defensywny `COALESCE(auth.role(), 'anon')`).
   - W innym przypadku: zeruje zmiany pól `plan`, `paddle_customer_id`, `current_consent_version` (`NEW.col := OLD.col`) — bez `RAISE EXCEPTION`, by aplikacja mogła swobodnie aktualizować `locale`.
2. **`user_profiles_before_update_set_updated_at`** — wspólna `set_updated_at()`.

### RLS Policy
```sql
CREATE POLICY user_profiles_update_authenticated ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
```

## Business Logic

### 1. Update `locale` (US-050)
- Klient PATCH `{ locale: 'en' }`.
- Trigger blokujący nie reaguje (locale nie jest chroniony).
- Po sukcesie klient musi:
  1. Ustawić cookie: `document.cookie = 'NEXT_LOCALE=' + newLocale + '; path=/; max-age=31536000; samesite=lax'` (1 rok TTL).
  2. (Opcjonalnie) `localStorage.setItem('welderdoc_locale_preference', newLocale)` — fallback przed sign-in (architecture-base §17).
  3. `router.replace('/' + newLocale + pathname.replace(/^\/(pl|en)/, ''))` lub `window.location.href = ...` — przeładowanie z nowym locale w URL.
- Bez ustawienia cookie: layout root redirect zadziała, ale doda round-trip.

### 2. Próba zmiany protected field
- TypeScript blokuje statycznie (`SafeUpdate` typ).
- DB trigger cicho ignoruje (defense-in-depth).
- Wrapper `updateProfile()` filtruje + warning w dev.

### 3. Komponenty NIGDY nie wywołują `supabase.from('user_profiles').update(...)` bezpośrednio
- Zawsze przez `updateProfile()` (CLAUDE.md architecture invariants).
- Lint rule (post-MVP): `no-direct-user-profile-update`.

## Validation Rules
- `locale`: `'pl' | 'en'` (CHECK).
- `plan`, `paddle_customer_id`, `current_consent_version`: read-only dla `authenticated`.

## Rate Limiting
- Brak osobnego limitu (operacja niska-frequency).

## Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Implementation Notes
- Bezpośrednie wywołanie Supabase JS SDK — brak custom Route Handlera.
- Wrapper `src/lib/supabase/profile.ts` — **TODO niezaimplementowane** (CLAUDE.md "Not yet implemented").
- Trigger `block_protected_columns_update` jest defense-in-depth, nie primary guard — primary guard to `SafeUpdate` w TS + wrapper.
- `updated_at` aktualizowany triggerem.
- Error mapping: `mapPostgrestError` z `src/lib/supabase/errors.ts` (TODO).
