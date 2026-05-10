# Implementation Plan: `/[locale]/consent-required` Page (US-052)

> **Status:** OPEN — MVP-blocking. RODO compliance gap. Tracked here, surfaced from `consent-required/page.tsx:13` "tracked separately" comment that previously had no owner.
>
> **Priority:** P0 for MVP launch. Without this UI the entire consent re-acceptance flow is broken end-to-end (see §1).
>
> **Related:**
> - PRD `prd.md` (add US-052 — see §3 of this doc)
> - Architecture `architecture-base.md:1117` (defines the consent re-check mechanism)
> - Login plan `api-endpoints-implementation-plans/login-post-endpoint-implementation-plan.md` Krok 6 §3 (originated this gap as "out-of-scope dla tego zadania")
> - Login verification report `api-endpoints-verification-reports/login-post-endpoint-verification-report.md` line 33 ("most fragile coupling in the plan")
> - Existing stub: `src/app/[locale]/consent-required/page.tsx` (just title + paragraph + "stub_notice")

---

## 1. Problem statement

### 1.1 What's currently broken

Two production scenarios where users get **trapped** on `/consent-required`:

**Scenario A — fresh signup (RODO-critical):**

1. User signs up via `/auth/sign-up`, accepts all 3 consents (TOS, PP, cookies). Bundle stashed in `sessionStorage[welderdoc_pending_consent]` per `src/lib/auth/registration.ts:88`.
2. User clicks email confirmation link → `/auth/v1/verify` → `/auth/callback?code=...` → server-side `exchangeCodeForSession` → 307 to `/`.
3. **SSR LocaleGuard** in `src/app/[locale]/layout.tsx:87-105` runs BEFORE client React mounts. It fetches `user_profiles.current_consent_version` which is still `NULL` (no flush has happened yet). Guard redirects to `/[locale]/consent-required`.
4. Browser renders `/consent-required` page (the stub from step "Existing stub" above).
5. `AuthProvider` mounts, fires `INITIAL_SESSION` event with the new session, calls `flushPendingConsent()` from `src/lib/auth/registration.ts:109`. POST `/api/consent` succeeds, DB row created, `current_consent_version = '2026-05-01'`.
6. **But the user is still on `/consent-required` looking at the stub.** No way forward — the page has no buttons, no auto-redirect, no consent-acceptance UI.
7. Refreshing `/consent-required` doesn't help: layout's `PUBLIC_SEGMENTS` array (`layout.tsx:31-42`) includes `/consent-required`, so the LocaleGuard SKIPS the consent re-check on this very page (intentional — to avoid infinite loops). User remains stuck.
8. Manual workaround: typing `localhost:3000/` in the address bar. Guard now sees consent_version is fresh, lets them through. **This is undiscoverable for end users.**

**Verified empirically** in this session at 2026-05-10 ~13:21 with user `proof-pkce-1@example.com`:
- DB after click: `current_consent_version = '2026-05-01'`, `consent_count = 3` ✅
- Browser URL: `localhost:3000/consent-required` ❌ (stuck)
- Network confirmed POST `/api/consent` 201 fired ✅
- Stub shows only `consent.required_title`, `consent.required_subtitle`, `consent.stub_notice` — no submission UI

**Scenario B — TOS update for existing user:**

1. Product publishes new TOS version. Backend (release process) bumps `CURRENT_TOS_VERSION` in `src/lib/consent/version.ts` to e.g. `'2026-09-01'`.
2. Existing user signs in. Their stored `user_profiles.current_consent_version = '2026-05-01'` (older).
3. LocaleGuard: `profile.current_consent_version < CURRENT_TOS_VERSION` → redirect to `/[locale]/consent-required`.
4. User lands on stub. **No way to re-accept.** Guard skips `/consent-required` itself, so refresh doesn't help. They cannot use the app until they accept new TOS, but there's no UI to accept.

### 1.2 RODO impact

