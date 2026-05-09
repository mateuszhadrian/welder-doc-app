# API Endpoint Implementation Plan: Resend Verification Email (POST /auth/v1/resend)

## 1. Endpoint Overview

Endpoint odpowiedzialny za **ponowne wysłanie maila weryfikacyjnego** użytkownikowi, który ukończył rejestrację (US-001 follow-up, kamień m5), ale nie kliknął jeszcze linku potwierdzającego adres e-mail.

Cechy:

- Endpoint **nie jest custom Route Handlerem WelderDoc** — to natywny endpoint Supabase Auth (`POST {SUPABASE_URL}/auth/v1/resend`) wywoływany **wyłącznie przez Supabase Auth SDK** (`supabase.auth.resend(...)`).
- Brak warstwy serwerowej w `src/app/api/...`. Implementacja sprowadza się do: (1) UI komponentu z przyciskiem „Wyślij ponownie" + countdown 60s, (2) helpera klienckiego wywołującego `auth.resend`, (3) mapowania błędów przez `mapAuthError` (`BusinessError.RATE_LIMITED` / `BusinessError.UNKNOWN`), (4) tłumaczeń PL/EN.
- Endpoint jest publiczny (brak sesji JWT — user dopiero co się zarejestrował i nie potwierdził e-maila).
- Rate limiting po stronie Supabase Auth (4 maile / godzinę / IP; wbudowany 60s cooldown w GoTrue) — UI musi to mirrorować przez countdown.

PRD/architektura: `prd.md` US-001 (rejestracja), `api-plan.md` §2.2 „Ponowne wysłanie maila weryfikacyjnego", `architecture-base.md` §17 (auth flow).

---

## 2. Request Details

- **HTTP Method:** `POST`
- **URL Structure:** `{NEXT_PUBLIC_SUPABASE_URL}/auth/v1/resend` (zarządzany przez Supabase GoTrue; nie tworzymy własnego endpointu).
- **Wywołanie:** wyłącznie przez SDK — nigdy przez `fetch` lub `axios` bezpośrednio.
- **Klient SDK:** `createClient()` z `src/lib/supabase/client.ts` (browser client) lub `src/lib/supabase/server.ts` (server-side, jeśli użyte z Server Action / Server Component — w MVP tylko ścieżka kliencka po rejestracji).

### Parametry

- **Wymagane (w body wywołania `auth.resend(...)`):**
  - `type`: `'signup' | 'email_change' | 'recovery'` — dla US-001 zawsze `'signup'`.
  - `email`: `string` — adres e-mail, na który ma trafić nowy link weryfikacyjny.
- **Opcjonalne:** brak (Supabase Auth SDK akceptuje opcjonalny `options.emailRedirectTo`, ale w MVP używamy domyślnego z konfiguracji projektu Supabase — patrz `supabase/config.toml`).

### Request Body (logiczny, opakowany przez SDK)

```typescript
{
  type: 'signup',
  email: 'user@example.com'
}
```

SDK automatycznie dodaje nagłówki `apikey` i `Content-Type: application/json` używając `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 3. Used Types

### DTO / Command Models — nowe (do dodania do `src/types/api.ts`)

```typescript
// Command wywołania resend (mirror sygnatury supabase.auth.resend()).
// Zawężone do 'signup' bo MVP US-001 nie obsługuje 'email_change' / 'recovery'
// na tej ścieżce UI (recovery idzie przez resetPasswordForEmail).
export type ResendVerificationEmailType = 'signup' | 'email_change' | 'recovery';

