# API Endpoint Implementation Plan: POST /auth/v1/signup (Registration)

> **Scope:** rejestracja konta użytkownika (US-001). Endpoint jest **publiczny endpoint Supabase Auth (GoTrue)** — nie implementujemy własnego Route Handlera. Implementacja sprowadza się do (1) cienkiego serwisu orkiestrującego `supabase.auth.signUp()` + post-signup wywołanie `/api/consent`, (2) brakujących pomocników (`src/lib/supabase/errors.ts`), (3) konfiguracji GoTrue (`supabase/config.toml`) oraz (4) komponentu UI strony `/[locale]/auth/sign-up`.

---

## 1. Endpoint Overview

POST `/auth/v1/signup` to **endpoint zarządzany przez Supabase Auth (GoTrue)** — nie posiada własnego pliku `route.ts` w tym repo. Wywoływany jest przez SDK `@supabase/supabase-js` (`supabase.auth.signUp(...)`) z poziomu Client Component lub Server Component.

Cel funkcjonalny:

1. Tworzy rekord w `auth.users` (z `email`, hashed `password`, `email_confirmed_at = NULL` w produkcji).
2. Trigger DB `on_auth_user_created` (funkcja `handle_new_user()` — `SECURITY DEFINER`) automatycznie tworzy odpowiadający wiersz w `public.user_profiles` z domyślnymi wartościami (`plan='free'`, `locale='pl'`, `current_consent_version=NULL`).
3. W produkcji wysyła e-mail weryfikacyjny (custom SMTP — Resend/Postmark — wymagane przez Supabase Cloud przy włączonych potwierdzeniach).
4. Zwraca `{ user, session: null }` — sesja powstaje dopiero po kliknięciu linku weryfikacyjnego (przekierowanie do `/[locale]/auth/callback`).

Endpoint to **krok 1 z trzech** w pełnym przepływie rejestracji (`api-plan.md` §2.2):

- **Krok 1:** `supabase.auth.signUp(...)` (ten endpoint)
- **Krok 2:** `POST /api/consent` (bundle TOS + PP + cookies — atomowo przez RPC `record_consent_bundle()`)
- **Krok 3:** kliknięcie linka weryfikacyjnego → ustawienie `auth.users.email_confirmed_at` → utworzenie sesji.

Kroki 1 i 2 muszą zostać wywołane razem; krok 3 jest asynchroniczny i wymaga akcji użytkownika w skrzynce e-mail.

---

## 2. Request Details

- **HTTP Method:** `POST`
- **URL Structure:** `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup` (wywoływane wyłącznie przez SDK; klient nie powinien konstruować URL ręcznie)
- **Wywołanie SDK:**

  ```typescript
  import { createClient } from '@/lib/supabase/client';

  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email: 'user@example.com',
    password: 'MinimalneHaslo123',
  });
  ```

### Parameters

**Required (body):**

| Pole | Typ | Reguła walidacji |
|---|---|---|
| `email` | `string` | Format RFC 5322; preflight client-side prostym regexem, autorytatywna walidacja po stronie GoTrue |
| `password` | `string` | Min. 8 znaków (PRD US-001); egzekwowane server-side przez GoTrue (`supabase/config.toml [auth.password] min_length = 8`) |

**Optional:** brak (w MVP nie korzystamy z `options.data`, `options.captchaToken`, `options.emailRedirectTo` na poziomie SDK — `emailRedirectTo` skonfigurowane w Supabase Cloud Auth Settings → Site URL + Redirect URLs jako `${NEXT_PUBLIC_APP_URL}/auth/callback`).

### Request Body (przekazywane przez SDK do `/auth/v1/signup`)

```json
{
  "email": "user@example.com",
  "password": "MinimalneHaslo123"
}
```

### Headers

Ustawiane automatycznie przez SDK:

- `apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}`
- `Content-Type: application/json`

---

## 3. Used Types

> Endpoint Supabase Auth jest typowany przez `@supabase/supabase-js` (`AuthResponse`, `User`, `Session`, `AuthError`) — nie dodajemy DTO w `src/types/api.ts`. Niniejsza sekcja wymienia typy implementacyjne potrzebne do orkiestracji, mapowania błędów i komponentu UI.

