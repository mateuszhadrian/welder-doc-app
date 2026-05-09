# API Endpoint Implementation Plan: PATCH /rest/v1/user_profiles?id=eq.{uid} (Update User Profile)

## 1. Endpoint Overview

Aktualizacja ustawień użytkownika w tabeli `public.user_profiles` (US-050 — zmiana locale `pl`/`en`). Wywołanie odbywa się **bezpośrednio przez Supabase JS SDK** z poziomu klienta — **brak dedykowanego Route Handlera Next.js**. PostgREST tłumaczy zapytanie na PATCH SQL na zwykłej tabeli; RLS zapewnia, że użytkownik aktualizuje wyłącznie własny rekord.

Klucz architektoniczny:

- **Wszystkie wywołania PATCH `user_profiles` MUSZĄ przechodzić przez wrapper `updateProfile()` z `src/lib/supabase/profile.ts`.** Wrapper:
  1. statycznie ogranicza pola do `SafeUpdate` (TS odfiltrowuje `plan`, `paddle_customer_id`, `current_consent_version`);
  2. runtime'owo usuwa protected keys (defense-in-depth na wypadek dynamicznego budowania patcha);
  3. ustawia `eq('id', userId).select().single()` i zwraca `{ data: UserProfileDto, error: PostgrestError }`.
- **Bezpośrednie `supabase.from('user_profiles').update(...)`** w komponentach jest **zabronione** (architecture invariant w `CLAUDE.md`).
- Trigger DB `block_protected_columns_update` jest defense-in-depth — primary guard to typ `SafeUpdate` + filtr w wrapperze.

Uzależnienia (oba "TODO" w `CLAUDE.md`):

- `src/lib/supabase/errors.ts` — `BusinessError` enum + `mapPostgrestError(err)` (api-plan.md §9).
- `src/lib/supabase/profile.ts` — sam wrapper (api-plan.md §2.2).

Po sukcesie zmiany `locale` klient odpowiada za:

1. zapisanie cookie `NEXT_LOCALE=<newLocale>; path=/; max-age=31536000; samesite=lax`;
2. (opcjonalnie) zapisanie `localStorage.welderdoc_locale_preference`;
3. nawigację na ścieżkę z nowym prefiksem (`router.replace('/' + newLocale + ...)`),

aby uniknąć round-tripu redirectu w `LocaleGuard`.

## 2. Request Details

- **HTTP Method:** `PATCH`
- **URL Structure (PostgREST, transparentne dla klienta):** `PATCH /rest/v1/user_profiles?id=eq.{uid}`
  - Klient wywołuje SDK; PostgREST sam buduje URL z `.from('user_profiles').update(...).eq('id', userId)`.
- **Headers (ustawiane przez SDK):**
  - `Content-Type: application/json`
  - `Prefer: return=representation` (gdy używamy `.select()`)
  - `apikey: <anon>` + `Authorization: Bearer <user JWT>` (z cookies / sesji)

### Parameters

- **Required:**
  - `userId` (`string` UUID) — przekazywany do wrappera; musi być równy `auth.uid()` aktywnej sesji (RLS odrzuci w przeciwnym razie).
- **Optional (w body):**
  - `locale` (`'pl' | 'en'`) — jedyne dozwolone pole w MVP zgodnie z `UpdateProfileCommand`.

### Request Body

Wrapper przyjmuje typ `SafeUpdate`:

```typescript
// src/lib/supabase/profile.ts
import type { TablesUpdate } from '@/types/database';

const PROTECTED_FIELDS = [
  'plan',
  'paddle_customer_id',
  'current_consent_version',
] as const;
type ProtectedField = (typeof PROTECTED_FIELDS)[number];

type UserProfileUpdate = TablesUpdate<'user_profiles'>;
export type SafeUpdate = Omit<UserProfileUpdate, ProtectedField>;
```

