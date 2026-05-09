# API Endpoint Implementation Plan: Login (POST /auth/v1/token?grant_type=password)

> Reference materials: `.ai/api-endpoints-data/login-post-endpoint-data.md`, `.ai/api-plan.md` §1, §6, §9, `.ai/architecture-base.md` §17, `.ai/tech-stack.md` §7, `CLAUDE.md` (PR checklist for auth implementation).

## 1. Endpoint Overview

Logowanie użytkownika (US-002) realizowane jest **bez własnego Route Handlera** — UI wywołuje bezpośrednio Supabase Auth SDK (`supabase.auth.signInWithPassword(...)`). Endpoint `POST /auth/v1/token?grant_type=password` jest natywnym endpointem GoTrue (Supabase Auth) ukrytym za SDK; `@supabase/ssr` ustawia po sukcesie cookies `httpOnly` (`sb-access-token`, `sb-refresh-token`).

Cel zadania to:

1. Dostarczenie cienkiej warstwy w UI (Client Component formularza logowania) wywołującej SDK i mapującej błędy.
2. Domknięcie post-login flow w Server Componencie (locale-redirect + consent re-check) wymaganym przez `architecture-base.md` §17 i PR checklist w `CLAUDE.md`.
3. Zaimplementowanie brakującego helpera `src/lib/supabase/errors.ts` (`mapAuthError`, `BusinessError`) — bez niego UI traci typed mapping i wpada w `error.message.includes(...)` antywzorzec, który jest jawnie zakazany w `CLAUDE.md`.
4. Implementacja gościnnej migracji (US-007) zaraz po zalogowaniu, jeśli w `localStorage` istnieje `welderdoc_autosave`.

Dwa łańcuchy MUSZĄ działać razem, bo bez tego user z preferencją EN logujący się na `/pl/...` nie zostanie przekierowany, a user z `current_consent_version = NULL` wejdzie na canvas mimo braku zgody.

## 2. Request Details

- **HTTP Method:** `POST` (handled przez Supabase Auth, nie nasz Route Handler).
- **URL Structure:** `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password` (transparentne dla aplikacji — wywołane przez SDK).
- **Wywołanie z aplikacji:** `supabase.auth.signInWithPassword({ email, password })` z **Client Componentu** (formularz logowania `/[locale]/login/page.tsx` + `LoginForm.tsx`).
  - Klient: `createClient()` z `src/lib/supabase/client.ts` (browser client). Używamy go w UI, bo formularz jest interaktywny i potrzebuje bezpośredniej obsługi błędów + stanu loading.
  - **Nie** wolno wywoływać `signInWithPassword` z Server Componentu/Route Handlera dla głównego flow logowania — Server Component nie ma dostępu do reaktywnego stanu UI; cookies i tak są ustawiane przez `@supabase/ssr` automatycznie z poziomu browser clienta.
- **Parameters:**
  - **Required (body):** `email` (string, format email), `password` (string, niepusty)
  - **Optional:** brak

### Request Body (przekazane do SDK)

```typescript
{
  email: 'user@example.com',
  password: 'MinimalneHaslo123'
}
```

### Walidacja po stronie klienta (przed wywołaniem SDK)

- `email`: niepusty string + regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`); SDK i tak zwróci `Invalid login credentials` przy złym formacie, ale wczesna walidacja oszczędza round-trip i daje lepszy UX.
- `password`: `length >= 1` (klient nie egzekwuje minimum dla loginu — to robi się tylko przy rejestracji).

## 3. Used Types

**Z `src/types/api.ts` (już istnieją):**

- `AppLocale` — `'pl' | 'en'`, używany przy locale redirect.
- `UserProfileDto` — przy fetch `user_profiles` (locale, `current_consent_version`) w post-login Server Componencie.
- (Domyślnie nie używamy `ApiErrorDto` — błędy logowania pochodzą z SDK, nie z naszego Route Handlera.)

**Do dodania w `src/lib/supabase/errors.ts` (TODO z `api-plan.md` §9):**

```typescript
import type { AuthError, PostgrestError } from '@supabase/supabase-js';