### 3.1 Typy z SDK

```typescript
import type { AuthResponse, AuthError, User, Session } from '@supabase/supabase-js';
// AuthResponse:
//   { data: { user: User | null; session: Session | null }, error: null }
//   | { data: { user: null; session: null }, error: AuthError }
```

### 3.2 Typy do utworzenia (brakujące)

**`src/lib/supabase/errors.ts`** (TODO per `CLAUDE.md` i `api-plan.md` §9 — pełen szkic do skopiowania):

```typescript
export enum BusinessError {
  // Auth (kluczowe dla tego endpointa)
  EMAIL_ALREADY_REGISTERED = 'email_already_registered',
  PASSWORD_TOO_WEAK = 'password_too_weak',
  INVALID_CREDENTIALS = 'invalid_credentials',
  EMAIL_NOT_CONFIRMED = 'email_not_confirmed',

  // Generic
  RATE_LIMITED = 'rate_limited',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown',
  // …reszta zgodnie z api-plan.md §9.1
}

export interface MappedError {
  business: BusinessError;
  message: string; // i18n key, np. 'errors.email_already_registered'
  rawCode?: string;
  rawMessage?: string;
}

export function mapAuthError(err: AuthError | null): MappedError | null {
  /* ... */
}
```

### 3.3 Typy istniejące (użyte w kroku 2 — bundle zgody)

Z `src/types/api.ts`:

- `RecordConsentBundleCommand` — payload dla `POST /api/consent`
- `ConsentType` — `'terms_of_service' | 'privacy_policy' | 'cookies'`
- `RecordConsentBundleResponseDto` — odpowiedź `/api/consent`

### 3.4 Lokalne typy serwisu rejestracji (`src/lib/auth/registration.ts`)

```typescript
export interface RegisterUserCommand {
  email: string;
  password: string;
  /** Bundle zgód TOS + PP + cookies. */
  consent: {
    types: [ConsentType, ...ConsentType[]];
    version: string;
    accepted: true;
  };
}

export type RegisterUserResult =
  | { ok: true; user: User; session: Session | null; consentVersion: string }
  | { ok: false; step: 'signup' | 'consent'; error: MappedError };
```

---

## 4. Response Details

### 4.1 Sukces (HTTP 200 z GoTrue)

```json
{
  "user": {
    "id": "uuid-v4",
    "aud": "authenticated",
    "role": "authenticated",
    "email": "user@example.com",
    "email_confirmed_at": null,
    "phone": "",
    "confirmation_sent_at": "2026-05-09T12:34:56.789Z",
    "created_at": "2026-05-09T12:34:56.789Z",
    "updated_at": "2026-05-09T12:34:56.789Z",
    "identities": [/* … */],
    "user_metadata": {},
    "app_metadata": { "provider": "email", "providers": ["email"] }
  },
  "session": null
}
```

> `session: null` wskazuje, że potwierdzenie e-mail jest włączone (produkcja). W dev (`enable_confirmations = false`) `session` zawiera `access_token` + `refresh_token` i użytkownik jest zalogowany od razu.

### 4.2 Błąd (HTTP 400 / 422 / 429 z GoTrue)

```json
{
  "code": 422,
  "error_code": "email_address_invalid",
  "msg": "Email address is invalid"
}
```

SDK normalizuje to do `AuthError` z `{ message, status, name }`.

### 4.3 Status codes mapowane na UI

| Sytuacja | HTTP (GoTrue) | `AuthError.message` | `BusinessError` | i18n key |
|---|---|---|---|---|
| Sukces (prod, sent confirmation) | `200` | — | — | (success state) |
| Email już zarejestrowany | `422` | `User already registered` | `EMAIL_ALREADY_REGISTERED` | `errors.email_already_registered` |
| Hasło za krótkie | `422` | `Password should be at least 8 characters` | `PASSWORD_TOO_WEAK` | `errors.password_too_weak` |
| Email format niepoprawny | `422` | `Email address is invalid` | `UNKNOWN` (preflight powinien złapać) | `errors.email_invalid` (UI client-side) |
| Rate limit | `429` | `Too many requests` (lub `rate_limit_exceeded`) | `RATE_LIMITED` | `errors.rate_limited` |
| Awaria SMTP / GoTrue | `500` | `Internal Server Error` | `UNKNOWN` | `errors.unknown` |
| Brak sieci | — (throw) | — | `NETWORK_ERROR` | `errors.network_error` |

