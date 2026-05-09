# API Endpoint Implementation Plan: Password Reset Request (US-004)

## 1. Endpoint Overview

Inicjalizacja flow odzyskiwania hasła dla użytkownika, który zapomniał aktualnego hasła (PRD US-004). Endpoint **nie jest własnym Route Handlerem WelderDoc** — to bezpośrednie wywołanie Supabase Auth (`POST /auth/v1/recover`) przez SDK z poziomu publicznej strony `/[locale]/forgot-password`. GoTrue (Supabase Auth) generuje token PKCE i wysyła email z linkiem do callbacku WelderDoc, który po kliknięciu wymienia kod na sesję i pozwala ustawić nowe hasło (osobny endpoint — patrz `update-password-put-endpoint-data.md`).

Cele biznesowe i bezpieczeństwa:
- Odblokowanie konta bez kontaktu z supportem (US-004).
- Anti-enumeration: API zawsze zachowuje się jak sukces (silent fail dla nieistniejących adresów email), aby nie ujawniać, czy konto istnieje.
- Rate limiting flood-mailowy realizowany przez wbudowany limit GoTrue `email_sent = 4 / godzinę / IP` (`api-plan.md` §6.1).
- Bezpieczny redirect przez whitelistę URL'i w Supabase Auth Dashboard (PKCE flow z `code` i `next` jako params).

Konsumenci: tylko Client Component formularza (`/[locale]/forgot-password/page.tsx`). Endpoint jest publiczny — żaden Server Component go nie wywołuje.

## 2. Request Details

- HTTP Method: `POST` (po stronie GoTrue; klient wywołuje SDK, nie `fetch`)
- URL Structure: `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/recover` (transparentne dla deweloperów — zarządzane przez SDK)
- Wywołanie SDK (Client Component, browser):

```typescript
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/auth/callback?next=/reset-password`,
})
```

- Parameters:
  - **Required (SDK args):**
    - `email: string` — adres email użytkownika (format walidowany client-side i server-side przez GoTrue).
    - `redirectTo: string` — URL callbacku PKCE; **musi** być na whitelist'cie w Supabase Auth Settings → URL Configuration → Redirect URLs.
  - **Optional:** brak.
- Request Body (na poziomie HTTP do GoTrue, generowany automatycznie przez SDK):

```json
{
  "email": "user@example.com",
  "redirect_to": "https://welder.doc/pl/auth/callback?next=/reset-password"
}
```

- Authentication: **brak** (publiczny endpoint Supabase Auth — anon key wystarcza). JWT/cookies nieobecne.

## 3. Used Types

Endpoint nie wymaga żadnych dedykowanych DTO/Command Models w `src/types/api.ts`, ponieważ kontrakt jest zdefiniowany przez SDK Supabase. Typy używane w warstwie UI:

- `string` — wartość pola formularza (email).
- `AppLocale` z `src/types/api.ts` — do zbudowania `redirectTo` z aktualnym prefixem locale.
- `AuthError | null` — z `@supabase/supabase-js` (zwracany przez `resetPasswordForEmail`).
- (Opcjonalnie) reuse istniejącego `BusinessError` enum + `mapAuthError()` z `src/lib/supabase/errors.ts` (M3 backend) — gdy zostanie zaimplementowany; do tego czasu UI mapuje `error.status === 429` ręcznie na komunikat i18n.

> **Brak Command Modelu po stronie WelderDoc API jest celowy** — `src/types/api.ts` katalogizuje wyłącznie kontrakty, których właścicielem jest WelderDoc. `auth.resetPasswordForEmail` należy do GoTrue.

## 4. Response Details

### 4.1 Sukces

GoTrue zawsze odpowiada 200/204 z body `{ "data": {}, "error": null }` (tzw. silent success), niezależnie od tego, czy adres email istnieje w `auth.users`. SDK zwraca `{ data: null, error: null }`.

- HTTP status (do klienta): **200** (transparentnie z GoTrue).
- Akcja UI (po sukcesie):
  - Wyświetlenie komunikatu i18n: `auth.password_reset_sent_generic` (PL: „Jeśli email istnieje w naszej bazie, wysłaliśmy link resetujący"; EN: „If this email is registered, we have sent a reset link").
  - Reset/disable formularza, opcjonalny licznik 60s (cooldown po stronie GoTrue) blokujący ponowne wysłanie.

### 4.2 Błąd

| Stan | Przyczyna | Akcja UI |
|---|---|---|
| `error.status === 429` (`Email rate limit exceeded`) | Przekroczony limit `email_sent = 4 / godzinę / IP` lub 60s cooldown | Toast `auth.password_reset_rate_limited` z sugestią „Spróbuj ponownie za godzinę" |
| `error.status === 422` (validation, np. `email_address_invalid`) | GoTrue wykrył niepoprawny format emaila mimo client-side guard | Toast `auth.password_reset_invalid_email` |
| `error.status === 5xx` lub network error | Błąd po stronie GoTrue / sieć | Toast `errors.network_error` z możliwością retry; **nie ujawniaj** szczegółów GoTrue |

> **Anti-enumeration:** Nawet jeśli email nie istnieje, użytkownik widzi komunikat sukcesu. Nigdy nie loguj per-input rezultatu silent fail po stronie klienta.

## 5. Data Flow

```
[Client: /[locale]/forgot-password/page.tsx]
   │  user wpisuje email + submit
   │
   ▼