export interface ResendVerificationEmailCommand {
  type: ResendVerificationEmailType;
  email: string;
}
```

### Istniejące typy używane w warstwie błędów

- `BusinessError` (enum) — z `src/lib/supabase/errors.ts` (do utworzenia per `api-plan.md` §9). Wartości używane na tej ścieżce:
  - `BusinessError.RATE_LIMITED` — przy przekroczeniu limitu Supabase Auth.
  - `BusinessError.UNKNOWN` — fallback dla pozostałych `AuthError`.
- `MappedError` — typ zwracany z `mapAuthError(err)` — `{ business: BusinessError; message: string (i18n key); rawMessage?: string }`.

### Typy zewnętrzne (Supabase SDK)

- `AuthError` z `@supabase/supabase-js` — wejście do `mapAuthError`.
- `AuthOtpResponse` (return type `auth.resend`) — kształt `{ data: { user: User | null; session: Session | null } | null; error: AuthError | null }`.

---

## 4. Response Details

### Sukces

```json
{ "data": null, "error": null }
```

- **Status (z perspektywy SDK):** `200 OK`.
- **UI:** komunikat „Mail został wysłany ponownie. Sprawdź swoją skrzynkę." + włączenie countdown 60s na przycisku.
- **Brak side-effectu w naszej bazie** — `auth.users` jest tylko czytane przez GoTrue dla weryfikacji istnienia usera; tabele `public.*` nietknięte.

### Błędy (rzucane jako `error: AuthError`)

| Stan | `error.message` (raw) | Po mapowaniu | UI (i18n key) |
|---|---|---|---|
| Cooldown 60s | `For security purposes, you can only request this once every 60 seconds` | `BusinessError.RATE_LIMITED` | `errors.resend_cooldown` (lub generic `errors.rate_limited`) |
| Limit godzinowy | `Email rate limit exceeded` | `BusinessError.RATE_LIMITED` | `errors.email_rate_limited` |
| Walidacja typu/emaila | `Invalid request` / `Email rate limit exceeded` (zależnie) | `BusinessError.UNKNOWN` | `errors.unknown` |
| Pozostałe | dowolny `AuthError` | `BusinessError.UNKNOWN` | `errors.unknown` |

> **Uwaga bezpieczeństwa:** Supabase Auth **nie ujawnia** czy email istnieje — tożsamy response (`data: null, error: null`) jest zwracany dla nieznanych emaili. Nie próbować rozróżniać „user exists / nie exists" w UI. Patrz §6.

---

## 5. Data Flow

```
User klika „Nie dostałem maila — wyślij ponownie"
        │
        ▼
[komponent React, 'use client']
  ResendVerificationButton.tsx
    ├─ disabled gdy countdown > 0
    └─ onClick → resendVerificationEmail({ email, type: 'signup' })
        │
        ▼
[helper kliencki]
  src/lib/auth/resendVerificationEmail.ts
    ├─ const supabase = createClient()  (browser, src/lib/supabase/client.ts)
    ├─ const { error } = await supabase.auth.resend({ type, email })
    ├─ if (error) → return { ok: false, mapped: mapAuthError(error) }
    └─ return { ok: true }
        │
        ▼
[Supabase Auth GoTrue]
  POST /auth/v1/resend
    ├─ rate-limit: 60s cooldown per (email, type) + 4/h/IP (email_sent)
    ├─ jeśli OK i user istnieje + niezweryfikowany → wyślij mail przez SMTP
    └─ jeśli user nieznany → nadal zwraca sukces (anty-enumeration)
        │
        ▼
[komponent — render po response]
  ├─ ok=true → toast „mail wysłany" + start countdown 60s
  ├─ ok=false + mapped.business=RATE_LIMITED → komunikat z i18n key
  └─ ok=false + mapped.business=UNKNOWN → toast generic „spróbuj ponownie"