Article 7 ust. 3 GDPR: *"The data subject shall have the right to withdraw his or her consent at any time."* Article 7 ust. 1: *"Where processing is based on consent, the controller shall be able to demonstrate that the data subject has consented to processing of his or her personal data."*

To **demonstrate** ongoing consent after a TOS change, the user must be able to actually **express** that consent. A stub page that doesn't let them do that means the flow violates RODO art. 7.

Consequences if shipped to production:
- Every new user trapped after signup → no functional consent record-keeping for new accounts (in worst case the SSR race always loses)
- Every TOS update bricks existing accounts until UI ships
- Audit failure: "show me the user's renewed consent after the 2026-09-01 TOS update" → no records, because users couldn't physically click "accept"

### 1.3 Why this isn't in any tracked place yet

Searched `.ai/` exhaustively (2026-05-10):

| Location | Status |
|---|---|
| `prd.md` | Has US-001..US-051, **no US for `/consent-required` UI** |
| `api-plan.md` | Describes `POST /api/consent` backend, **no UI scope** (correct — API plan) |
| `release-checklist.md` | Mentions `CURRENT_TOS_VERSION` constant update but **no UI implementation step** |
| `api-endpoints-implementation-plans/` | No matching plan; consent-required is a page not an endpoint |
| `architecture-base.md:1117` | States the route exists and what it should do, **no implementation detail** |
| Code comment `consent-required/page.tsx:13` | "tracked separately" — without saying WHERE |

This document fills that gap.

---

## 2. Solution overview

Replace the stub `consent-required/page.tsx` with a working Server Component that renders a Client Component form. The form:

1. Lists the consents the user must re-accept (TOS, PP — cookies are session-cookie-banner-driven and don't go through this flow).
2. Shows the version effective date and links to current TOS / Privacy Policy static pages (out of scope of this plan; assume they exist or stub them in same PR).
3. On submit: POST `/api/consent` with the consent bundle (re-uses existing endpoint — no new API).
4. On success: navigate to home (`/[locale]`) — the LocaleGuard will see `current_consent_version` is fresh and let them through.
5. On error: surface mapped i18n message; allow retry without losing form state.

Additionally — and this is what closes the **Scenario A** race specifically — the page MUST handle the case where the user just had a successful flush from `flushPendingConsent` and is on the stub erroneously. Two complementary mechanisms:

- **Server-side re-check on mount:** the page's Server Component does its own `auth.getUser() + user_profiles.current_consent_version` check. If `current_consent_version >= CURRENT_TOS_VERSION`, immediately `redirect(buildLocalePath(locale, '/'))`. This handles the case where the user navigates BACK to `/consent-required` after consent was flushed — they shouldn't see the form, they should land on home.
- **Client-side optimistic redirect after `AuthProvider` flush success:** in `src/components/providers/AuthProvider.tsx`, after `flushPendingConsent()` returns ok, if `window.location.pathname` matches `/consent-required`, call `router.replace(buildLocalePath(locale, '/'))`. This handles the SSR-vs-client race specifically (Scenario A): user just landed on `/consent-required` because SSR saw NULL, but flush has now completed → take them off the page automatically.

These two mechanisms work together and don't conflict: server-side check runs on initial render (covers manual nav and refresh), client-side runs ONCE after a fresh sign-in flush (covers the race window).

---

## 3. User Stories — to add to `prd.md`

Insert after existing US-051 in `.ai/prd.md` (which currently ends at line 1080+):

```markdown
US-052
Tytuł: Ponowna akceptacja zgód po zmianie wersji TOS / Polityki Prywatności

Opis: Jako użytkownik z aktywnym kontem chcę móc ponownie zaakceptować zaktualizowane zgody (Regulamin, Polityka Prywatności), kiedy ich wersje uległy zmianie, aby móc dalej korzystać z aplikacji zgodnie z aktualnymi warunkami.

Kryteria akceptacji:

- Po zalogowaniu LocaleGuard sprawdza `user_profiles.current_consent_version`. Jeśli `NULL` lub mniejsze od `CURRENT_TOS_VERSION`, użytkownik zostaje przekierowany na `/[locale]/consent-required`.
- Strona `/[locale]/consent-required` wyświetla:
  - tytuł i wyjaśnienie powodu re-akceptacji (nowa wersja TOS / PP),
  - listę dwóch checkboxów (Regulamin, Polityka Prywatności) z linkami do statycznych stron treści,
  - informację o aktualnej wersji zgód (np. "Wersja 2026-09-01"),
  - przycisk "Akceptuję i kontynuuj" — disabled dopóki oba checkboxy nie są zaznaczone.
- Submit wywołuje istniejący `POST /api/consent` z payloadem `{ types: ['terms_of_service', 'privacy_policy'], version: CURRENT_TOS_VERSION, accepted: true }`.
- Po sukcesie HTTP `201`: redirect na `/[locale]` (home). LocaleGuard przepuszcza, bo `current_consent_version` jest aktualne.
- Obsługa błędów: 4xx/5xx → komunikat z `mapPostgrestError` przez i18n key, button znów enabled, formularz nie jest czyszczony.
- Strona obsługuje obie locale (PL/EN) przez `next-intl` (`auth.consent.*` namespace).
- Re-check po stronie serwera: jeśli użytkownik trafi na `/consent-required` mając już aktualne `current_consent_version`, server component wykonuje natychmiastowy `redirect()` na home (chroni przed pętlą po race condition w `AuthProvider`).
- Auto-redirect po stronie klienta: po sukcesie `flushPendingConsent()` w `AuthProvider`, jeśli pathname zawiera `/consent-required`, wykonaj `router.replace` na home (zamyka okno race condition po świeżej rejestracji).
- Nie pokazujemy checkboxa cookies — cookies-banner ma własny flow (US-051).
```

---

## 4. Implementation steps

### 4.1 Files to touch

| Path | Action |
|---|---|
| `src/app/[locale]/consent-required/page.tsx` | Replace stub with real Server Component |
| `src/app/[locale]/consent-required/ConsentRequiredForm.tsx` | NEW — Client Component with checkbox form |
| `src/components/providers/AuthProvider.tsx` | Add post-flush auto-redirect from `/consent-required` |
| `src/messages/pl.json` | Add `auth.consent` namespace strings |
| `src/messages/en.json` | Same EN translations |
| `src/app/[locale]/consent-required/ConsentRequiredForm.test.tsx` | NEW — unit tests |
| `e2e/auth/consent-required.spec.ts` | NEW — Playwright E2E |
| `.ai/prd.md` | Append US-052 (see §3) |
| `src/app/[locale]/consent-required/page.tsx` (existing comment line 12-14) | Update "tracked separately" → "implements US-052 from prd.md" |
| `.ai/release-checklist.md` | Add checklist item: "US-052 (consent re-acceptance UI) implemented and Playwright passes" |

### 4.2 Server Component — `consent-required/page.tsx`

Drop the existing stub. Implement:

```typescript
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { CURRENT_TOS_VERSION } from '@/lib/consent/version';
import { createClient } from '@/lib/supabase/server';
import { ConsentRequiredForm } from './ConsentRequiredForm';

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

export default async function ConsentRequiredPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Defensive: if anonymous user lands here, send them to login.
  // The middleware should already prevent this, but Server Components
  // shouldn't trust the middleware unconditionally.
  if (!user) {
    redirect(buildLocalePath(locale, '/login'));
  }

  // Re-check guard: if user's consent is already current, don't show the form.
  // This catches the AuthProvider-flush race (Scenario A in §1.1) — by the time
  // they hit /consent-required after the bounce, the flush may have completed
  // and made the form unnecessary.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('current_consent_version')
    .eq('id', user.id)
    .single<{ current_consent_version: string | null }>();

  if (profile?.current_consent_version && profile.current_consent_version >= CURRENT_TOS_VERSION) {
    redirect(buildLocalePath(locale, '/'));
  }

  const t = await getTranslations('auth.consent');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t('required_title')}</h1>
        <p className="mt-2 text-sm text-neutral-600">{t('required_subtitle', { version: CURRENT_TOS_VERSION })}</p>
        <ConsentRequiredForm
          locale={locale}
          consentVersion={CURRENT_TOS_VERSION}
        />
      </div>
    </main>
  );
}
```

Key invariants:
- Server-side `auth.getUser()` (NOT `getSession()`) per CLAUDE.md auth checklist.
- `redirect()` for both anonymous AND already-consented users — the page should be a no-op when not needed.
- No client-side hydration of profile fetch — keeps the load fast and doesn't leak the consent version to JS.

### 4.3 Client Component — `consent-required/ConsentRequiredForm.tsx`

```typescript
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { mapPostgrestError, type MappedError } from '@/lib/supabase/errors';

type Props = {
  locale: string;
  consentVersion: string;
};

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

export function ConsentRequiredForm({ locale, consentVersion }: Props) {
  const t = useTranslations('auth.consent');
  const tErrors = useTranslations('errors');
  const router = useRouter();

  const [acceptTos, setAcceptTos] = useState(false);
  const [acceptPp, setAcceptPp] = useState(false);
  const [error, setError] = useState<MappedError | null>(null);
  const [isPending, startTransition] = useTransition();

  const canSubmit = acceptTos && acceptPp && !isPending;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch('/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            types: ['terms_of_service', 'privacy_policy'],
            version: consentVersion,
            accepted: true
          })
        });
      } catch {
        setError({ business: 'network_error', message: 'errors.network_error' } as MappedError);
        return;
      }

      if (!res.ok) {
        // Try to parse the API error envelope; fall back to a generic message.
        const body = await res.json().catch(() => null);
        setError({
          business: 'unknown',
          message: body?.error ? `errors.${body.error}` : 'errors.unknown'
        } as MappedError);
        return;
      }

      // Full-page navigation, NOT router.push — same rationale as
      // SignUpForm.tsx:88-94: lets the @supabase/ssr browser client
      // pick up the freshly-set current_consent_version cookie before
      // the next layout SSR re-runs.
      window.location.assign(buildLocalePath(locale, '/'));
    });
  }

  const errorMessage = error
    ? (() => {
        try {
          return tErrors(error.message.replace(/^errors\./, '') as Parameters<typeof tErrors>[0]);
        } catch {
          return tErrors('unknown');
        }
      })()
    : null;

  return (
    <form onSubmit={handleSubmit} method="post" className="mt-6 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={acceptTos}
            onChange={(e) => setAcceptTos(e.target.checked)}
            disabled={isPending}
            className="mt-0.5"
            required
          />
          <span>{t.rich('tos_label', { link: (chunks) => <a href={buildLocalePath(locale, '/legal/terms')} target="_blank" rel="noreferrer" className="underline">{chunks}</a> })}</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={acceptPp}
            onChange={(e) => setAcceptPp(e.target.checked)}
            disabled={isPending}
            className="mt-0.5"
            required
          />
          <span>{t.rich('pp_label', { link: (chunks) => <a href={buildLocalePath(locale, '/legal/privacy')} target="_blank" rel="noreferrer" className="underline">{chunks}</a> })}</span>
        </label>
      </fieldset>

      {errorMessage ? (
        <div role="alert" aria-live="polite" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
```

Notes:
- `method="post"` + `noValidate` not strictly needed since this isn't credential-bearing, but keeps consistent with `SignUpForm.tsx`.
- Cookie consent (third checkbox in original signup) is NOT shown here — it's session-cookie-banner driven, not part of the gated re-acceptance path.
- Links to `/legal/terms` and `/legal/privacy` — those static pages may themselves be a separate task (see "Out-of-scope follow-up" §6).

### 4.4 AuthProvider — close the SSR race

Edit `src/components/providers/AuthProvider.tsx` to add the client-side auto-redirect after a successful flush:

```typescript
// Inside the SIGNED_IN / INITIAL_SESSION branch, after the existing
// `clearPendingSignupCredentials();` line in the success path:

// Close the SSR-vs-client-flush race: if the user landed on
// /consent-required because the SSR layout saw current_consent_version=NULL,
// but the flush we just completed has updated it, take them off the
// stuck page automatically. router.refresh() doesn't help because
// /consent-required is in PUBLIC_SEGMENTS and the layout guard skips
// the consent re-check on this path; we have to navigate elsewhere.
const path = window.location.pathname;
const stripped = path.replace(/^\/(en|pl)/, '');
if (stripped === '/consent-required' || stripped.startsWith('/consent-required/')) {
  router.replace(`/${locale}`);
}
```

This adds a dependency on `locale` and `router` which are already in the hook's deps array. Confirm no new effect re-run loops by checking that `clearPendingSignupCredentials()` isn't called repeatedly — it's idempotent (sessionStorage.removeItem of a non-existent key is a no-op).

### 4.5 i18n — `auth.consent` namespace

`src/messages/pl.json` — add inside the `auth` object (after `signUp`, `checkEmail`, etc.):

```json
"consent": {
  "required_title": "Zaktualizuj swoje zgody",
  "required_subtitle": "Aby kontynuować, zaakceptuj nową wersję regulaminu i polityki prywatności (wersja {version}).",
  "tos_label": "Akceptuję <link>Regulamin</link>.",
  "pp_label": "Akceptuję <link>Politykę Prywatności</link>.",
  "submit": "Akceptuję i kontynuuj",
  "submitting": "Zapisywanie..."
}
```

`src/messages/en.json` (same shape, EN strings):

```json
"consent": {
  "required_title": "Update your consents",
  "required_subtitle": "To continue, please accept the updated terms of service and privacy policy (version {version}).",
  "tos_label": "I accept the <link>Terms of Service</link>.",
  "pp_label": "I accept the <link>Privacy Policy</link>.",
  "submit": "Accept and continue",
  "submitting": "Saving..."
}
```

The existing top-level `consent` namespace (`required_title`, `required_subtitle`, `stub_notice` keys used by the current stub) can be **removed** — the stub is being replaced and the new strings live under `auth.consent.*`. Confirm with `grep -r 'consent\.required_\|consent\.stub_'` after deletion that nothing else references them.

### 4.6 Tests

#### 4.6.1 Unit (Vitest) — `ConsentRequiredForm.test.tsx`

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl');
  return { ...actual, useTranslations: () => (k: string, o?: any) => o?.version ? `${k}:${o.version}` : k };
});