export enum BusinessError {
  // Auth (potrzebne natychmiast dla loginu)
  INVALID_CREDENTIALS = 'invalid_credentials',
  EMAIL_NOT_CONFIRMED = 'email_not_confirmed',
  EMAIL_ALREADY_REGISTERED = 'email_already_registered',
  PASSWORD_TOO_WEAK = 'password_too_weak',

  // Generic
  UNAUTHORIZED = 'unauthorized',
  RATE_LIMITED = 'rate_limited',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown',

  // (pozostałe enuma — Documents/Consent/Profile — z api-plan.md §9 zostaną
  // dodane przy implementacji odpowiednich endpointów; nie blokują loginu).
}

export interface MappedError {
  business: BusinessError;
  message: string; // i18n key
  rawCode?: string;
  rawMessage?: string;
}

export function mapAuthError(err: AuthError | null): MappedError | null;
export function mapPostgrestError(err: PostgrestError | null): MappedError | null;
```

**Lokalne typy w `LoginForm.tsx`:**

```typescript
interface LoginFormState {
  email: string;
  password: string;
  isSubmitting: boolean;
  error: MappedError | null;
}
```

## 4. Response Details

### Sukces — wartość zwrócona przez SDK

```typescript
const { data, error } = await supabase.auth.signInWithPassword({...});
// data = {
//   user: { id, email, email_confirmed_at, ... },
//   session: { access_token, refresh_token, expires_at, ... }
// }
```

- HTTP 200 z GoTrue.
- Cookies `httpOnly` ustawiane automatycznie: `sb-access-token` (TTL 1h), `sb-refresh-token` (TTL 1mc).
- Cookies są zarządzane przez `@supabase/ssr` (browser client) — niedostępne dla XSS.

### Po sukcesie (UI):

1. Klient sprawdza `welderdoc_autosave` w localStorage → jeśli istnieje, uruchamia migrację (patrz §5.3).
2. `router.replace('/[locale]/dashboard')` lub `next` z query param (`?next=/some/path`).
3. Server Component `[locale]/layout.tsx` (lub `LocaleGuard`) wykonuje **locale redirect + consent re-check** (patrz §5.4).

### Błędy — możliwe wartości `error.message` z SDK

| `error.message` (SDK) | Mapping w `mapAuthError` | UI prezentacja | HTTP (od GoTrue) |
|---|---|---|---|
| `Invalid login credentials` | `BusinessError.INVALID_CREDENTIALS` → klucz `errors.invalid_credentials` | Komunikat "Nieprawidłowy email lub hasło" — **NIE rozróżniaj**, czy email istnieje (security: enumeration). | 400 |
| `Email not confirmed` | `BusinessError.EMAIL_NOT_CONFIRMED` → `errors.email_not_confirmed` | Komunikat "Potwierdź email…" + link "Wyślij ponownie" (US wezwanie do `supabase.auth.resend(...)`). | 400 |
| Rate limit (np. `Too many requests`) | `BusinessError.RATE_LIMITED` → `errors.rate_limited` | Komunikat "Spróbuj ponownie za chwilę" + countdown jeśli możliwy. | 429 |
| Inne (network, 5xx) | `BusinessError.UNKNOWN` → `errors.unknown` | Generyczny błąd "Coś poszło nie tak". | 5xx |

## 5. Data Flow

### 5.1 Faza pre-submit (Client Component)

1. Użytkownik wpisuje email/hasło w `LoginForm` (`src/app/[locale]/login/`).
2. `onSubmit`: walidacja klienta → `setIsSubmitting(true)`.
3. `const supabase = createClient()` (browser).
4. `const { data, error } = await supabase.auth.signInWithPassword({ email, password })`.

### 5.2 Faza post-submit — error path

```typescript
if (error) {
  const mapped = mapAuthError(error);
  setError(mapped);
  setIsSubmitting(false);
  return;
}
```

UI renderuje `t(mapped.message)` (np. `t('errors.invalid_credentials')`) — wszystkie klucze `errors.*` muszą być w `src/messages/{pl,en}.json`. Brak klucza → fallback `t('errors.unknown')`.

### 5.3 Faza post-submit — guest migration (US-007)

```typescript
// pseudo-kod, lokalnie w LoginForm po sukcesie
const raw = localStorage.getItem('welderdoc_autosave');
if (raw) {
  try {
    const autosave = JSON.parse(raw); // { schemaVersion, scene, history, historyIndex, savedAt }
    const { error: insertError } = await supabase
      .from('documents')
      .insert({
        owner_id: data.user.id,
        name: t('documents.untitled_default'),
        data: autosave.scene,
      });
    if (!insertError) {
      localStorage.setItem('welderdoc_migrated_at', new Date().toISOString());
      localStorage.removeItem('welderdoc_autosave');
      toast.success(t('toasts.guest_migrated'));
    } else {
      // Trigger `check_free_project_limit` może zwrócić P0001 jeśli user
      // już ma 1 projekt na free planie. Nie blokuje loginu — user
      // zachowuje localStorage i widzi info "Zaloguj się żeby usunąć duplikat".
      const mapped = mapPostgrestError(insertError);
      if (mapped?.business === BusinessError.PROJECT_LIMIT_EXCEEDED) {
        toast.warning(t('toasts.guest_migration_limit'));
      } else {
        toast.error(t('errors.guest_migration_failed'));
      }
    }
  } catch {
    // Złamany JSON w localStorage — wyczyść, by nie próbować ponownie.
    localStorage.removeItem('welderdoc_autosave');
  }
}
```

> **Uwaga:** DB trigger `check_free_project_limit` (z migracji `20260507000000_complete_schema.sql`) zabezpiecza race condition (dwie zakładki). Migracja jest **best-effort** — nieudana migracja nie unieważnia logowania.

### 5.4 Faza post-submit — locale redirect + consent re-check (Server Component)

Po `router.replace('/[locale]/dashboard')` (lub `router.refresh()`), Next.js renderuje `[locale]/layout.tsx`. Layout musi:

1. `setRequestLocale(locale)` (zgodnie z `next-intl` v4 i `tech-stack.md` §5).
2. `const supabase = await createClient()` — server client (`src/lib/supabase/server.ts`); cookies są już ustawione przez SDK z 5.1.
3. `const { data: { user } } = await supabase.auth.getUser()` — ważne, by **`getUser()`**, nie `getSession()` — `getUser()` waliduje JWT z serwerem (RLS-safe).
4. Jeśli `!user` → `redirect('/[locale]/login')` (publiczna strona; nie wpadamy w pętlę bo login jest poza guarded routes).
5. Jeśli `user`, fetch profilu:
   ```typescript
   const { data: profile } = await supabase
     .from('user_profiles')
     .select('locale, current_consent_version')
     .eq('id', user.id)
     .single();
   ```
6. **Locale redirect:** `if (profile.locale !== params.locale) redirect(`/${profile.locale}${restOfPath}`)`.
7. **Consent re-check:** `if (!profile.current_consent_version || profile.current_consent_version < CURRENT_TOS_VERSION) redirect('/[locale]/consent-required')`. Stała `CURRENT_TOS_VERSION` zdefiniowana w `src/lib/consent/version.ts` (np. `'2026-05-01'`).

Te kroki MUSZĄ być w `[locale]/layout.tsx` (lub dedykowanym `LocaleGuard` opakowującym chronioną sekcję). Bez nich PR auth zostanie zablokowany w review.

### 5.5 Diagram

```
[Browser: LoginForm]
    │
    ├── 1. supabase.auth.signInWithPassword(email, password)
    │     ↓
    │  [Supabase GoTrue]
    │     ↓ (success)
    │  Set-Cookie: sb-access-token, sb-refresh-token (httpOnly)
    │     ↓
    ├── 2. (success) localStorage.welderdoc_autosave?
    │     ├── yes → INSERT documents → mark migrated → toast
    │     └── no  → continue
    │
    ├── 3. router.replace('/dashboard')
    │     ↓
