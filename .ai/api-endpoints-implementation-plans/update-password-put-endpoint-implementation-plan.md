# API Endpoint Implementation Plan: Update Password (PUT /auth/v1/user)

> Specyfikacja źródłowa: `.ai/api-endpoints-data/update-password-put-endpoint-data.md`
> Powiązane: `.ai/api-plan.md` §8.3 (auth flow), §9 (`mapAuthError`), `.ai/architecture-base.md` §17 (locale guard / consent re-check), CLAUDE.md (Workflow guardrails — auth implementation).

---

## 1. Endpoint Overview

Aktualizacja hasła zalogowanego użytkownika (US-004). Endpoint **nie jest customowym Route Handlerem** — jest to wywołanie Supabase GoTrue (`PUT /auth/v1/user`) zrealizowane bezpośrednio przez SDK `supabase.auth.updateUser({ password })`. Aplikacja eksponuje go przez dwa scenariusze UI:

1. **Reset password flow (US-004, niezalogowany kontekst startowy):** użytkownik wraca z linka `recovery` → callback PKCE (`/[locale]/auth/callback`) wymienia `code` na pełną sesję → formularz `/[locale]/reset-password` wywołuje `updateUser({ password })` na świeżo utworzonej sesji.
2. **Change password (zalogowany użytkownik w ustawieniach konta):** formularz w `/[locale]/account/security` wywołuje `updateUser({ password })` na bieżącej sesji.

Wymagania nieoczywiste, wynikające z tego, że to czysto SDK-owy endpoint:

- **Brak własnego Route Handlera** — nie tworzymy `src/app/api/user/password/route.ts`. Próba „opakowania" GoTrue w własny Route Handler złamałaby PKCE flow (sesja powstaje w cookies klienta, nie na serwerze) i podwoiła powierzchnię ataku. Zgodnie z `tech-stack.md` §7 i specyfikacją endpointu — pozostawiamy SDK w komponencie klienckim.
- **Mapowanie błędów GoTrue** musi przejść przez `mapAuthError` z `src/lib/supabase/errors.ts` (`api-plan.md` §9 — **plik TODO**, do utworzenia w ramach tego ticketu lub jako prerequisite).
- **Locale guard i consent re-check** (CLAUDE.md → PR checklist auth) muszą zadziałać **po** udanym `updateUser` — jeśli reset hasła odświeżył sesję, kolejny rendering layoutu `[locale]/layout.tsx` powinien przepuścić użytkownika przez ten sam pipeline co po `signInWithPassword`.

## 2. Request Details

- **HTTP Method:** `PUT`
- **URL Structure:** `PUT https://<project>.supabase.co/auth/v1/user` (zarządzane przez SDK; w aplikacji UI nie konstruuje tego URL ręcznie).
- **Wywołanie z kodu (jedyny dozwolony entry point):**

```typescript
import { createClient } from '@/lib/supabase/client'; // Client Component context

const supabase = createClient();
const { data, error } = await supabase.auth.updateUser({
  password: newPassword,
});
```

### Parametry wejścia (payload `UserAttributes` z `@supabase/supabase-js`)

| Pole       | Typ      | Wymagane | Opis                                                                   |
| ---------- | -------- | -------- | ---------------------------------------------------------------------- |
| `password` | `string` | tak      | Nowe hasło, **min. 8 znaków** (PRD US-001).                            |
| `email`    | `string` | nie      | Zmiana emaila — **NIE używać w tym flow**. Poza zakresem MVP US-004.   |
| `data`     | `object` | nie      | Custom user metadata — **NIE używać w tym flow**. Poza zakresem MVP.   |

> **Reguła implementacyjna:** w obu komponentach UI (reset password, change password) wywołujemy SDK z **wyłącznie polem `password`**. Pozostałe pola pozostają nieprzekazywane, by nie wprowadzać niezwalidowanych przez UI ścieżek.

### Wymagania sesji

- **Reset password flow:** sesja musi już istnieć (callback PKCE wymienił `code` przy wejściu na stronę).
- **Change password flow:** sesja musi być aktywna (zwykły użytkownik zalogowany).
- Brak sesji → GoTrue zwraca `Auth session missing` → mapujemy na 401 + redirect do `/[locale]/login`.