```

### Brak interakcji z naszymi tabelami

- `public.user_profiles`, `public.consent_log`, `public.documents` — **nietknięte**.
- `auth.users` — read-only przez GoTrue (sprawdza istnienie usera, status `email_confirmed_at`).
- Brak wpisu do `webhook_events` (resend nie wywołuje webhooków Paddle ani naszych).

### Zewnętrzne zależności

- **SMTP** — produkcyjnie skonfigurowany custom SMTP (Resend / Postmark — patrz `api-plan.md` §6, decyzja wdrożeniowa). W lokalnym `supabase start` używany jest Inbucket (port 54324).
- **`supabase/config.toml`** — `[auth.email]` definiuje template `confirm`, oraz `[auth.rate_limit]` `email_sent = 4`.

---

## 6. Security Considerations

### Zagrożenia i mitygacje

| Zagrożenie | Mitygacja |
|---|---|
| **Email enumeration** (atakujący sprawdza, czy email istnieje w bazie) | Supabase Auth z założenia zwraca **identyczny success response** dla nieznanego emaila. UI nie może rozróżniać. NIE pokazywać komunikatu „user nie istnieje". |
| **Mail flood / spam** (atakujący wciska przycisk w pętli) | (1) Supabase 60s cooldown per (email, type). (2) Supabase `email_sent = 4 / h / IP`. (3) UI wymusza countdown 60s (disabled button), żeby nie polegać tylko na backendzie. |
| **CSRF** | SDK używa anon key + brak ciasteczek session — żaden zapis się nie dokonuje przez sesję usera. CSRF tokeny niepotrzebne. |
| **Token / klucze** | Wywołujemy z anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — to publiczny klucz; nie wystawia danych przez RLS. **Nigdy** nie używać `SUPABASE_SERVICE_ROLE_KEY` na tej ścieżce. |
| **Open redirect via `emailRedirectTo`** | W MVP nie przekazujemy custom `options.emailRedirectTo` z UI. Default redirect URL jest pinnowany w Supabase Dashboard → Authentication → URL Configuration → Redirect URLs (whitelist). Jeśli kiedyś pojawi się parametr, walidować po stronie konfiguracji. |
| **Walidacja inputu (email format)** | Walidacja klient-side przed wywołaniem SDK (np. Zod / `RegExp` `/.+@.+\..+/` lub HTML5 input `type="email"`). Druga linia: GoTrue również zwróci `AuthError` dla niepoprawnego formatu. |
| **`type` nie z whitelisty** | TypeScript typ `ResendVerificationEmailType` jako union literałów — nie da się wywołać helpera z innym stringiem (typecheck blokuje). |

### Authentication / Authorization

- **Brak** — endpoint publiczny. Świadomie: user nie ma jeszcze potwierdzonego e-maila, więc nie ma usable JWT.

### Logowanie

- **Nie logujemy w `webhook_events`** ani w żadnej z naszych tabel — to byłoby naruszenie PII (gromadzenie e-maili niezweryfikowanych w bazie).
- **Nie logujemy w `consent_log`** — żaden consent się nie zmienia.
- W konsoli (dev only) `console.warn` dla `mapped.business !== BusinessError.UNKNOWN`, żeby przy debugowaniu lokalnym widzieć rate-limity. **W produkcji wyciszyć** (`if (process.env.NODE_ENV !== 'production')`).

---

## 7. Error Handling

Lista scenariuszy + reakcja UI / helpera. Wszystkie kody „status" są kodami logicznymi z perspektywy aplikacji — Supabase Auth zwraca `200` z `{ error: AuthError }` w body.

| Scenariusz | Wykrycie | Logiczny status | Reakcja |
|---|---|---|---|
| Sukces | `error === null` | 200 | Toast „mail wysłany"; start countdown 60s; przycisk disabled |
| Cooldown 60s (Supabase) | `error.message` zawiera `you can only request this once every 60 seconds` | 429 | `mapAuthError` → `RATE_LIMITED`; pokaż komunikat „Spróbuj za chwilę"; **uruchom lokalny countdown 60s i tak** (idempotentnie) |
| Limit godzinowy | `error.message === 'Email rate limit exceeded'` | 429 | `mapAuthError` → `RATE_LIMITED`; komunikat „Spróbuj ponownie za godzinę" (i18n: `errors.email_rate_limited`); button pozostaje disabled przez 60s |
| Walidacja emaila po stronie klienta | helper sprawdza format zanim wywoła SDK | 400 (logiczny) | Inline error pod inputem; nie wywołuj SDK |
| `type` poza unionem | TypeScript blokuje | n/a | (compile-time) |
| Błąd sieci | `error` instance of `TypeError`/`FetchError` (zależnie od polyfilla) | n/a | Toast „brak połączenia"; przycisk **nie** wchodzi w cooldown |
| Inny `AuthError` | fallback w `mapAuthError` | 500 (logiczny) | Toast generic `errors.unknown`; przycisk **nie** wchodzi w cooldown |
| Internal Server Error po stronie Supabase | `error.status >= 500` | 500 | `BusinessError.UNKNOWN`; toast generic; brak retry automatycznego |

### Mapowanie do `mapAuthError`

`mapAuthError` (`api-plan.md` §9) **nie** ma jeszcze gałęzi dla rate-limitu resend. Należy ją **dodać** w trakcie implementacji `src/lib/supabase/errors.ts`:

```typescript
// W mapAuthError, przed default:
if (
  err.message.includes('you can only request this once every 60 seconds') ||
  err.message === 'Email rate limit exceeded'
) {
  return {
    business: BusinessError.RATE_LIMITED,
    message: 'errors.rate_limited',
    rawMessage: err.message,
  };
}
```

(Wpis w `BusinessError.RATE_LIMITED` już istnieje per `api-plan.md` §9.1 enum.)

---

## 8. Performance Considerations

- **Wąskie gardło:** zewnętrzny SMTP (Resend / Postmark). Latencja maila to ~1–10s w produkcji; user widzi success natychmiast (Supabase Auth nie czeka na delivery).
- **Brak cache'owania** — każde wywołanie generuje nowy mail z nowym tokenem.
- **Countdown UI** zaimplementować przez `useEffect` z `setInterval(1000)` + state `secondsLeft: number`. Po unmount — `clearInterval`. Persistować pozostały czas w `sessionStorage` (klucz `welderdoc_resend_countdown_until`) tak, żeby refresh strony nie zerował 60s — **opcjonalne**, ale poprawia UX dla userów wykonujących nawigację po kliknięciu „wyślij ponownie".
- **Bundle size:** `@supabase/supabase-js` jest już w bundlu (rejestracja go używa). Brak dodatkowego importu.
- **Brak SSR** — komponent z przyciskiem `'use client'`. Nie próbować server-side `auth.resend` (rate-limit per IP odpalałby się na IP serwera Vercel — rujnuje limit dla wszystkich userów z tej samej funkcji).

---

## 9. Implementation Steps

### Krok 1 — Uzupełnienie typów

**Plik:** `src/types/api.ts`

Dodać:

```typescript
export type ResendVerificationEmailType = 'signup' | 'email_change' | 'recovery';