> **Uwaga:** ten endpoint to nie własny Route Handler — jego status codes są ustalane przez GoTrue. Plan nie wymienia `200/201/400/401/404/500` w naszej kontroli; ważne jest **mapowanie** wyniku SDK na typowane `BusinessError`.

---

## 5. Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1) UI: SignUpForm (Client Component, src/app/[locale]/auth/sign-up)  │
│    - Walidacja preflight (email regex, password.length >= 8)         │
│    - Wywołuje registerUser({ email, password, consent })             │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────┐
│ 2) src/lib/auth/registration.ts → registerUser(command)              │
│    a) const sb = createClient()  // browser client                   │
│    b) await sb.auth.signUp({ email, password })                      │
│       └─> AuthError? → mapAuthError → return { ok: false, step:'signup', error }
└────────────────────────────┬─────────────────────────────────────────┘
                             │ success { user, session: null }
┌────────────────────────────▼─────────────────────────────────────────┐
│ 3) Supabase GoTrue                                                   │
│    - INSERT auth.users (password hashed, email_confirmed_at = NULL)  │
│    - Trigger on_auth_user_created → handle_new_user() (SECURITY      │
│      DEFINER) → INSERT public.user_profiles (id, plan='free',        │
│      locale='pl', current_consent_version=NULL)                      │
│    - Async: SMTP queue → email weryfikacyjny (Resend/Postmark)       │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────┐
│ 4) registerUser → fetch('/api/consent', { method: 'POST', body: …}) │
│    a) Wywołanie własnego Route Handlera (już zaimplementowany)       │
│    b) Handler: anonimizuje IP, INSERT 3 wiersze do consent_log,      │
│       UPDATE user_profiles.current_consent_version przez RPC         │
│       record_consent_bundle() (SECURITY DEFINER)                     │
│    c) Konsumuje sesję cookie z kroku 2 (jeśli dev/no-confirmation)   │
│       — w prod sesja=null, więc /api/consent zwróci 401:             │
│       UWAGA — patrz §6.2 i §9 (split-step flow)                       │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────┐
│ 5) UI: redirect → /[locale]/auth/check-email                         │
│    - Wyświetla "Sprawdź skrzynkę: user@example.com"                  │
│    - CTA "Wyślij ponownie" → supabase.auth.resend({ type:'signup' }) │
└──────────────────────────────────────────────────────────────────────┘
```

### Tabele bazy danych dotknięte przez ten flow

| Tabela | Operacja | Inicjator |
|---|---|---|
| `auth.users` | `INSERT` | GoTrue (signUp) |
| `public.user_profiles` | `INSERT` | trigger `on_auth_user_created` |
| `public.consent_log` | `INSERT × 3` | RPC `record_consent_bundle()` (krok 2) |
| `public.user_profiles.current_consent_version` | `UPDATE` | RPC `record_consent_bundle()` (krok 2, bypass `block_protected_columns_update` przez `current_user = 'postgres'`) |

---

## 6. Security Considerations

### 6.1 Authentication / Authorization

- Endpoint jest **publiczny** — autoryzacja niepotrzebna z definicji (rejestracja anonimowych userów).
- Klient używa `NEXT_PUBLIC_SUPABASE_ANON_KEY` (bezpieczny do wystawienia client-side; RLS chroni dane).
- **NIE używać `SUPABASE_SERVICE_ROLE_KEY`** w tym przepływie.

### 6.2 Wymóg email confirmation w produkcji

> **Production deploy guardrail:** Supabase Cloud → Auth → Settings → `Enable email confirmations = ON`, `Confirm email change = ON`, custom SMTP (Resend/Postmark) skonfigurowany.

Bez tego:

- `enable_confirmations = false` → `auth.users.email_confirmed_at = now()` ustawiane od razu, co pomija obrony RLS na `documents` (`email_confirmed_at IS NOT NULL` defense-in-depth).
- Brak SMTP → maile nie wychodzą; użytkownicy utykają w stanie "check your email" bez wyjścia.

**Implikacja dla flow w §5 krok 4 (`POST /api/consent`):**

- W **dev** (`enable_confirmations = false`): `signUp()` zwraca `session ≠ null`, więc `/api/consent` ma cookie i autoryzuje OK.
- W **prod** (`enable_confirmations = true`): `signUp()` zwraca `session = null` → `/api/consent` zwróci `401 unauthorized` (handler wymaga zalogowanego usera, `api-plan.md` §2.1.consent).
- **Decyzja:** w prod krok 2 (bundle zgody) musi zostać przesunięty na **post-confirmation** — czyli wykonany po kliknięciu linka weryfikacyjnego, w `/[locale]/auth/callback`, gdy sesja jest aktywna. Forma rejestracji w UI musi:
  - W dev: zaakceptować checkbox zgody, wywołać `signUp` → następnie `POST /api/consent`.
  - W prod: zaakceptować checkbox zgody, **zachować** akceptowane typy + version w sessionStorage (klucz `welderdoc_pending_consent`), wywołać tylko `signUp`. Po kliknięciu linka i utworzeniu sesji w `/auth/callback` odczytać sessionStorage i wykonać `POST /api/consent`.
  - Serwis `registerUser()` przyjmuje flagę `requiresEmailConfirmation: boolean` (z `process.env.NEXT_PUBLIC_REQUIRE_EMAIL_CONFIRMATION` lub odczyt z `data.session === null`) i decyduje, czy wywołać `/api/consent` natychmiast, czy odłożyć.
- **Alternatywa (uproszczenie):** zawsze odkładamy `POST /api/consent` na post-confirmation — eliminuje rozgałęzienie dev/prod kosztem dodatkowego kroku w dev. Rekomendowana dla MVP (mniej ścieżek = mniej bugów).

### 6.3 Walidacja

| Layer | Reguła |
|---|---|
| Client preflight (UX) | `email` matches `^[^\s@]+@[^\s@]+\.[^\s@]+$`; `password.length >= 8`; `password.length <= 72` (bcrypt limit GoTrue); checkbox zgody zaznaczony |
| GoTrue (autorytet) | `email` valid; `password.length >= 8` (`auth.password.min_length`); brak duplikatu na `auth.users.email` |
| DB (defense-in-depth) | `user_profiles.locale CHECK (locale IN ('pl','en'))` zabezpiecza trigger `handle_new_user()` |

### 6.4 Wektory ataków i mitygacje

| Wektor | Mitygacja |
|---|---|
| **Mass sign-up / botnet** | `supabase/config.toml [auth.rate_limit] sign_in_sign_ups = 30 / 5min / IP` (już w MVP); Vercel BotID — TODO przed publicznym launchem |
| **Mail-flood przez resend** | `email_sent = 4 / godzinę / IP` (już w MVP); UI countdown 60s na przycisku "Wyślij ponownie" |
| **Email enumeration** | Akceptowany trade-off MVP — `User already registered` ujawnia istnienie konta. Mitygacja: rate limit `sign_in_sign_ups` ogranicza tempo. Post-MVP: rozważyć generic message + ustalenie istnienia konta przez reset password flow. |
| **Weak password** | GoTrue `min_length = 8` server-side; UI miernik siły hasła (UX) |
| **Password w logach** | Forbidden — nie loguj `password` w żadnym `console.log` / Sentry breadcrumb / telemetrii. Code review enforcement; opcjonalnie ESLint custom rule blokujący `password` w `console.*` calls |
| **Session hijacking po confirmation** | Link weryfikacyjny ma TTL 24h (Supabase default); serwowane wyłącznie po HTTPS (Vercel default); `Set-Cookie` flagi `Secure`, `HttpOnly`, `SameSite=Lax` (Supabase SSR default) |
| **Trigger handle_new_user() w SECURITY DEFINER** | Upewnić się, że funkcja **nie** odczytuje `current_setting('request.jwt.claims', true)` bez `COALESCE` (rejestracja jest anonim — JWT pusty); migracja `20260507000000_complete_schema.sql` musi być przeglądnięta (out-of-scope tego planu — patrz `db-supabase-migrations.md`) |
| **Bypass triggera `block_protected_columns_update`** | Klient **nie może** ustawić `current_consent_version` przez `supabase.from('user_profiles').update(...)` — RLS + trigger blokują. Wyłączny writer: `/api/consent` przez RPC SECURITY DEFINER. |
| **RLS na `documents` wymaga `email_confirmed_at IS NOT NULL`** | Defense-in-depth — niezależnie od UI, niepotwierdzone konta nie utworzą projektów. Krytyczne dla prod, by rejestracja nie była wektorem nadużyć (mass-creation niepotwierdzonych kont nie ma efektu). |

### 6.5 Polityka cookies / CSRF

- Endpoint POST do GoTrue używa `apikey` header — nie cookies — więc CSRF nie dotyczy.
- Krok 2 `POST /api/consent` używa cookies sesji + standardowej polityki SameSite=Lax — chroni przed CSRF dla zalogowanych userów.

---

## 7. Error Handling

### 7.1 Mapowanie błędów Auth

`src/lib/supabase/errors.ts` (do utworzenia) eksportuje `mapAuthError(err: AuthError | null): MappedError | null` — pełen szkic w `api-plan.md` §9.1.

```typescript
export function mapAuthError(err: AuthError | null): MappedError | null {
  if (!err) return null;
  switch (err.message) {
    case 'Invalid login credentials':
      return { business: BusinessError.INVALID_CREDENTIALS, message: 'errors.invalid_credentials' };
    case 'Email not confirmed':
      return { business: BusinessError.EMAIL_NOT_CONFIRMED, message: 'errors.email_not_confirmed' };
    case 'User already registered':
      return {
        business: BusinessError.EMAIL_ALREADY_REGISTERED,
        message: 'errors.email_already_registered',
      };
    default:
      // Heurystyka: GoTrue zmienia tekst między wersjami — łapiemy frazy zamiast exact match
      const m = err.message.toLowerCase();
      if (m.includes('password') && m.includes('characters')) {
        return { business: BusinessError.PASSWORD_TOO_WEAK, message: 'errors.password_too_weak' };
      }
      if (err.status === 429 || m.includes('rate limit')) {
        return { business: BusinessError.RATE_LIMITED, message: 'errors.rate_limited' };
      }
      return {
        business: BusinessError.UNKNOWN,
        message: 'errors.unknown',
        rawMessage: err.message,
      };
  }
}
```

### 7.2 Tabela scenariuszy

| Scenariusz | Detekcja | Reakcja UI |
|---|---|---|
| Użytkownik podał istniejący email | `mapAuthError → EMAIL_ALREADY_REGISTERED` | Toast `errors.email_already_registered` + CTA "Zaloguj się" |
| Hasło za krótkie | `mapAuthError → PASSWORD_TOO_WEAK` | Inline field error `errors.password_too_weak` |
| Email niepoprawny format | Preflight regex (przed wywołaniem) | Inline field error `errors.email_invalid` |
| 429 rate limit | `mapAuthError → RATE_LIMITED` | Toast `errors.rate_limited`, disable submit na 60s |
| Sieć/timeout | `error instanceof TypeError` lub `signUp` rzuca | Toast `errors.network_error`, retry CTA |
| Krok 2 (`/api/consent`) failuje (dev only) | Status 4xx/5xx | Toast `errors.consent_failed`, użytkownik utworzony ale bez zgody — UX prosi o powrót i akceptację (re-trigger consent po sign-in) |
| Brak SMTP w prod | Sukces signUp ale email nie dochodzi | UI nie wykryje — ostrzeżenie w opisie strony "Sprawdź spam, w razie problemu napisz na…"; monitoring SMTP bounce rate w Resend dashboard |
| Nieobsłużony błąd GoTrue | `mapAuthError → UNKNOWN` z `rawMessage` | Toast `errors.unknown`; loguj `rawMessage` do Sentry (post-MVP) |

### 7.3 Logowanie błędów

- Brak dedykowanej tabeli `error_log` w schemacie (`db-plan.md`). Błędy GoTrue logowane są przez Supabase Cloud (Auth logs).
- Aplikacja **nie** loguje `password`, `email`, ani `rawMessage` z PII do Sentry/console.
- Klucz `rawMessage` w `MappedError` przeznaczony tylko do dev console; usunąć z payloadu w prod build (TODO przed Sentry integration).

---

## 8. Performance Considerations

| Element | Koszt | Notatka |
|---|---|---|
| `supabase.auth.signUp()` (HTTPS round-trip do EU-Frankfurt) | ~150-300 ms | Dominanta — bcrypt cost factor 10 (Supabase default) ~80ms |
| Trigger `on_auth_user_created` (`SECURITY DEFINER`) | ~5-10 ms | Pojedynczy INSERT do `user_profiles` |
| SMTP send (Resend/Postmark) | async, queued | Nie blokuje response; bounce rate monitorowany w Resend dashboard |
| `POST /api/consent` (krok 2, jeśli synchroniczny) | ~80-150 ms | Vercel `fra1` ↔ Supabase EU-Frankfurt; RPC `record_consent_bundle()` to 3× INSERT + 1× UPDATE w transakcji |
| Łączny czas (dev, oba kroki) | ~250-500 ms p95 | Mieści się w PRD §3.2 budżecie odpowiedzi (< 1s) |
| Łączny czas (prod, tylko krok 1) | ~150-300 ms p95 | Krok 2 odłożony do post-confirmation |

**Brak bottleneków wymagających optymalizacji w MVP.** Potencjalne post-MVP:

- Przeniesienie `signUp` na Server Action (eliminacja round-tripu klient → API → Supabase, ale komplikuje cookie handling — **nie zalecane**, klient bezpośrednio do Supabase Auth jest standardem).
- Captcha (Cloudflare Turnstile) — jeśli rate limit Supabase okaże się niewystarczający.

---

## 9. Implementation Steps

> **Pre-condition:** ten plan zakłada, że wszystkie cztery migracje DB są już zaaplikowane (są — patrz `CLAUDE.md` § "Currently implemented") oraz że `/api/consent`, `/api/health`, `/api/user/export`, `/api/paddle/webhook` istnieją (też są).

### Krok 1 — Implementacja `src/lib/supabase/errors.ts` (blocker)

1.1. Utwórz plik `src/lib/supabase/errors.ts` zgodnie z pełnym szkicem z `api-plan.md` §9.1 (cały enum `BusinessError`, `MappedError`, `mapPostgrestError`, `mapAuthError`).

1.2. Eksportuj wszystko (named exports — żaden default).

1.3. Dodaj test jednostkowy `src/lib/supabase/errors.test.ts`:

- `mapAuthError(null)` → `null`
- `mapAuthError({ message: 'User already registered' })` → `{ business: 'email_already_registered', message: 'errors.email_already_registered' }`
- `mapAuthError({ message: 'Password should be at least 6 characters' })` → `{ business: 'password_too_weak', ... }`
- Rate limit branch (`status: 429`)
- Fallback `UNKNOWN` z `rawMessage`

1.4. Dodaj klucze i18n w `src/messages/pl.json` i `src/messages/en.json`:

```json
{
  "errors": {
    "email_already_registered": "Konto z tym adresem e-mail już istnieje.",
    "password_too_weak": "Hasło musi mieć minimum 8 znaków.",
    "email_invalid": "Niepoprawny format adresu e-mail.",
    "rate_limited": "Zbyt wiele prób. Spróbuj ponownie za chwilę.",
    "network_error": "Brak połączenia z serwerem.",
    "consent_failed": "Nie udało się zapisać zgody. Spróbuj ponownie.",
    "unknown": "Wystąpił nieznany błąd."
  }
}
```

(EN — analogiczne tłumaczenia.)

### Krok 2 — Konfiguracja Supabase Auth

2.1. Sprawdź `supabase/config.toml` i upewnij się że ma:

```toml
[auth]
enable_confirmations = true   # produkcja; w lokalnym dev można false dla szybszego flow