## 3. Used Types

Endpoint nie potrzebuje własnych DTO/Command Models w `src/types/api.ts` — używamy typów z SDK Supabase + lokalnego ViewModelu walidacji formularza:

| Typ                                | Źródło                                  | Rola                                                                                       |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `UserAttributes['password']`       | `@supabase/supabase-js`                 | Payload do `auth.updateUser({...})`.                                                       |
| `UserResponse` / `User`            | `@supabase/supabase-js`                 | Typ odpowiedzi SDK (sukces) — `data.user`.                                                 |
| `AuthError`                        | `@supabase/supabase-js`                 | Surowy błąd GoTrue, wejście do `mapAuthError`.                                             |
| `BusinessError`                    | `src/lib/supabase/errors.ts` (**TODO**) | Enum z `PASSWORD_TOO_WEAK`, `UNKNOWN`. Używany do dyskryminacji w UI.                      |
| `MappedError`                      | `src/lib/supabase/errors.ts` (**TODO**) | `{ business, message, rawCode?, rawMessage? }` — przekazywany do warstwy prezentacji.      |
| `UpdatePasswordFormViewModel`      | komponent formularza (lokalnie)         | `{ password: string; passwordConfirm: string }` — walidacja po stronie klienta przed SDK. |

**ViewModel formularza (lokalnie, np. `src/components/account/UpdatePasswordForm.tsx`):**

```typescript
interface UpdatePasswordFormViewModel {
  password: string;          // NIE eksportujemy — żyje tylko w stanie formularza
  passwordConfirm: string;   // pole UI; podwójne wpisanie hasła wg specyfikacji §80
}
```

Forma ta nie trafia do `src/types/api.ts`, bo zgodnie z konwencją projektu plik ten gromadzi DTO związane z **własnymi** Route Handlerami. Tutaj wywołanie idzie wprost do GoTrue.

## 4. Response Details

### 200 OK (sukces)

Odpowiedź SDK (`data.user`):

```json
{
  "user": {
    "id": "uuid-...",
    "email": "user@example.com",
    "updated_at": "2026-05-09T12:00:00Z"
  }
}
```

Efekty uboczne po stronie klienta:

- `@supabase/ssr` automatycznie aktualizuje cookies sesji (GoTrue invaliduje stary refresh token i zwraca nowy).
- Po sukcesie UI przekierowuje:
  - **Reset password flow:** `router.replace('/[locale]/login?reset=success')` (lub od razu `/[locale]` jeśli sesja jest już ważna — patrz §5 niżej).
  - **Change password flow:** toast + pozostanie na stronie ustawień.

### Statusy błędów (po remap'ie w UI — endpoint sam z siebie zwraca tylko 200/4xx z GoTrue)

| Sytuacja                                                | Status logiczny w UI | Kod biznesowy                     | i18n key                  |
| ------------------------------------------------------- | -------------------- | --------------------------------- | ------------------------- |
| Hasło za słabe / za krótkie                             | 400                  | `PASSWORD_TOO_WEAK`               | `errors.password_too_weak`|
| `Auth session missing` (brak sesji)                     | 401                  | `UNAUTHORIZED`                    | `errors.unauthorized`     |
| Rate limit GoTrue (HTTP 429 z auth-server)              | 429                  | `RATE_LIMITED`                    | `errors.rate_limited`     |
| Network / nieoczekiwany błąd                            | 500                  | `UNKNOWN` / `NETWORK_ERROR`       | `errors.unknown`          |

> Te statusy są w UI; warstwa transportowa GoTrue ma własne kody (HTTP 422 dla słabego hasła itd.). Dyskryminacja idzie po `mapAuthError(err).business`, nie po HTTP status.

## 5. Data Flow