import { ConsentRequiredForm } from './ConsentRequiredForm';

const originalFetch = globalThis.fetch;
const originalAssign = window.location.assign;

describe('ConsentRequiredForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.location, 'assign', { value: vi.fn(), writable: true });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window.location, 'assign', { value: originalAssign, writable: true });
  });

  it('button disabled until both checkboxes checked', () => {
    render(<ConsentRequiredForm locale="pl" consentVersion="2026-05-01" />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('POSTs the bundle and redirects on success', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<ConsentRequiredForm locale="pl" consentVersion="2026-05-01" />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await user.click(screen.getByRole('button'));

    expect(fetchMock).toHaveBeenCalledWith('/api/consent', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        types: ['terms_of_service', 'privacy_policy'],
        version: '2026-05-01',
        accepted: true
      })
    }));
    expect(window.location.assign).toHaveBeenCalledWith('/');
  });

  it('shows error and re-enables button on 4xx', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: () => Promise.resolve({ error: 'invalid_consent_type' })
    }) as unknown as typeof fetch;

    render(<ConsentRequiredForm locale="pl" consentVersion="2026-05-01" />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await user.click(screen.getByRole('button'));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('builds /en/ paths in en locale', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
    render(<ConsentRequiredForm locale="en" consentVersion="2026-05-01" />);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await user.click(screen.getByRole('button'));
    expect(window.location.assign).toHaveBeenCalledWith('/en');
  });
});
```

#### 4.6.2 E2E (Playwright) — `e2e/auth/consent-required.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('US-052 — consent re-acceptance', () => {
  test('user with NULL current_consent_version sees the form and can submit', async ({ page, context }) => {
    // Seed: a confirmed user whose user_profiles.current_consent_version = NULL.
    // Use the existing seed/test-helpers infrastructure (consult e2e/fixtures/).
    // Sign in as that user, then navigate to /consent-required.
    await page.goto('http://localhost:3000/login');
    // ... fill and submit credentials for seeded user ...

    await expect(page).toHaveURL(/\/consent-required$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const tos = page.getByRole('checkbox').nth(0);
    const pp = page.getByRole('checkbox').nth(1);
    const submit = page.getByRole('button', { name: /Akceptuję|Accept/ });
    await expect(submit).toBeDisabled();

    await tos.check();
    await expect(submit).toBeDisabled();
    await pp.check();
    await expect(submit).toBeEnabled();

    await submit.click();
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\/?$/);
  });

  test('user with already-current consent who lands on /consent-required is redirected away', async ({ page }) => {
    // Sign in as a user whose consent is already current.
    // Navigating to /consent-required should immediately bounce to home.
    // ... seed + sign-in ...
    await page.goto('http://localhost:3000/consent-required');
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\/?$/);
  });

  test('anonymous user is bounced to /login', async ({ page }) => {
    await page.goto('http://localhost:3000/consent-required');
    await expect(page).toHaveURL(/\/login$/);
  });
});
```

Note on seeding: this repo uses local Supabase (`supabase/config.toml`, `supabase db reset` re-applies migrations). The test will need either:
- A test-only seed migration that creates known-state users, OR
- A pre-test setup hook that creates users via the admin client (`supabase.auth.admin.createUser`).

Inspect existing E2E specs (`e2e/`) for the convention before implementing — match what's already there.

### 4.7 Documentation updates

Append after writing the code:

- `prd.md` — paste US-052 from §3 of this doc.
- `release-checklist.md` — add: `- [ ] **US-052 — consent re-acceptance UI** zaimplementowane, Playwright zielony. Bez tego flow rejestracji w prod (z enable_confirmations=true) skutkuje "uwięzieniem" usera na stub page.`
- `consent-required/page.tsx` (new code, NOT old stub) header comment: replace `// Stub destination ... out-of-scope for the login PR — tracked separately` with `// Implements US-052 (.ai/prd.md). Plan: .ai/consent-required-page-implementation-plan.md.`
- `CLAUDE.md` "Auth UI pages implemented" paragraph — add bullet for `/consent-required` once shipped.