[auth.password]
min_length = 8

[auth.rate_limit]
email_sent = 4
sign_in_sign_ups = 30
token_refresh = 150
```

2.2. **Production guardrail (manualny check przed pierwszym deployem):**

- Supabase Cloud → Auth → Settings → `Enable email confirmations = ON`
- Custom SMTP (Resend/Postmark) skonfigurowany z weryfikowaną domeną
- Site URL: `${NEXT_PUBLIC_APP_URL}` (np. `https://welderdoc.app`)
- Redirect URLs zawiera: `${NEXT_PUBLIC_APP_URL}/auth/callback`

### Krok 3 — Serwis rejestracji `src/lib/auth/registration.ts`

3.1. Utwórz plik z funkcją `registerUser(command: RegisterUserCommand): Promise<RegisterUserResult>` (sygnatury z §3.4).

3.2. Implementacja (uproszczona — krok 2 zawsze odkładany do post-confirmation):

```typescript
'use client';

import { createClient } from '@/lib/supabase/client';
import { mapAuthError, BusinessError } from '@/lib/supabase/errors';
import type { ConsentType } from '@/types/api';
import type { User, Session } from '@supabase/supabase-js';

export interface RegisterUserCommand {
  email: string;
  password: string;
  consent: {
    types: [ConsentType, ...ConsentType[]];
    version: string;
    accepted: true;
  };
}

const PENDING_CONSENT_KEY = 'welderdoc_pending_consent';

export async function registerUser(command: RegisterUserCommand) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email: command.email,
    password: command.password,
  });

  if (error) {
    return { ok: false as const, step: 'signup' as const, error: mapAuthError(error)! };
  }

  // Zachowaj bundle zgody do wykonania po kliknięciu linka weryfikacyjnego
  // (sesja jest null w prod do confirmation — /api/consent zwróciłby 401).
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(
      PENDING_CONSENT_KEY,
      JSON.stringify({
        types: command.consent.types,
        version: command.consent.version,
        accepted: command.consent.accepted,
      })
    );
  }

  return {
    ok: true as const,
    user: data.user!,
    session: data.session,
    consentDeferred: data.session === null,
  };
}

/**
 * Wywoływane z /[locale]/auth/callback po pomyślnym potwierdzeniu emaila.
 * Odczytuje bundle zgody z sessionStorage i wykonuje POST /api/consent.
 */
export async function flushPendingConsent(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (typeof window === 'undefined') return { ok: false, reason: 'ssr' };
  const raw = sessionStorage.getItem(PENDING_CONSENT_KEY);
  if (!raw) return { ok: true }; // nic do zrobienia

  try {
    const body = JSON.parse(raw);
    const res = await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, reason: `consent_status_${res.status}` };
    }
    sessionStorage.removeItem(PENDING_CONSENT_KEY);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'consent_parse_error' };
  }
}
```