Aktualnie w MVP `SafeUpdate` zawęża się efektywnie do `{ locale?: 'pl' | 'en' }` (ID nie powinno się aktualizować; `created_at`/`updated_at` są systemowe).

Przykład wywołania klienckiego:

```typescript
import { updateProfile } from '@/lib/supabase/profile';

const { data, error } = await updateProfile(userId, { locale: 'en' });
```

## 3. Used Types

Już istniejące w `src/types/`:

- `UserProfileDto` (`src/types/api.ts`) — DTO odpowiedzi.
- `UpdateProfileCommand` (`src/types/api.ts`) — `Pick<TablesUpdate<'user_profiles'>, 'locale'>`; preferowany typ argumentu na warstwie komponentów.
- `AppLocale` (`src/types/api.ts`) — `'pl' | 'en'`.
- `TablesUpdate<'user_profiles'>` (`src/types/database.ts`) — bazowy typ generowany z DB.
- `Tables<'user_profiles'>` — Row do mapowania błędów / odpowiedzi.

Do utworzenia wewnątrz `src/lib/supabase/profile.ts`:

- `PROTECTED_FIELDS` — `readonly` tuple chronionych kolumn.
- `SafeUpdate` — `Omit<UserProfileUpdate, ProtectedField>`.
- (opcjonalnie) `UpdateProfileResult` — `{ data: UserProfileDto | null; error: BusinessError | null }` jeśli zdecydujemy się ujednolicić zwracany kształt z `mapPostgrestError`.

Do utworzenia w `src/lib/supabase/errors.ts` (zależność, opisana osobno w planie tego pliku):

- `BusinessError` enum — przynajmniej `UNAUTHORIZED`, `PROFILE_LOCALE_INVALID`, `INTERNAL_ERROR`.
- `mapPostgrestError(err: PostgrestError | null): { business: BusinessError; message: string } | null`.

## 4. Response Details

### 200 OK

Body — pełny rekord użytkownika (efekt `.select().single()`):

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

Mapowanie do `UserProfileDto`. `paddle_customer_id` nie jest wybierany przez DTO i nie powinien być eksponowany do UI.

### Status codes

| Status | Sytuacja                                                                   |
| ------ | -------------------------------------------------------------------------- |
| `200`  | Sukces — wiersz zwrócony przez `Prefer: return=representation`.            |
| `400`  | Naruszenie `CHECK (locale IN ('pl','en'))` (`PostgrestError.code = 23514`).|
| `401`  | Brak sesji / wygasły JWT — RLS odrzuca, PostgREST zwraca błąd autoryzacji. |
| `403`  | RLS odrzuca (np. `id != auth.uid()`) — Supabase mapuje na 403/406.         |
| `500`  | Inne błędy DB / sieciowe — `BusinessError.INTERNAL_ERROR`.                  |

Wrapper zwraca surowy `PostgrestError` w `error`; warstwa wywołująca (komponent / hook) używa `mapPostgrestError()` do otrzymania `BusinessError` + i18n key.

## 5. Data Flow

```
Client component (Settings / LocaleSwitcher)
    │
    ▼
useTranslations('errors') + form state
    │
    ▼
updateProfile(userId, { locale })   ── src/lib/supabase/profile.ts
    │  1. (dev) console.warn dla protected leak
    │  2. odfiltrowanie protected keys (runtime)
    │  3. early-return jeśli `safe` jest pusty
    │  4. createClient()  ── @supabase/ssr (browser)
    │
    ▼
supabase.from('user_profiles')
        .update(safe)
        .eq('id', userId)
        .select()
        .single()
    │
    ▼  HTTPS PATCH /rest/v1/user_profiles?id=eq.<uid>
PostgREST
    │
    ▼  SQL: UPDATE public.user_profiles SET locale=$1 WHERE id=$2 RETURNING *
Postgres
    ├── BEFORE UPDATE: user_profiles_before_update_block_protected
    │     ├── current_user='postgres' lub auth.role()='service_role' → bypass
    │     └── inaczej: NEW.plan/NEW.paddle_customer_id/NEW.current_consent_version := OLD.<col>
    ├── BEFORE UPDATE: user_profiles_before_update_set_updated_at
    │     └── NEW.updated_at := now()
    ├── CHECK (locale IN ('pl','en'))   ── 23514 jeśli niepoprawne
    └── RLS: USING (id = auth.uid()) AND WITH CHECK (id = auth.uid())
    │
    ▼ Row zwrócony jako JSON
Wrapper zwraca { data: UserProfileDto, error: PostgrestError | null }
    │
    ▼
Komponent:
    1. error → mapPostgrestError → toast / inline błąd (i18n key)
    2. sukces (locale change) → set NEXT_LOCALE cookie → router.replace(`/${locale}${rest}`)
```