export interface ResendVerificationEmailCommand {
  type: ResendVerificationEmailType;
  email: string;
}
```

### Krok 2 — Dodać gałąź rate-limitu w `mapAuthError`

**Plik:** `src/lib/supabase/errors.ts` (do utworzenia per `api-plan.md` §9 — jeśli jeszcze nie istnieje, wykonać razem; jeśli już jest — uzupełnić).

W funkcji `mapAuthError(err)`, przed gałęzią `default`, dodać sprawdzenie 60s cooldown i `Email rate limit exceeded` → `BusinessError.RATE_LIMITED` (kod w §7 powyżej).

Dopisać test jednostkowy w `src/lib/supabase/errors.test.ts` (co-located, per CLAUDE.md):

```typescript
it('maps Supabase 60s cooldown to RATE_LIMITED', () => {
  const err = { message: 'For security purposes, you can only request this once every 60 seconds' } as AuthError;
  expect(mapAuthError(err)?.business).toBe(BusinessError.RATE_LIMITED);
});

it('maps email rate limit to RATE_LIMITED', () => {
  const err = { message: 'Email rate limit exceeded' } as AuthError;
  expect(mapAuthError(err)?.business).toBe(BusinessError.RATE_LIMITED);
});
```

### Krok 3 — Helper kliencki

**Plik (nowy):** `src/lib/auth/resendVerificationEmail.ts`

```typescript
'use client';

import { createClient } from '@/lib/supabase/client';
import { mapAuthError, type MappedError } from '@/lib/supabase/errors';
import type { ResendVerificationEmailCommand } from '@/types/api';

export type ResendVerificationEmailResult =
  | { ok: true }
  | { ok: false; mapped: MappedError };