3.3. Test jednostkowy `src/lib/auth/registration.test.ts`:

- Mock `createClient` → `auth.signUp` zwraca `{ data: { user, session: null }, error: null }` → wynik `ok: true, consentDeferred: true`, sessionStorage ma payload zgody
- Mock `auth.signUp` rzuca `User already registered` → wynik `ok: false, step: 'signup', error.business = EMAIL_ALREADY_REGISTERED`
- `flushPendingConsent()` z payloadem w sessionStorage → fetch wywołany, sessionStorage wyczyszczony

### Krok 4 — UI: strona `/[locale]/auth/sign-up/page.tsx`

4.1. Utwórz Client Component `SignUpForm` w `src/app/[locale]/auth/sign-up/_components/SignUpForm.tsx`:

- Pola: `email`, `password`, checkboxy zgód (`terms_of_service`, `privacy_policy`, `cookies` — wszystkie wymagane)
- Preflight walidacja: email regex, password length ≥ 8, wszystkie checkboxy zaznaczone
- Submit → `registerUser(...)` → na sukces redirect do `/[locale]/auth/check-email?email=…`
- Na `EMAIL_ALREADY_REGISTERED` → CTA "Zaloguj się" (link do `/[locale]/auth/sign-in`)
- Wszystkie stringi z `useTranslations('auth.signUp')`