```
[User UI: UpdatePasswordForm]
        │  (1) wprowadza newPassword + passwordConfirm
        ▼
[Walidacja klienta (Zod / pure fn)]
   • password.length >= 8
   • password === passwordConfirm
        │  (2) jeśli OK
        ▼
[supabase.auth.updateUser({ password })]   ◄── createClient() z src/lib/supabase/client.ts
        │  (3) HTTP PUT /auth/v1/user (cookies sesji w nagłówku)
        ▼
[GoTrue (Supabase Auth)]
   • weryfikacja sesji (JWT z cookies)
   • weryfikacja długości hasła wg config.toml [auth.password] min_length
   • UPDATE auth.users SET encrypted_password = ..., updated_at = now()
   • invalidate refresh tokens, wyemituj nowy
        │  (4) odpowiedź { data: { user }, error: null }
        ▼
[@supabase/ssr — set-cookie hook]
   • setAll([sb-access-token, sb-refresh-token]) — atomowo
        │  (5)
        ▼
[Komponent — mapAuthError(error)]
   • error == null → success path
   • error → MappedError → toast + setFieldError
        │
        ▼
[Sukces — router.replace(...)]
   • reset flow: → /[locale]/login?reset=success
   • change flow: pozostaje + toast
        │  (6) layout [locale]/layout.tsx renderuje na nowo
        ▼
[LocaleGuard (architecture-base.md §17)]
   • auth.getUser() → fetch user_profiles.locale, current_consent_version
   • locale mismatch → redirect
   • current_consent_version stale/null → redirect /[locale]/consent-required
```

**Zaangażowane zasoby zewnętrzne:**