export async function resendVerificationEmail(
  cmd: ResendVerificationEmailCommand,
): Promise<ResendVerificationEmailResult> {
  const supabase = createClient();
  const { error } = await supabase.auth.resend({
    type: cmd.type,
    email: cmd.email,
  });

  if (error) {
    const mapped = mapAuthError(error);
    return { ok: false, mapped: mapped ?? { business: 'unknown' as const, message: 'errors.unknown' } as MappedError };
  }
  return { ok: true };
}
```

### Krok 4 — UI: przycisk „Wyślij ponownie" z countdownem

**Plik (nowy):** `src/components/auth/ResendVerificationButton.tsx`

Założenia:

- `'use client'`.
- Props: `email: string` (przekazany z formularza rejestracji / strony `/[locale]/verify-email`).
- Stan: `secondsLeft: number`, `isPending: boolean`, `feedback: { kind: 'success' | 'error'; key: string } | null`.
- `onClick`:
  1. `setIsPending(true)`.
  2. `const res = await resendVerificationEmail({ type: 'signup', email })`.
  3. `setIsPending(false)`.
  4. Sukces → `setFeedback({ kind: 'success', key: 'auth.resend.success' })` + start countdown.
  5. Porażka → `setFeedback({ kind: 'error', key: res.mapped.message })`. Jeśli `business === 'rate_limited'` → start countdown 60s.
- Persistencja countdown w `sessionStorage` (opcjonalna, `welderdoc_resend_countdown_until`).
- `useTranslations('auth.resend')` dla wszystkich stringów.

### Krok 5 — i18n

**Pliki:** `src/messages/pl.json`, `src/messages/en.json`

Dodać sekcję `auth.resend`:

```json
{
  "auth": {
    "resend": {
      "button": "Wyślij ponownie",
      "buttonCountdown": "Wyślij ponownie ({seconds}s)",
      "success": "Mail wysłany. Sprawdź skrzynkę.",
      "rateLimited": "Spróbuj ponownie za godzinę.",
      "cooldown": "Spróbuj za chwilę.",
      "unknownError": "Coś poszło nie tak. Spróbuj ponownie."
    }
  },
  "errors": {
    "rate_limited": "Spróbuj ponownie później.",
    "email_rate_limited": "Przekroczono limit wysyłki maili. Spróbuj za godzinę."
  }
}
```

(Analogicznie w EN.)

### Krok 6 — Wpięcie w UI rejestracji

W komponencie strony post-rejestracja (`src/app/[locale]/verify-email/page.tsx` lub modal po `signUp` w formularzu rejestracji — zgodnie z UX flow US-001):

- Wyrenderować `<ResendVerificationButton email={email} />`, gdzie `email` pochodzi z payloadu rejestracji.
- Pamiętać o `setRequestLocale(locale)` w `page.tsx` przed użyciem hooków `next-intl` (per CLAUDE.md i tech-stack).

### Krok 7 — Testy

**Unit (Vitest):**

- `src/lib/auth/resendVerificationEmail.test.ts` — mock `createClient` z `src/lib/supabase/client.ts` (`vi.mock`), zweryfikować:
  - `ok: true` przy `error === null`.
  - `ok: false` + `business: RATE_LIMITED` przy `AuthError` z message 60s cooldown.
  - `ok: false` + `business: UNKNOWN` przy nieznanym `AuthError`.
- `src/components/auth/ResendVerificationButton.test.tsx` — `@testing-library/react` + `user-event`:
  - Przycisk klikalny przy `secondsLeft === 0`.
  - Po kliknięciu: pending → success → countdown ticks down.
  - Po `RATE_LIMITED`: feedback widoczny + countdown wystartowany.

**E2E (Playwright):**

- `e2e/auth/resend-verification.spec.ts`:
  - Rejestracja → przekierowanie na `/[locale]/verify-email` → sprawdzenie że przycisk jest widoczny i klikalny → po kliknięciu countdown wystartowany. (Nie testujemy faktycznego maila — to integracyjny tor Supabase + SMTP.)

### Krok 8 — Konfiguracja Supabase (sanity check, nie kod)

- Zweryfikować w `supabase/config.toml`:
  - `[auth.email] enable_confirmations = true` (potwierdzenie email wymagane).
  - `[auth.rate_limit] email_sent = 4` (per `api-plan.md` §6).
  - `[auth.email.template.confirm]` ustawiony (lub używamy default GoTrue).
- W produkcji: w Supabase Dashboard → Authentication → SMTP Settings — podpiąć custom SMTP (Resend / Postmark). Bez tego rate-limit produkcyjny GoTrue jest 3 maile / godzinę dla wszystkich userów (nie 4 / IP).

### Krok 9 — Dokumentacja

- Aktualizacja `CLAUDE.md` sekcja „Currently implemented in `src/lib/`" o `src/lib/auth/resendVerificationEmail.ts`.
- (Opcjonalnie) wpis w `.ai/api-plan.md` §2.2 że gałąź `RATE_LIMITED` w `mapAuthError` została zaimplementowana.

### Krok 10 — Pre-merge checklista (per CLAUDE.md PR review)

- [ ] `pnpm lint` zielony.
- [ ] `pnpm typecheck` zielony.
- [ ] `pnpm test:run` zielony, coverage `src/lib/auth/**` ≥ 80% (per thresholds).
- [ ] `pnpm test:e2e -- --project=chromium-desktop` zielony (jeśli dodano E2E).
- [ ] Commit message zgodny z Conventional Commits (np. `feat(auth): add resend verification email helper + button`).
- [ ] Pre-commit hook (`lint-staged`) przeszedł — bez `--no-verify`.
- [ ] **Brak** custom Route Handlera w `src/app/api/auth/resend/...` (świadomie — używamy SDK).
- [ ] **Brak** importu `SUPABASE_SERVICE_ROLE_KEY` w nowym kodzie.