4.2. Utwórz Server Component `page.tsx`:

```tsx
import { setRequestLocale } from 'next-intl/server';
import { SignUpForm } from './_components/SignUpForm';

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SignUpForm />;
}

export function generateStaticParams() {
  return [{ locale: 'pl' }, { locale: 'en' }];
}
```

4.3. Dodaj klucze tłumaczeń sekcji `auth.signUp.*` w `src/messages/{pl,en}.json` (label, placeholder, submit, terms_label, etc.).

### Krok 5 — Strona `/[locale]/auth/check-email`

5.1. Statyczna strona z komunikatem "Sprawdź skrzynkę: {email}" + CTA "Wyślij ponownie".

5.2. CTA wywołuje `supabase.auth.resend({ type: 'signup', email })` (z parametru URL). 60s countdown na przycisku.

5.3. (Out-of-scope tego planu — szczegóły w `resend-verification-email-post-endpoint-data.md`.)

### Krok 6 — Strona `/[locale]/auth/callback`

6.1. Server Component który obsługuje PKCE flow Supabase (token z URL → wymiana na sesję).

6.2. Po utworzeniu sesji wywołuje `flushPendingConsent()` (Client Component lub Server Action — preferowany Client po kierunku `'use client'` w `registration.ts`).

6.3. Następnie redirect do `/[locale]/` (główna strona aplikacji).