[Client Component: createClient() z src/lib/supabase/client.ts]
   │  supabase.auth.resetPasswordForEmail(email, { redirectTo })
   │
   ▼
[Supabase GoTrue: POST /auth/v1/recover]
   │  1. Walidacja formatu email (server-side)
   │  2. Walidacja redirect_to wobec whitelisty (Supabase Dashboard)
   │  3. Rate limit check: email_sent ≤ 4/h/IP, cooldown 60s
   │  4. Lookup auth.users WHERE email = $1 (silent fail jeśli brak)
   │  5. Generuje PKCE token, INSERT do auth.flow_state
   │  6. SMTP send: link = redirectTo + ?code=PKCE&type=recovery
   │
   ▼
[Response: { data: {}, error: null }]
   │
   ▼
[Client UI: komunikat „link wysłany" (zawsze ten sam, nawet dla nieistniejących)]
```

Po kliknięciu linka w mailu (osobny flow, oznaczony jako tło dla tego endpointu):

```
[Email link → /[locale]/auth/callback?code=...&next=/reset-password]
   │
   ▼
[Server Component callback/page.tsx]
   │  await createClient() → supabase.auth.exchangeCodeForSession(code)
   │
   ▼
[Redirect → /[locale]/reset-password]
   │
   ▼
[/[locale]/reset-password — Client Component]
   │  user wpisuje nowe hasło
   │  supabase.auth.updateUser({ password })  ← osobny endpoint (PUT /auth/v1/user)
   │
   ▼
[Sukces → redirect /[locale]/dashboard z nowym JWT]
```

> **Brak interakcji z bazą danych WelderDoc** — `auth.users` jest read-only przez GoTrue, `user_profiles` nie jest dotykany. Endpoint nie zapisuje żadnego śladu w `consent_log` ani `webhook_events`.

## 6. Security Considerations

1. **Anti-enumeration (krytyczne, wymóg PRD US-004 oraz `endpoint-data.md`):**
   - Klient **musi** wyświetlać identyczny komunikat dla email-istnieje vs email-nie-istnieje.
   - Nie wolno warunkować UI na obecności konta (brak osobnego stanu „nie znaleziono adresu").
2. **Rate limiting:**
   - `email_sent = 4 / godzinę / IP` (GoTrue, `supabase/config.toml`).
   - 60s cooldown między kolejnymi `resetPasswordForEmail` dla tego samego adresu (wbudowany w GoTrue).
   - **Wektor obejścia:** atakujący może rotować IP (proxy) — TODO przed publicznym launchem: rozważenie Vercel BotID na formularz (`api-plan.md` §6.3).
3. **Whitelista `redirectTo`:**
   - Supabase Auth Settings → Redirect URLs musi zawierać dokładnie: `${NEXT_PUBLIC_APP_URL}/pl/auth/callback`, `${NEXT_PUBLIC_APP_URL}/en/auth/callback` (oraz preview wildcard `https://*-vercel.app/**` jeśli używamy preview deploys).
   - **Bez whitelisty** atakujący mogłby przekazać `redirectTo` na obcą domenę i przejąć token PKCE — Supabase odrzuca takie requesty z `validation_failed`, ale poleganie wyłącznie na walidacji client-side jest niewystarczające.
4. **PKCE flow:**
   - Token w mailu jest jednorazowy, krótko żyjący (default 1 godzina, konfigurowalne w `[auth] otp_expiry`).
   - `code` w URL **nie nadaje się** do bookmark'owania — wymiana na sesję unieważnia token.
5. **Walidacja email po stronie klienta:**
   - Przed `resetPasswordForEmail` wykonać preflight `email.trim()` + regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` (lub HTML `<input type="email" required>`), aby zminimalizować ruch sieciowy. Autorytatywna walidacja po stronie GoTrue.
6. **Nie wolno logować emaila do telemetrii/Sentry** — adres jest danym osobowym (RODO art. 4 §1). Maksymalnie hash SHA-256 z solą, jeśli debug niezbędny.
7. **CSRF:**
   - SDK używa `fetch` z anon key w `apikey` header — brak ciasteczka, brak ryzyka CSRF.
   - Formularz jest standardowym `<form onSubmit>`, nie wykorzystuje cookies.
8. **Zero zaufania do `NEXT_PUBLIC_APP_URL` w runtime:**
   - Wartość jest pobierana z env (build-time) — nie z `window.location.origin`, aby uniknąć podszywania się przez `<iframe>` z innej domeny.

## 7. Error Handling

| Sytuacja | Detekcja | Status (z perspektywy klienta) | UI Behaviour |
|---|---|---|---|
| Niepoprawny format email | Preflight client-side | n/a | Inline validation message, brak request'u do GoTrue |
| Email nie istnieje | n/a — silent fail GoTrue | 200 (z `error: null`) | Komunikat „link wysłany jeśli email istnieje" |
| Rate limit przekroczony | `error.status === 429`, `error.code === 'over_email_send_rate_limit'` | 429 | Toast `auth.password_reset_rate_limited`, disable submit przez 60s |
| Cooldown 60s nie minął | `error.status === 429` | 429 | Tak samo jak wyżej |
| `redirectTo` poza whitelistą | `error.status === 400`, `error.code === 'validation_failed'` | 400 | Loguj jako bug deweloperski (Sentry), pokaż generic `errors.unexpected` — nie ujawniaj szczegółów whitelisty |
| Błąd SMTP (Resend/Postmark down) | `error.status === 500` (z GoTrue) | 500 | Toast `errors.email_provider_unavailable`; retry po 30s |
| Brak sieci / fetch failure | `error` jest `TypeError` lub timeout | n/a | Toast `errors.network_error` |
| Nieoczekiwany błąd GoTrue | `error.status >= 500` | 5xx | Toast `errors.unexpected`; loguj `error.code` i `error.status` (BEZ emaila) do Sentry |

> **Brak własnej tabeli `error_log`** — błędy są w warstwie SDK; logowanie do Sentry pojawi się dopiero, gdy Sentry zostanie wpięte (obecnie deferred — patrz CLAUDE.md „What is intentionally deferred").

> **Mapper `mapAuthError()` (TODO M3):** po implementacji `src/lib/supabase/errors.ts` (full stub w `api-plan.md` §9), `auth/forgot-password/page.tsx` musi przejść na `mapAuthError(error)` zamiast ręcznych `error.status === 429` checks. Zgodnie z architektonicznym invariantem z `CLAUDE.md`: „Error handling uses `BusinessError` enum + mappers, never raw string checks."

## 8. Performance Considerations

1. **Brak operacji DB po stronie WelderDoc** — endpoint nie kontaktuje Postgres ani RLS. Jedyny narzut to round-trip do GoTrue + SMTP send (asynchroniczne, 1-2s typowo).
2. **Cold-start nie ma zastosowania** — to wywołanie SDK z Client Component, nie Route Handler na Vercel.
3. **SMTP throughput:**
   - Default Supabase SMTP ma niski limit (3-4 maili/h/projekt) — **bezwzględnie wymagany** custom SMTP (Resend / Postmark) przed publicznym launchem (`tech-stack.md` §13).
   - W produkcji konfigurować `[auth.email.smtp]` w `supabase/config.toml` z DKIM/SPF/DMARC dla domeny `welder.doc`.
4. **Cache:**
   - Brak cache'u — każde wywołanie generuje nowy PKCE token.
   - Client Component nie może cache'ować rezultatu (anti-enumeration: nie ma rezultatu do cache'owania).
5. **UX:**
   - Disable submit button po pierwszym kliknięciu na 60s, aby nie generować ruchu nadbojowego (zgodnego z cooldown'em GoTrue).
   - Loading state z spinnerem podczas oczekiwania na response (typowo < 1s).

## 9. Implementation Steps

> **Lokalizacja UI:** `src/app/[locale]/forgot-password/page.tsx` (Client Component) + ewentualny test w `src/app/[locale]/forgot-password/page.test.tsx` lub `e2e/auth-forgot-password.spec.ts`.

> **Brak Route Handlera w `src/app/api/`** — endpoint NIE pojawi się w `pnpm verify:routes` (skrypt sprawdza wyłącznie własne handlery WelderDoc).

1. **Konfiguracja Supabase Auth (Dashboard / `supabase/config.toml`):**
   - W Supabase Dashboard → Auth → URL Configuration → **Redirect URLs**: dodać `${NEXT_PUBLIC_APP_URL}/pl/auth/callback`, `${NEXT_PUBLIC_APP_URL}/en/auth/callback`, oraz preview pattern (np. `https://welder-doc-app-*.vercel.app/**`).
   - W Dashboard → Auth → Email Templates → **Reset Password**: dostosować szablon (PL/EN, link `{{ .ConfirmationURL }}` automatycznie zawiera `?code=...&next=/reset-password`).
   - Zweryfikować `[auth.rate_limit]` w `supabase/config.toml`: `email_sent = 4`.
   - Po stronie produkcji: skonfigurować custom SMTP (Resend / Postmark) w Dashboard → Project Settings → Auth → SMTP Settings.

2. **Dodać tłumaczenia w `src/messages/pl.json` i `src/messages/en.json`:**

   ```jsonc
   // pl.json
   "auth": {
     "forgot_password_title": "Resetuj hasło",
     "forgot_password_email_label": "Adres email",
     "forgot_password_submit": "Wyślij link",
     "password_reset_sent_generic": "Jeśli email istnieje w naszej bazie, wysłaliśmy link resetujący.",
     "password_reset_rate_limited": "Zbyt wiele prób. Spróbuj ponownie za godzinę.",
     "password_reset_invalid_email": "Niepoprawny format adresu email.",
     "password_reset_back_to_login": "Powrót do logowania"
   }
   ```

   Analogicznie EN. **Zero hardcoded stringów** — patrz CLAUDE.md („Zero hardcoded UI strings").

3. **Utworzyć stronę `src/app/[locale]/forgot-password/page.tsx` (Server Component shell):**
   - Wywołać `setRequestLocale(locale)` przed `useTranslations` (wymóg `next-intl`, `tech-stack.md` §5).
   - Renderować klientowy formularz (np. `<ForgotPasswordForm />` z osobnego pliku).
   - Pamiętać o `generateStaticParams` zwracającym `[{ locale: 'pl' }, { locale: 'en' }]`.

4. **Utworzyć Client Component `src/app/[locale]/forgot-password/forgot-password-form.tsx`:**

   ```typescript
   'use client'
   import { useState, useTransition } from 'react'
   import { useTranslations, useLocale } from 'next-intl'
   import { createClient } from '@/lib/supabase/client'

   export function ForgotPasswordForm() {
     const t = useTranslations('auth')
     const locale = useLocale()
     const [email, setEmail] = useState('')
     const [submitted, setSubmitted] = useState(false)
     const [errorKey, setErrorKey] = useState<string | null>(null)
     const [isPending, startTransition] = useTransition()

     const onSubmit = (e: React.FormEvent) => {
       e.preventDefault()
       setErrorKey(null)
       startTransition(async () => {
         const supabase = createClient()
         const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
           redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/auth/callback?next=/reset-password`,
         })
         if (error) {
           if (error.status === 429) setErrorKey('password_reset_rate_limited')
           else if (error.status === 422) setErrorKey('password_reset_invalid_email')
           else setErrorKey('password_reset_invalid_email') // fallback generic — anti-enumeration
           // nie ustawiamy submitted=true przy realnym błędzie technicznym (429/sieć)
           if (error.status === 429) setSubmitted(true) // ale rate-limit pokaż jak sukces UX-owy
         } else {
           setSubmitted(true)
         }
       })
     }

     if (submitted) {
       return <p role="status">{t('password_reset_sent_generic')}</p>
     }

     return (
       <form onSubmit={onSubmit}>
         <label htmlFor="email">{t('forgot_password_email_label')}</label>
         <input
           id="email"
           type="email"
           required
           value={email}
           onChange={(e) => setEmail(e.target.value)}
           disabled={isPending}
         />
         <button type="submit" disabled={isPending || !email}>
           {t('forgot_password_submit')}
         </button>
         {errorKey && <p role="alert">{t(errorKey)}</p>}
       </form>
     )
   }
   ```

   **Uwaga:** docelowo po implementacji `mapAuthError()` (M3) podmienić ręczne `error.status === 429` na `mapAuthError(error).business === BusinessError.RATE_LIMITED` (zgodnie z architektonicznym invariantem). Do tego czasu zostawić ręczny mapping z TODO komentarzem.

5. **Utworzyć stronę callback `src/app/[locale]/auth/callback/page.tsx` (jeśli jeszcze nie istnieje — współdzielona z OAuth post-MVP):**
   - Server Component z `await createClient()` + `supabase.auth.exchangeCodeForSession(code)`.
   - Po sukcesie: `redirect(\`/\${locale}\${searchParams.next ?? '/dashboard'}\`)`.
   - Walidacja `searchParams.next` — wymusić, żeby zaczynał się od `/` (nie od `https://...`) aby zapobiec open redirect.
   - Obsługa błędów wymiany kodu: redirect na `/[locale]/auth/error?code=invalid_token` z odpowiednim komunikatem.

6. **Utworzyć stronę `src/app/[locale]/reset-password/page.tsx` + form Client Component:**
   - Wymaga aktywnej sesji (po `exchangeCodeForSession`); jeśli brak → redirect na `/[locale]/login`.
   - Formularz wywołuje `supabase.auth.updateUser({ password })` — pełen plan w `update-password-put-endpoint-data.md`.
   - **Po sukcesie:** `supabase.auth.signOut()` + redirect na `/[locale]/login` z toastem „Hasło zmienione, zaloguj się ponownie" (recovery sesja jest jednorazowa — wymagana ponowna autentykacja dla świeżego JWT).

7. **Linkowanie z `/[locale]/login` (US-002):**
   - Pod formularzem login dodać link/button: `<Link href="/forgot-password">{t('forgot_password_link')}</Link>` (next-intl `Link` automatycznie respektuje locale prefix).

8. **Testy E2E (Playwright, `e2e/auth-forgot-password.spec.ts`):**
   - **Test 1 (anti-enumeration):** wpisz email nieistniejącego użytkownika → asercja, że UI pokazuje ten sam komunikat sukcesu co dla istniejącego.
   - **Test 2 (rate limit):** 5x submit dla tego samego emaila w pętli → ostatni wywołuje toast rate-limited (lub UI pokazuje ten sam sukces — zależnie od decyzji UX).
   - **Test 3 (callback flow):** kliknięcie linka z mailtrap'a (lub przechwycenie z Supabase admin API w teście) → redirect na `/reset-password` → wpisanie nowego hasła → redirect na `/login`.
   - **Visual regression:** snapshot strony `/forgot-password` w obu locale'ach (`chromium-desktop`, mandatory).

9. **Testy jednostkowe (Vitest):**
   - `forgot-password-form.test.tsx` — render formularza, submit z mock'iem `createClient()` (`vi.mock('@/lib/supabase/client')`), asercje na zmianę stanu UI po sukcesie/błędzie.
   - **Brak coverage threshold** dla tego pliku (UI components są wyłączone z `vitest.config.ts` thresholdów — pokrywane Playwrightem).

10. **Walidacja konfiguracji deploy:**
    - Przed pierwszym deployem produkcyjnym sprawdzić, że Supabase Auth Dashboard ma wpisane wszystkie redirect URL'e (manual check — nie ma do tego scriptu).
    - Sprawdzić, że custom SMTP jest aktywny (default Supabase SMTP ograniczy do 3-4 maili/h całego projektu — uniemożliwia produkcję).
    - Po deployu wykonać smoke test: `forgot-password` z konta testowego → otrzymanie maila → kliknięcie → ustawienie hasła → ponowne logowanie.

11. **Dokumentacja (CLAUDE.md update):**
    - Po implementacji uzupełnić sekcję „Currently implemented" w `CLAUDE.md`: dopisać `src/app/[locale]/forgot-password/page.tsx` oraz `src/app/[locale]/auth/callback/page.tsx` jako zaimplementowane (jeśli jeszcze nie ma).