## 6. Security Considerations

1. **AuthN:** sesja Supabase czytana z cookies (`@supabase/ssr`). `createClient()` w browserze automatycznie dołącza JWT.
2. **AuthZ — RLS:** `user_profiles_update_authenticated FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid())`. Próba PATCH cudzego rekordu zwraca 403/406 — RLS jest **jedynym primary guardem** autoryzacji.
3. **Immutable columns — czterowarstwowa obrona:**
   - L1: typ `SafeUpdate` (kompilacja).
   - L2: runtime filter w `updateProfile()`.
   - L3: trigger `block_protected_columns_update` (cicho zeruje `NEW.col := OLD.col`, bez `RAISE`).
   - L4: lint rule `no-direct-user-profile-update` (post-MVP) — gwarantuje, że nikt nie obejdzie wrappera.
4. **CHECK constraint** `locale IN ('pl','en')` — DB last-line; wrapper i UI walidują wcześniej.
5. **Brak ekspozycji service-role key** — operacja działa w przeglądarce na anon key + JWT.
6. **Cookie `NEXT_LOCALE`** ustawiamy z `samesite=lax` (CSRF safe dla GET/HEAD nawigacji) i `max-age=31536000`. Nie ustawiamy `httpOnly` — middleware/`next-intl` musi czytać po stronie klienta i serwera.
7. **Rate limiting:** brak osobnego limitera (low-frequency operacja). Naturalna ochrona: RLS + JWT.
8. **Audit:** `updated_at` aktualizowany triggerem `set_updated_at()` — ślad czasu zmiany.

## 7. Error Handling

| # | Scenariusz                                                                 | Detekcja                                                                 | Mapowanie                                                                          | Reakcja UI                                                                                |
|---|----------------------------------------------------------------------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| 1 | Brak sesji / token wygasł                                                  | `error.code === 'PGRST301'` lub status 401                                | `BusinessError.UNAUTHORIZED` → i18n `errors.unauthorized`                          | Redirect do `/[locale]/sign-in?redirect=...`.                                              |
| 2 | RLS odrzuca (próba update cudzego `id`)                                    | `error` z 406/403; brak wiersza (`data === null`)                         | `BusinessError.UNAUTHORIZED` → `errors.unauthorized`                               | Toast „Brak uprawnień" + log telemetryczny (potencjalna manipulacja).                       |
| 3 | Niepoprawne `locale` (np. `'de'`)                                          | `error.code === '23514'`                                                  | `BusinessError.PROFILE_LOCALE_INVALID` → `errors.profile_locale_invalid`           | Inline błąd przy polu wyboru.                                                              |
| 4 | Patch zawiera tylko protected pola (po filtrze pusty)                      | Wrapper wykrywa pusty `safe`                                              | Brak żądania; zwraca `{ data: <currentProfile?>, error: null }` (no-op)            | (Opcjonalnie) `console.warn` w dev. UI może odświeżyć cache.                                |
| 5 | Sieć / 5xx PostgREST                                                       | `error` bez `code` lub status >= 500                                      | `BusinessError.INTERNAL_ERROR` → `errors.internal_error`                           | Toast retry + Sentry breadcrumb (gdy Sentry wjedzie).                                      |
| 6 | Próba zmiany protected pola (np. `plan`)                                   | TS — kompilacja. Runtime — trigger zeruje pole. `data` zwraca starą wartość. | Brak — silently dropped. Dev `console.warn` w wrapperze.                          | Brak — operacja kończy się sukcesem dla `locale`, jeśli był obecny.                        |