[Server: middleware /src/proxy.ts]
    │   (chain: updateSession → next-intl)
    │     ↓
[Server: [locale]/layout.tsx]
    │
    ├── 4. setRequestLocale(locale)
    ├── 5. await createClient() (server) → auth.getUser()
    ├── 6. SELECT locale, current_consent_version FROM user_profiles
    ├── 7. if (profile.locale !== params.locale) → redirect
    ├── 8. if (!profile.current_consent_version) → redirect /consent-required
    └── 9. render children
```

## 6. Security Considerations

1. **Brak własnego Route Handlera = brak ekspozycji credentials w naszych logach.** `email`/`password` lecą przez TLS bezpośrednio do Supabase Auth.
2. **Cookies `httpOnly` + `Secure` + `SameSite=Lax`** zarządzane przez `@supabase/ssr` — niedostępne dla XSS. Konfiguracja domyślna jest poprawna; nie nadpisuj.
3. **`getUser()` zamiast `getSession()`** w Server Components — `getSession()` ufa cookies bez walidacji, `getUser()` robi roundtrip do Auth API. Zawsze `getUser()` przy guardach.
4. **Email enumeration:** `Invalid login credentials` to **jeden** komunikat dla braku usera **i** złego hasła. SDK Supabase implementuje to poprawnie. UI nie może pokazywać "Konto nie istnieje".
5. **Rate limiting (Supabase):**
   - `sign_in_sign_ups = 30 / 5 min / IP` — domyślne brute-force defense (`supabase/config.toml`, `api-plan.md` §6.1).
   - `token_refresh = 150 / 5 min / IP` — refresh token endpoint.
   - W UI: po 3-5 nieudanych próbach pokazać CAPTCHA (post-MVP `Vercel BotID`/`Cloudflare Turnstile` — `api-plan.md` §10).
6. **Re-auth dla operacji destrukcyjnych:** logowanie standardowe (cookies-session) NIE jest re-authem dla `DELETE /api/user/account`. Re-auth wymaga osobnego, **nie-cookies** klienta — to inny endpoint (`account-delete-endpoint-data.md`).
7. **CSRF:** Supabase cookies są `SameSite=Lax`. Logowanie nie jest podatne na CSRF, bo nie chodzi o operację mutującą stan użytkownika z cudzej strony — to user-initiated form submit.
8. **localStorage migration:** zawartość `welderdoc_autosave` to dane gościa, ale po migracji są w `documents.data` (RLS chroni przez `owner_id = auth.uid()`). Po `localStorage.removeItem`, nie da się odzyskać sceny — sentinel `welderdoc_migrated_at` zapobiega ponownej migracji w wyniku race condition.
9. **PII (RODO):** email i timestamp `email_confirmed_at` są zwracane w `data.user`. Nie loguj `data.user` do telemetrii. Sentry breadcrumbs MUSZĄ filtrować pole `email` (`api-plan.md` §6 — gdy Sentry wejdzie).

## 7. Error Handling

| Scenariusz | Źródło | Mapowanie | UI handling |
|---|---|---|---|
| Niepoprawny email format | klient (pre-validation) | brak (lokalny stan) | `errors.invalid_email_format` (i18n) — disable submit. |
| Puste hasło | klient (pre-validation) | brak | `errors.password_required` — disable submit. |
| `Invalid login credentials` (zły login lub hasło) | SDK `AuthError` | `mapAuthError` → `INVALID_CREDENTIALS` | `t('errors.invalid_credentials')` pod formularzem; clear hasła. |
| `Email not confirmed` | SDK `AuthError` | `mapAuthError` → `EMAIL_NOT_CONFIRMED` | Banner "Potwierdź email" + przycisk `Wyślij ponownie` → `supabase.auth.resend({ type: 'signup', email })`. |
| Rate limit (HTTP 429) | SDK `AuthError` | `mapAuthError` → `RATE_LIMITED` (jeśli mapowany) lub fallback `UNKNOWN` z `rawMessage` heurystycznie sprawdzającym "rate" / "too many" | Komunikat z countdown 60s; disable submit. |
| Network error / 5xx | SDK `AuthError` | `mapAuthError` → `UNKNOWN` | `t('errors.unknown')` + retry button. |
| `welderdoc_autosave` JSON broken | klient (try/catch JSON.parse) | brak | Cichy `localStorage.removeItem`; nie blokuj loginu. |
| Migracja `INSERT` zwraca `project_limit_exceeded` (P0001) | `mapPostgrestError` → `PROJECT_LIMIT_EXCEEDED` | toast warning `errors.guest_migration_limit` | Login się **udaje**; localStorage nietknięty. |
| `getUser()` w layout zwraca `null` mimo cookies | timing/refresh issue | log + `redirect('/[locale]/login')` | Nie do zalogowanego stanu — defensywnie. |
| `user_profiles` brak rekordu (race z `handle_new_user` triggerem) | `PostgrestError` `PGRST116` (no rows) | log + redirect na on-boarding lub retry | W praktyce nieosiągalne dla loginu (rejestracja zawsze przed pierwszym loginem). |
| `current_consent_version IS NULL` lub starsza | profile read | redirect `/[locale]/consent-required` | Nie błąd — wymuszony flow. |
| Locale mismatch | profile read | redirect `/${profile.locale}/...` | Nie błąd — auto-redirect. |

**Logging (zgodnie z `api-plan.md` §9):**

- Console-only w MVP. Sentry — post-MVP (`init-project-setup-analysis.md` §4).
- Loguj: `mapped.business`, `mapped.rawCode`, `mapped.rawMessage`. **Nie loguj** `email` ani `password`.
- Nie ma tabeli `error_log` w schemacie — wszystkie błędy biznesowe trafiają do telemetrii (gdy włączona) lub do `console.error` w dev.

## 8. Performance Considerations

1. **Sieć:** 1 RTT do GoTrue (login) + 1 RTT do Postgres (`SELECT user_profiles`) w guardzie. Region `fra1` (Vercel) ↔ Supabase EU-Frankfurt = ~5-15 ms RTT — pomijalne.
2. **Server Component cache:** `[locale]/layout.tsx` jest dynamiczny (cookies-dependent). Nie próbuj `cache()`'ować `auth.getUser()` ani fetcha profilu — JWT w cookies zmienia się i cachowanie zwróciłoby stary stan. Wyłączenie statycznego renderowania jest tu cechą, nie defektem.
3. **localStorage migration** wykonywana jest **raz** dzięki sentinelowi `welderdoc_migrated_at`. Po migracji trigger `check_free_project_limit` dodaje O(1) kosztu (count z `documents WHERE owner_id = uid`).
4. **Browser bundle:** `LoginForm` jest Client Componentem (`'use client'`) — zaimportuje `@supabase/ssr` (browser part). Sprawdź, że nie ciągnie `@supabase/supabase-js` admin features (drzewo importu — `createBrowserClient` jest minimal).
5. **`useTransition` przy submit:** zalecane do oznaczenia stanu pending bez blokowania UI (React 19 idiomatic).
6. **Brak prefetchingu profilu w UI:** `useEffect(() => fetch profile)` w Client Componentcie zduplikowałby SELECT z layouta. Profil pobiera **wyłącznie** Server Component; UI dostaje go propsami (lub przez `next-intl` runtime + Server Component children passing).

## 9. Implementation Steps

> **Pre-conditions:** wszystkie cztery migracje SQL zaaplikowane, `src/lib/supabase/{client,server,middleware}.ts` istnieją, `src/proxy.ts` chainuje `updateSession()` → `next-intl`. (Ten stan jest już w repozytorium per `CLAUDE.md`.)

### Krok 1 — Implementacja `src/lib/supabase/errors.ts` (TODO z `api-plan.md` §9)

1. Utwórz plik `src/lib/supabase/errors.ts`.
2. Eksportuj `enum BusinessError` (cały enum z `api-plan.md` §9 — nie tylko auth, by uniknąć powtórnego dotykania pliku przy kolejnych endpointach).
3. Eksportuj `interface MappedError`.
4. Implementuj `mapPostgrestError(err: PostgrestError | null): MappedError | null` zgodnie z §9 (P0001, 23514, 23502).
5. Implementuj `mapAuthError(err: AuthError | null): MappedError | null`:
   - `case 'Invalid login credentials'` → `INVALID_CREDENTIALS` / `errors.invalid_credentials`.
   - `case 'Email not confirmed'` → `EMAIL_NOT_CONFIRMED` / `errors.email_not_confirmed`.
   - `case 'User already registered'` → `EMAIL_ALREADY_REGISTERED` / `errors.email_already_registered`.
   - default: heurystyka `password` + `characters` → `PASSWORD_TOO_WEAK`; inaczej `UNKNOWN`.
   - Dodatkowo: jeśli `err.status === 429` lub `err.message.toLowerCase().includes('too many')` → `RATE_LIMITED`.
6. Dodaj unit testy `src/lib/supabase/errors.test.ts` pokrywające wszystkie gałęzie (coverage ≥ 80% dla `src/lib/**` zgodnie z `vitest.config.ts`).

### Krok 2 — Klucze i18n

W `src/messages/pl.json` i `src/messages/en.json` dodaj sekcję `errors.*`:

```json
{
  "errors": {
    "invalid_credentials": "...",
    "email_not_confirmed": "...",
    "email_already_registered": "...",
    "password_too_weak": "...",
    "rate_limited": "...",
    "unknown": "...",
    "invalid_email_format": "...",
    "password_required": "...",
    "guest_migration_failed": "...",
    "guest_migration_limit": "..."
  },
  "toasts": {
    "guest_migrated": "...",
    "guest_migration_limit": "..."
  },
  "auth": {
    "login": {
      "title": "...",
      "email_label": "...",
      "password_label": "...",
      "submit": "...",
      "forgot_password_link": "...",
      "register_link": "...",
      "resend_verification": "..."
    }
  }
}
```

### Krok 3 — Strona logowania `/[locale]/login`

1. `src/app/[locale]/login/page.tsx` — Server Component (default):
   - `setRequestLocale(locale)` na starcie.
   - `generateStaticParams()` zwraca `[{ locale: 'pl' }, { locale: 'en' }]`.
   - Sprawdź czy user już jest zalogowany: `auth.getUser()` → jeśli `user`, `redirect('/[locale]/dashboard')`. (Inaczej powracający user widzi formularz, co jest dezorientujące.)
   - Renderuje `<LoginForm />`.
2. `src/app/[locale]/login/LoginForm.tsx` — Client Component (`'use client'`):
   - Stan: `email`, `password`, `isSubmitting`, `error: MappedError | null`.
   - Walidacja klienta (regex email, niepuste hasło).
   - `handleSubmit`: `await supabase.auth.signInWithPassword(...)` → on error: `setError(mapAuthError(error))`; on success → guest-migration → `router.replace(searchParams.get('next') ?? '/[locale]/dashboard')`.
   - Pokazuje conditional `EMAIL_NOT_CONFIRMED` resend button.
   - Wszystkie stringi z `useTranslations('auth.login')` / `useTranslations('errors')`.

### Krok 4 — Stała wersji TOS i `LocaleGuard`

1. `src/lib/consent/version.ts`:
   ```typescript
   export const CURRENT_TOS_VERSION = '2026-05-01';
   ```
2. `src/app/[locale]/layout.tsx` — dodaj guard po `setRequestLocale`:
   - `const supabase = await createClient();`
   - `const { data: { user } } = await supabase.auth.getUser();`
   - Jeśli `user`:
     - `const { data: profile } = await supabase.from('user_profiles').select('locale, current_consent_version').eq('id', user.id).single();`
     - Jeśli `profile.locale !== params.locale` → `redirect('/' + profile.locale + restOfPath)`.
     - Jeśli `!profile.current_consent_version || profile.current_consent_version < CURRENT_TOS_VERSION` → `redirect('/' + params.locale + '/consent-required')`.
   - Jeśli `!user` → kontynuuj (publiczne ścieżki: `/login`, `/register`, `/`).
   - Pomijaj guard dla pewnych ścieżek (whitelist `/login`, `/register`, `/auth/callback`, `/consent-required`) — np. przez `headers().get('x-pathname')` ustawione w `proxy.ts` lub helper segmentowy.
   - **Alternatywnie:** wydziel guard do `src/components/auth/LocaleGuard.tsx` opakowującego tylko chronione layouty. Wybierz opcję B, jeśli routing-tree jest skomplikowany. Per `architecture-base.md` §17 dopuszcza obie.

### Krok 5 — Guest migration helper

1. `src/lib/autosave/migrateGuestAutosave.ts` (nowy plik):
   ```typescript
   export async function migrateGuestAutosave(
     supabase: SupabaseClient<Database>,
     userId: string
   ): Promise<{ migrated: boolean; reason?: 'project_limit' | 'invalid_payload' | 'db_error' }>;
   ```
   - Czyta `localStorage.welderdoc_autosave`.
   - JSON.parse w try/catch (broken → `localStorage.removeItem` i `migrated: false, reason: 'invalid_payload'`).
   - INSERT do `documents` z `data: parsed.scene` i `name: 'Migrowany projekt'` (lub i18n).
   - Na sukces: ustaw `welderdoc_migrated_at`, usuń `welderdoc_autosave`, zwróć `migrated: true`.
   - Na `mapPostgrestError(err)?.business === PROJECT_LIMIT_EXCEEDED` → zachowaj localStorage, zwróć `migrated: false, reason: 'project_limit'`.
2. Wywołanie z `LoginForm.handleSubmit` po sukcesie SDK, **przed** `router.replace`.
3. Unit testy z mockiem `localStorage` i `supabase` (vitest jsdom).

### Krok 6 — Strona `/[locale]/consent-required`

1. `src/app/[locale]/consent-required/page.tsx` — Server Component, pokazuje listę checkboxów (TOS, PP) + przycisk "Akceptuję" wywołujący istniejący `POST /api/consent` (bundle).
2. Po sukcesie: `router.replace('/[locale]/dashboard')` — `[locale]/layout.tsx` zauważy zaktualizowany `current_consent_version` i przepuści.
3. **Out-of-scope dla tego zadania**, ale wymagane jako destination redirectu — jeśli nie istnieje, doda się jako stub w tym PR (bez pełnego UI), z TODO.

### Krok 7 — Testy

#### Vitest (jednostki):

- `src/lib/supabase/errors.test.ts` — wszystkie gałęzie `mapAuthError`/`mapPostgrestError`.
- `src/lib/autosave/migrateGuestAutosave.test.ts` — broken JSON, sukces INSERT, `PROJECT_LIMIT_EXCEEDED`.
- `LoginForm.test.tsx` (testing-library) — walidacja klienta, submit z mockiem SDK, mapowanie błędów do i18n.

#### Playwright (E2E, `chromium-desktop`):

- `e2e/auth/login.spec.ts`:
  - Login z poprawnymi credentials (seeded user) → redirect na dashboard.
  - Login z błędnym hasłem → komunikat `errors.invalid_credentials`.
  - Login z `email_confirmed_at = NULL` → `errors.email_not_confirmed` + widoczny przycisk resend.
  - Locale mismatch: user z `profile.locale = 'en'` loguje się na `/pl/login` → po sukcesie URL = `/en/dashboard`.
  - Consent missing: user z `current_consent_version = NULL` → po sukcesie URL = `/[locale]/consent-required`.
  - Guest migration: pre-set `localStorage.welderdoc_autosave` → po loginie istnieje 1 wpis w `documents` + `localStorage.welderdoc_autosave` usunięty + `welderdoc_migrated_at` ustawiony.

### Krok 8 — Verification (przed merge)

1. `pnpm typecheck` — 0 błędów.
2. `pnpm lint` — 0 ostrzeżeń.
3. `pnpm test:run` — coverage `src/lib/**` ≥ 80%.
4. `pnpm test:e2e -- --project=chromium-desktop` — wszystkie scenariusze auth zielone.
5. **Manual PR checklist (per `CLAUDE.md`):**
   - [ ] Locale redirect zaimplementowany w `[locale]/layout.tsx` lub `LocaleGuard`.
   - [ ] Consent re-check zaimplementowany na każdym sign-inie.
   - [ ] Brak `error.message.includes(...)` w UI/route handlerach (poza `errors.ts`).
   - [ ] `mapAuthError` używany wszędzie, gdzie obsługujemy `AuthError`.
   - [ ] `welderdoc_migrated_at` ustawiony **przed** `removeItem('welderdoc_autosave')` (kolejność z `architecture-base.md` §13).
   - [ ] Brak hardcoded UI stringów; klucze `errors.*` i `auth.login.*` w obu lokalach.
   - [ ] Cookies sesyjne weryfikowane jako `httpOnly` + `Secure` w prod build.

### Krok 9 — Aktualizacja dokumentacji

1. `CLAUDE.md` — sekcja "Currently implemented in `src/lib/`" zaktualizować: `errors.ts` przenieść z "Not yet implemented" do "Currently implemented".
2. `.ai/api-plan.md` §1 (mapping endpointów do user stories) — zaznaczyć US-002 jako zaimplementowane.
3. (Opcjonalnie) krótki wpis w `MEMORY.md` o postępie auth.