- `auth.users` — UPDATE: `encrypted_password`, `updated_at` (przez GoTrue, nie przez nasz kod SQL).
- `auth.refresh_tokens` — INVALIDATE / INSERT (po update hasła GoTrue revoke'uje istniejące refresh tokeny).
- `public.user_profiles` — **nie modyfikowane** w tym endpoincie (pole `current_consent_version` jest niezależne; `updateProfile()` nie jest tu używane).
- Brak własnych tabel domenowych.

## 6. Security Considerations

- **Brak własnego endpointu = mniejsza powierzchnia ataku.** Nie wystawiamy żadnego serwerowego wrappera, więc CSRF / CSRP / signature spoofing są poza zakresem — GoTrue obsługuje wszystko po stronie Supabase.
- **PKCE callback dla reset flow.** Strona `/[locale]/auth/callback` musi wymienić `code` na sesję (`supabase.auth.exchangeCodeForSession(code)`) **przed** renderem formularza `/reset-password`. Bez tego `updateUser` zwróci `Auth session missing` (401). Implementacja callbacka jest osobnym ticketem (US-002 / US-004 sign-in) — w ramach tego ticketu **weryfikujemy jego istnienie** i dodajemy explicit guard w komponencie reset password (jeśli `getUser()` zwraca null → redirect do `/login?expired=1`).
- **Cookies httpOnly.** Sesja Supabase żyje w cookies httpOnly zarządzanych przez `@supabase/ssr` — niedostępna dla JS klienta, więc XSS nie eksfiltruje refresh tokenu.
- **Brak loga hasła w klientowym kodzie.** Komponent formularza musi:
  - Trzymać `password` tylko w `useState` (nie w formData / nie w localStorage).
  - Nigdy nie logować obiektu requestu (`console.log({ password })` — zakaz; ESLint nie wyłapie, dlatego review checklist).
- **Refresh token rotation.** GoTrue invaliduje stare refresh tokeny przy `updateUser({ password })`. To celowe — chroni przed scenariuszem „atakujący ukradł refresh token, ofiara zmienia hasło". Ale powoduje, że **inne aktywne sesje użytkownika zostaną wylogowane przy najbliższym refresh** — to UX accepted, NIE bug.
- **Walidacja siły hasła.** Min. 8 znaków wg PRD US-001. Egzekwowane:
  1. Klient: preflight w komponencie (lepszy UX, natychmiastowy feedback).
  2. GoTrue: `supabase/config.toml [auth.password] min_length` — autorytatywne źródło.
  3. **TODO operacyjne:** zweryfikować że `min_length = 8` w Supabase (nie 6 — domyślne GoTrue). Jeśli nie, otworzyć ticket konfiguracyjny.
- **Brak osobnego rate-limit.** Specyfikacja §69 stwierdza, że `updateUser` nie ma wydzielonego limitu. Pokrywa go pośrednio `token_refresh = 150 / 5 min / IP`. Jeśli okaże się niewystarczające, można dodać własny limiter na poziomie middleware (poza zakresem ticketu).
- **Lokalizacja błędów.** `MappedError.message` to klucz i18n — komponent UI używa `useTranslations('errors')` i renderuje `t(mapped.message)`. Zero hardcoded stringów (CLAUDE.md → Project-specific configuration quirks).

## 7. Error Handling

Tabela mapowań — wszystkie błędy przechodzą przez `mapAuthError` (`src/lib/supabase/errors.ts`, **TODO**, szkic w `api-plan.md` §9):

| Wejście (`AuthError.message`)                                            | `BusinessError`         | i18n key                         | UX                                                              |
| ------------------------------------------------------------------------ | ----------------------- | -------------------------------- | --------------------------------------------------------------- |
| `"Password should be at least N characters"` (regex `password.*characters`) | `PASSWORD_TOO_WEAK`     | `errors.password_too_weak`       | `setFieldError('password', t(...))` — inline error pod inputem. |
| `"Auth session missing"`                                                 | `UNAUTHORIZED` (dodać do enum, jeśli brak) | `errors.unauthorized`            | Toast + `router.replace('/[locale]/login?expired=1')`.         |
| `"Rate limit exceeded"` (HTTP 429)                                       | `RATE_LIMITED`          | `errors.rate_limited`            | Toast „Spróbuj ponownie za chwilę".                              |
| Network error (TypeError: fetch failed itp.)                             | `NETWORK_ERROR`         | `errors.network_error`           | Toast + przycisk Retry.                                         |
| Cokolwiek innego (`default` w `mapAuthError`)                            | `UNKNOWN`               | `errors.unknown`                 | Toast „Coś poszło nie tak" + Sentry breadcrumb (post-MVP).      |

### Wzorzec użycia w komponencie (referencyjny):

```typescript
'use client';

import { createClient } from '@/lib/supabase/client';
import { mapAuthError, BusinessError } from '@/lib/supabase/errors';

async function handleSubmit(values: UpdatePasswordFormViewModel) {
  // 1. Walidacja klienta (preflight, nie zastępuje GoTrue)
  if (values.password.length < 8) {
    setFieldError('password', t('errors.password_too_weak'));
    return;
  }
  if (values.password !== values.passwordConfirm) {
    setFieldError('passwordConfirm', t('errors.password_mismatch'));
    return;
  }

  // 2. Wywołanie SDK
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password: values.password });

  // 3. Mapowanie błędu (zawsze przez mapAuthError, nigdy includes())
  const mapped = mapAuthError(error);
  if (mapped) {
    if (mapped.business === BusinessError.PASSWORD_TOO_WEAK) {
      setFieldError('password', t(mapped.message));
    } else if (mapped.business === BusinessError.UNAUTHORIZED) {
      router.replace('/login?expired=1');
    } else {
      toast.error(t(mapped.message));
    }
    return;
  }

  // 4. Sukces — redirect lub toast wg flow
  toast.success(t('account.password_updated'));
  router.replace('/login?reset=success'); // tylko reset flow
}
```

> **Reguła kategoryczna (CLAUDE.md):** żadnego `error?.message.includes('...')` w komponencie. Cała dyskryminacja idzie przez `mapAuthError(...).business`.

### Logowanie błędów

- **Endpoint nie pisze do bazy.** Brak tabeli błędów w schemacie publicznym (`webhook_events` służy do dispatch'u Paddle, nie do błędów auth).
- **Telemetria klienta:** post-MVP — Sentry breadcrumb z `mapped.business` + `mapped.rawCode` (nigdy `rawMessage` z hasłem). Na MVP wystarczy `console.warn` w gałęzi `BusinessError.UNKNOWN`.

## 8. Performance Considerations

- **Pojedyncze HTTP roundtrip do GoTrue** (~50-200ms w EU-Frankfurt). Brak optymalizacji potrzebnych.
- **Cookies update** robi `@supabase/ssr` automatycznie — atomowo `setAll([...])`, więc kolejny `auth.getUser()` nie trafi w „dziurę" między starym a nowym tokenem.
- **Refresh token rotation** wywołuje pojedyncze UPDATE w `auth.refresh_tokens` — pomijalne.
- **Bottleneck operacyjny:** rate-limit GoTrue `token_refresh = 150 / 5 min / IP`. Jeśli użytkownik klika „zmień hasło" wielokrotnie z różnych zakładek, może wpaść w 429 — UI powinien debounce'ować submit (`disabled` na przycisku do końca requestu).
- **Brak własnego cache.** `updateUser` jest mutacją — żadna warstwa cache (Next.js `cache`, Supabase client cache) nie jest tu zaangażowana.
- **Bundle impact:** komponent formularza importuje `createClient` (browser variant) — ten sam co reszta auth UI, **bez** dodatkowych zależności.

## 9. Implementation Steps

### Prerequisite (**TODO** w osobnym lub łączonym tickecie)

1. **Utwórz `src/lib/supabase/errors.ts`** wg szkicu z `api-plan.md` §9. Wymagane symbole:
   - `enum BusinessError` z minimum: `PASSWORD_TOO_WEAK`, `UNAUTHORIZED` (do dodania, jeśli brak), `RATE_LIMITED`, `NETWORK_ERROR`, `UNKNOWN`.
   - `interface MappedError { business; message; rawCode?; rawMessage? }`.
   - `function mapAuthError(err: AuthError | null): MappedError | null`.
   - Pokrycie testami jednostkowymi (`src/lib/supabase/errors.test.ts`) ≥ 80% wg progów `vitest.config.ts`.

### Krok 1 — i18n keys

2. Dodaj klucze do `src/messages/pl.json` i `src/messages/en.json`:
   - `errors.password_too_weak` — „Hasło jest zbyt krótkie. Minimum 8 znaków." / „Password is too weak. Minimum 8 characters."
   - `errors.password_mismatch` — „Hasła nie są takie same." / „Passwords do not match."
   - `errors.unauthorized` — „Sesja wygasła. Zaloguj się ponownie." / „Session expired. Please sign in again."
   - `errors.rate_limited` — „Zbyt wiele prób. Spróbuj ponownie za chwilę." / „Too many attempts. Please try again later."
   - `errors.unknown` — „Coś poszło nie tak. Spróbuj ponownie." / „Something went wrong. Please try again."
   - `account.password_updated` — „Hasło zostało zmienione." / „Password updated successfully."

### Krok 2 — komponent formularza (wspólna logika)

3. Utwórz `src/components/account/UpdatePasswordForm.tsx` (`'use client'`):
   - Pola: `password`, `passwordConfirm` (wymagane podwójne wpisanie wg specyfikacji §80).
   - Stan tylko w `useState` — żadnego store'a Zustand (sekret nie powinien przebywać poza komponentem).
   - Walidacja klienta: `password.length >= 8`, `password === passwordConfirm`.
   - Submit:
     - Wywołanie `supabase.auth.updateUser({ password })` z klienta z `src/lib/supabase/client.ts`.
     - Mapowanie błędu przez `mapAuthError` (Krok prerequisite).
     - Sukces → `onSuccess?: () => void` callback (parent decyduje o redirect/toast).
   - Disabled state przycisku w trakcie requestu (debounce — zapobiega 429).
   - Brak emoji w UI (CLAUDE.md → general guidelines).

### Krok 3 — strona reset password (US-004 zamknięcie flow)

4. Utwórz `src/app/[locale]/reset-password/page.tsx`:
   - `setRequestLocale(locale)` na starcie.
   - `generateStaticParams()` zwraca obie locale.
   - Server-side: `auth.getUser()` — jeśli `null` → `redirect('/[locale]/login?expired=1')` (callback PKCE jeszcze nie zakończony / wygasł).
   - Renderuje `<UpdatePasswordForm onSuccess={...}/>`.
   - `onSuccess`: redirect do `/[locale]/login?reset=success` (Server Action lub `router.replace` w klienckim wrapperze).

### Krok 4 — strona change password (settings)

5. Utwórz `src/app/[locale]/account/security/page.tsx` (lub dodaj sekcję do istniejącej karty profilu):
   - `setRequestLocale(locale)`, guard `auth.getUser()` → `redirect('/[locale]/login')` jeśli null.
   - Renderuje `<UpdatePasswordForm onSuccess={...}/>`.
   - `onSuccess`: toast + pozostań na stronie.

### Krok 5 — testy jednostkowe

6. `src/components/account/UpdatePasswordForm.test.tsx`:
   - Sukces: SDK zwraca `{ error: null }` → wywołanie `onSuccess`.
   - Słabe hasło: SDK zwraca `{ error: AuthError("Password should be at least 6 characters") }` → `screen.getByText(/zbyt krótkie/i)` (lub i18n key).
   - Brak sesji: SDK zwraca `{ error: AuthError("Auth session missing") }` → wywołanie `router.replace`.
   - Walidacja klienta: niepasujące hasła → `setFieldError('passwordConfirm', ...)`, SDK NIE wywołane (`expect(supabase.auth.updateUser).not.toHaveBeenCalled()`).
   - Mock `supabase.auth.updateUser` przez vi.fn() w `vi.mock('@/lib/supabase/client', ...)`.

### Krok 6 — testy E2E (opcjonalne, jeśli czas pozwala)

7. `e2e/reset-password.spec.ts` (Playwright `chromium-desktop`):
   - Happy path: rejestracja → wyloguj → recovery email mock → callback → reset → login z nowym hasłem.
   - Sad path: słabe hasło → komunikat błędu inline.
   - **Uwaga:** wymaga lokalnego stacka Supabase (`pnpm supabase start`) — w CI flow może być pomijany, jeśli mock GoTrue niedostępny.

### Krok 7 — review checklist

8. Pre-merge sprawdź ręcznie:
   - **Brak hardcoded stringów** w komponencie i stronach (wszystko przez `useTranslations`).
   - **Brak `error?.message.includes(...)`** — wszystkie ścieżki przez `mapAuthError`.
   - **Brak `console.log` z payloadem hasła** — żadne `{ password }` w logach.
   - **Locale guard działa** — po sukcesie reset password użytkownik z `user_profiles.locale = 'en'` ląduje na `/en/login`, nie `/login`.
   - **Consent re-check działa** — jeśli `current_consent_version` jest stale, użytkownik trafia na `/[locale]/consent-required` przed `/login?reset=success`.
   - `pnpm typecheck && pnpm lint && pnpm test:run` — bez błędów.
   - Coverage `src/lib/**` ≥ progów (80/80/70/80).

### Krok 8 — operacyjna weryfikacja Supabase config

9. Po deployu na preview otwórz Supabase Dashboard → Authentication → Settings → Password Strength → upewnij się, że **Minimum password length = 8** (a nie domyślne 6). Jeśli 6, otwórz osobny ticket konfiguracyjny — domyślny `min_length` GoTrue nie spełnia PRD US-001.

---

**Definition of Done:**

- [ ] `src/lib/supabase/errors.ts` istnieje, eksportuje `mapAuthError` z obsługą `PASSWORD_TOO_WEAK`, pokrycie testami ≥ 80%.
- [ ] `src/components/account/UpdatePasswordForm.tsx` implementuje walidację klienta + wywołanie SDK + mapowanie błędu.
- [ ] `src/app/[locale]/reset-password/page.tsx` i (opcjonalnie) `src/app/[locale]/account/security/page.tsx` renderują formularz.
- [ ] Klucze i18n dodane do `pl.json` + `en.json`.
- [ ] Testy jednostkowe formularza pokrywają cztery ścieżki (sukces, słabe hasło, brak sesji, walidacja klienta).
- [ ] `pnpm verify:routes`, `pnpm typecheck`, `pnpm lint`, `pnpm test:run` zielone.
- [ ] Manual review checklist (Krok 7) — wszystkie punkty OK.
- [ ] Min. długość hasła w Supabase = 8 (potwierdzone w Dashboard).