**Brak `error_log` w bazie** — nie zapisujemy błędów w tabeli; logowanie poprzez `console.error` + (post-MVP) Sentry.

## 8. Performance Considerations

- **Single round-trip**: `update + select + single` — jeden HTTP request.
- **Indeks na PK `user_profiles.id`** — UPDATE z `WHERE id = $1` jest O(1) w hash/B-Tree access.
- **Triggery BEFORE UPDATE** są tanie (kilka assignmentów); brak rekurencyjnych wywołań.
- **Empty patch shortcut**: wrapper przerywa, jeśli po filtracji obiekt jest pusty — eliminuje zbędny RTT.
- **Brak N+1**: pojedyncza tabela, brak relacji.
- **Cache UI**: po sukcesie warstwa stanu (np. Zustand `useUISlice` lub wprowadzony `userSlice`) powinna zaktualizować lokalnie `userProfile` zamiast ponownie pobierać.
- **Cookie + reload**: nawigacja po zmianie `locale` to `router.replace(...)` — nie pełen `window.location` reload; SSR i tłumaczenia zostaną przeładowane przez `next-intl`.

## 9. Implementation Steps

1. **Utwórz `src/lib/supabase/errors.ts`** (jeśli nie istnieje — zależność wspólna):
   - Eksportuj `BusinessError` (enum/const object) z minimum: `UNAUTHORIZED`, `PROFILE_LOCALE_INVALID`, `INTERNAL_ERROR`.
   - Eksportuj `mapPostgrestError(err: PostgrestError | null)` mapujący kody DB (`23514`, `PGRST301`, itd.) na `{ business, message }` (`message` = i18n key).
   - Eksportuj `mapAuthError(err)` (na potrzeby reszty stacku auth).
   - Pełny stub w `.ai/api-plan.md` §9 — odtwórz 1:1.

2. **Utwórz `src/lib/supabase/profile.ts`:**
   - Zaimportuj `createClient` z `./client` (wariant browser — patch wykonuje user-scoped klient z JWT).
   - Zdefiniuj `PROTECTED_FIELDS = ['plan','paddle_customer_id','current_consent_version'] as const`.
   - Zdefiniuj `type ProtectedField = (typeof PROTECTED_FIELDS)[number]`.
   - Zdefiniuj `type SafeUpdate = Omit<TablesUpdate<'user_profiles'>, ProtectedField>` i wyeksportuj.
   - Zaimplementuj `updateProfile(userId: string, patch: SafeUpdate)`:
     - W dev: `console.warn` jeżeli `Object.keys(patch)` zawiera protected key (przyszły, dynamicznie zbudowany patch).
     - Zbuduj `safe: Record<string, unknown>` przez kopiowanie kluczy spoza `PROTECTED_FIELDS`.
     - Jeżeli `Object.keys(safe).length === 0`, zwróć `{ data: null, error: null }` (no-op) bez round-tripu.
     - `return createClient().from('user_profiles').update(safe).eq('id', userId).select().single();`
   - Zwróć typ z `Promise<PostgrestSingleResponse<Tables<'user_profiles'>>>` (zgodny z native SDK), żeby konsument mógł użyć `mapPostgrestError`.

3. **Komponenty / hooki konsumujące** (do osobnych zadań — np. `LocaleSwitcher`, strona ustawień):
   - Importuj `updateProfile` (nigdy `supabase.from('user_profiles').update(...)`).
   - Po sukcesie: ustaw cookie `NEXT_LOCALE` (`document.cookie = ...; samesite=lax; max-age=31536000`).
   - Wykonaj `router.replace(\`/${newLocale}${pathname.replace(/^\\/(pl|en)/, '')}\`)`.
   - Na błąd: `mapPostgrestError(error)` → wyświetl `t(message)` w toaście / inline.