---

## 5. Edge cases & error handling

| Scenario | Expected behavior |
|---|---|
| User unchecks one box mid-submit | `isPending` keeps button disabled until fetch resolves; UI state is consistent because `canSubmit` recomputes each render |
| Fetch network error (no response) | Show `errors.network_error`, button re-enabled, checkboxes preserved |
| `/api/consent` returns 401 (session expired between page load and submit) | `mapPostgrestError` is for postgrest, but the API uses `ApiErrorDto`; fall back to displaying `tErrors('unauthorized')`. Also: navigate to `/login?session_expired=1` after a brief pause? — keep the simpler "show error, let them retry" for MVP unless UX disagrees. |
| User opens `/consent-required` in two tabs, accepts in one, refreshes the other | Tab 2's server re-check fires (§4.2), sees fresh version, redirects to home. Acceptable. |
| `CURRENT_TOS_VERSION` constant changes during the user's session | Server re-check uses the latest constant; stale value is harmless. |
| Concurrent `POST /api/consent` from multiple sessions | API handler is idempotent at the row level (`record_consent_bundle` RPC inserts one row per type per call); two simultaneous accepts produce two rows with same (user_id, consent_type, version) — pre-existing race in `AuthProvider` documented elsewhere, NOT in scope here. |

---

## 6. Out-of-scope follow-ups (separate plans)