6.4. (Częściowo out-of-scope — szczegóły zostaną w planie endpointa logowania.)

### Krok 7 — Walidacja preflight (klient-side regex)

7.1. Wydziel helper `src/lib/auth/validation.ts`:

```typescript
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim()) && email.length <= 254; // RFC 5321
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 72;
}
```

7.2. Test jednostkowy `src/lib/auth/validation.test.ts` (kilka pozytywnych + negatywnych przypadków).

### Krok 8 — Testy E2E (Playwright)

8.1. `e2e/auth/sign-up.spec.ts`:

- Wypełnij formularz (unikalny email per test run, np. `e2e+${Date.now()}@example.com`)
- Submit → assert redirect do `/auth/check-email`
- (Opcjonalnie, w lokalnym dev z `enable_confirmations = false`) — zweryfikuj że user jest zalogowany i ma `user_profiles` z `plan='free'`, `locale='pl'`

8.2. `e2e/auth/sign-up-duplicate.spec.ts`:

- Pierwszy submit → sukces
- Drugi submit z tym samym emailem → toast "Konto z tym adresem e-mail już istnieje"

### Krok 9 — Audyt PR (checklist)

Per `CLAUDE.md` "PR checklist for auth implementation (US-002 sign-in)" — analogicznie dla sign-up:

- [ ] `src/lib/supabase/errors.ts` istnieje i ma `mapAuthError` (krok 1)
- [ ] Brak `password` w `console.log` / Sentry breadcrumbs / fetch logs
- [ ] Wszystkie stringi w UI przez `useTranslations`
- [ ] Klucze i18n `errors.email_already_registered`, `errors.password_too_weak`, `errors.rate_limited` istnieją w `pl.json` i `en.json`
- [ ] `setRequestLocale(locale)` na początku każdego `page.tsx` / `layout.tsx`
- [ ] `generateStaticParams()` zwraca oba locale
- [ ] Coverage thresholds dla `src/lib/auth/**` — lines/functions 80%, branches 70%, statements 80% (zostanie auto-rozszerzone z `src/lib/**` glob w `vitest.config.ts`)
- [ ] **Manual prod check przed pierwszym deployem:** Supabase Cloud `enable_confirmations = ON` + custom SMTP skonfigurowany (krok 2.2)
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test:run` + `pnpm test:e2e -- --project=chromium-desktop` zielone

### Krok 10 — Dokumentacja

10.1. Zaktualizuj `CLAUDE.md` sekcja "Currently implemented in `src/lib/`":

- Dodaj `auth/registration.ts` i `auth/validation.ts` do listy zaimplementowanych
- Usuń `supabase/errors.ts` z listy "Not yet implemented"

10.2. Brak zmian w `api-plan.md` (sygnatura endpointa nie uległa zmianie).