4. **Walidacja UI** (przed wywołaniem):
   - Restrict `locale` do `'pl' | 'en'` w typach formularza (radio/select z literałami).
   - Disable submitu, gdy `locale` nie zmienił się względem `userProfile.locale`.

5. **Testy jednostkowe (`src/lib/supabase/profile.test.ts`):**
   - **Test A — happy path:** mock `createClient`, weryfikuj, że `update` dostaje `{ locale: 'en' }` i `eq('id', userId)` jest wołane.
   - **Test B — protected leak runtime:** wywołaj `updateProfile(uid, { locale: 'en', plan: 'pro' } as unknown as SafeUpdate)`, oczekuj że `update` dostanie wyłącznie `{ locale: 'en' }`.
   - **Test C — empty patch shortcut:** `updateProfile(uid, { plan: 'pro' } as unknown as SafeUpdate)` zwraca `{ data: null, error: null }` bez wywołania `from(...)`.
   - **Test D — error propagacja:** mock zwraca `PostgrestError({ code: '23514' })` → wrapper przepuszcza; `mapPostgrestError` mapuje na `BusinessError.PROFILE_LOCALE_INVALID`.
   - **Test E — dev warning:** `process.env.NODE_ENV='development'` + protected key → `console.warn` wywołany 1×.

6. **Testy E2E (`e2e/locale-switch.spec.ts`):**
   - Zaloguj usera, przełącz locale z `pl` na `en` w UI.
   - Asercje: cookie `NEXT_LOCALE=en` ustawione, URL ma prefix `/en/`, kopia w UI w jęz. angielskim, GET `user_profiles` zwraca `locale: 'en'`.
   - (Negatywny) Wstrzyknij PATCH z `{ plan: 'pro' }` (poprzez konsolę / `page.evaluate`) — sprawdź, że plan **nie** zmienia się w wyniku.

7. **Linter / architecture invariants:**
   - Dodaj komentarz `// no-direct-user-profile-update` przy `updateProfile` jako miejsce-marker.
   - (Post-MVP) Reguła ESLint `no-restricted-syntax` blokująca `CallExpression[callee.property.name='from'][arguments.0.value='user_profiles'] >> CallExpression[callee.property.name='update']` poza `src/lib/supabase/profile.ts`.

8. **Synchronizacja z resztą flow:**
   - Po implementacji, `LocaleGuard` w `src/app/[locale]/layout.tsx` (osobny task) i tak musi sprawdzać `user_profiles.locale` i ewentualnie redirect — wrapper nie odpowiada za nawigację.
   - Pamiętaj, że trigger `block_protected_columns_update` ma bypass dla `current_user = 'postgres'` (RPC `record_consent_bundle` — `SECURITY DEFINER`), co zapewnia, że `POST /api/consent` może modyfikować `current_consent_version`. Ten endpoint **nie** korzysta z `updateProfile()`.

9. **Dokumentacja:**
   - Po wdrożeniu zaktualizuj sekcję "Currently implemented in `src/lib/`" w `CLAUDE.md`, przesuwając `supabase/profile.ts` (i `supabase/errors.ts`) z "Not yet implemented" do "implemented".

10. **Code review checklist:**
    - Czy żaden komponent nie woła `supabase.from('user_profiles').update(...)`?
    - Czy `SafeUpdate` jest jedynym dozwolonym typem patcha?
    - Czy konsument mapuje błędy przez `mapPostgrestError` zamiast `error.message.includes(...)`?
    - Czy cookie `NEXT_LOCALE` jest ustawione przed `router.replace` (bez tego pojawi się dodatkowy redirect przez `LocaleGuard`)?