- **Static `/legal/terms` and `/legal/privacy` pages** — referenced in checkbox labels but not implemented. If they don't exist yet, render the form with plain text labels (no anchor tags) and create a follow-up ticket. Block merge of this plan only if Legal/Compliance explicitly requires the link copy be live.
- **Cookie consent banner re-prompt** — out of scope. US-051 covers the banner separately; cookies aren't part of the gated re-acceptance flow.
- **Pre-existing race in `AuthProvider`** that double-fires `flushPendingConsent` on `SIGNED_IN` + `INITIAL_SESSION`, producing duplicate `consent_log` rows — surfaced during 2026-05-10 testing but **out of scope here**. Track separately. The duplicate-rows behavior is harmless for RODO (any one row proves consent), but a `useRef` guard would clean it up.

---

## 7. Pre-merge checklist

- [ ] `pnpm lint` — green
- [ ] `pnpm typecheck` — green  
- [ ] `pnpm test:run` — green; coverage for `consent-required/ConsentRequiredForm.tsx` ≥ 80% lines (matches `src/lib/**` thresholds adapted to UI components)
- [ ] `pnpm test:e2e -- --project=chromium-desktop` — three new tests in `consent-required.spec.ts` green
- [ ] Manual smoke (PL): fresh signup → email → click link → land on `/consent-required` → accept both → land on `/` → DB has `consent_count >= 2 (TOS + PP)` and `current_consent_version = CURRENT_TOS_VERSION`
- [ ] Manual smoke (EN): same flow at `/en/auth/sign-up`, locale preserved through `/en/consent-required` → `/en/`
- [ ] Manual smoke — TOS bump: bump `CURRENT_TOS_VERSION` constant locally, sign in as an existing user → redirected to `/consent-required` → accept → redirect to home → DB shows new version
- [ ] Existing user-export endpoint (`/api/user/export`) test still passes — RODO art. 20 must show the new `consent_log` row in the export payload
- [ ] PR checklist per `CLAUDE.md`: no direct `supabase.from('user_profiles').update(...)` (we don't update — backend RPC does it); `mapPostgrestError` used for any 4xx parsing; conventional commit `feat(auth): implement US-052 consent re-acceptance UI`
- [ ] `.ai/prd.md` updated (US-052)
- [ ] `.ai/release-checklist.md` updated
- [ ] `CLAUDE.md` "Auth UI pages implemented" updated
- [ ] Stub comment in code replaced with US-052 reference

---

## 8. Time estimate

For a developer familiar with this codebase: **3–5h** including tests. Breakdown:
- Server Component + redirect logic: ~30 min
- Client Component (form + state + error mapping): ~1h
- AuthProvider hook patch + verifying no infinite loop: ~30 min
- i18n: ~15 min
- Unit tests: ~1h
- E2E test (incl. seed wiring): ~1–2h (largest variance — depends on existing E2E fixture maturity)
- Documentation: ~30 min

For a fresh agent without codebase context: add ~2h of orientation (reading `architecture-base.md`, `CLAUDE.md`, existing `SignUpForm.tsx`, `LocaleGuard` in layout).

---

## 9. References for the implementer

Read in this order before writing code:

1. `CLAUDE.md` — repo conventions, especially "Auth UI pages implemented" + "PR checklist for auth implementation" sections
2. `.ai/architecture-base.md:1085-1130` — consent flow architecture
3. `.ai/api-plan.md` §2.1 `POST /api/consent` — endpoint contract
4. `src/app/[locale]/auth/sign-up/SignUpForm.tsx` — the closest existing UI pattern (form + i18n + locale-aware redirect)
5. `src/app/[locale]/layout.tsx:30-105` — LocaleGuard (understand why `/consent-required` is in `PUBLIC_SEGMENTS` and what consequence that has)
6. `src/components/providers/AuthProvider.tsx` — the hook this plan modifies
7. `src/lib/supabase/errors.ts` — `mapPostgrestError` / `mapAuthError` / `BusinessError` enum

Once those are read, this document should make complete sense without needing to refer back to the conversation that produced it.
