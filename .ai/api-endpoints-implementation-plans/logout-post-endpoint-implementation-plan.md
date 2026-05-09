# API Endpoint Implementation Plan: POST /auth/v1/logout (Wylogowanie — US-003)

## 1. Endpoint Overview

Endpoint odpowiada za wylogowanie zalogowanego użytkownika WelderDoc (US-003).

Kluczowe założenia:

- **Brak własnego Route Handlera** w `src/app/api/...` — wywołanie odbywa się bezpośrednio przez Supabase Auth SDK (`supabase.auth.signOut()`). HTTP request pod `https://<project>.supabase.co/auth/v1/logout` jest obsługiwany przez GoTrue (Supabase Auth) i to on:
  1. Invaliduje refresh token po stronie GoTrue.
  2. Zwraca `Set-Cookie: sb-access-token=; Max-Age=0` oraz `sb-refresh-token=; Max-Age=0` (helper `@supabase/ssr` synchronizuje to z cookie store Next.js).
- **Operacja jest idempotentna** — wywołanie `signOut()` bez aktywnej sesji nie powinno przerywać UX (`AuthSessionMissingError` traktujemy jako sukces).
- **Plan tej implementacji to nie kod nowego API**, lecz wyspecyfikowanie:
  1. Helpera klienckiego (`signOutClient()` lub bezpośrednie użycie `createClient()` z `src/lib/supabase/client.ts` w komponencie),
  2. UI flow po wylogowaniu (redirect na `/[locale]`, reset Zustand store'a),
  3. Reużycie tej samej ścieżki w handlerze `DELETE /api/user/account` (cleanup cookies po hard delete).

Endpoint należy do scope'u **Auth** (sekcja `api-plan.md` §2.1 — Auth via SDK, nie własny Route Handler) i jest jedynym z trzech operacji autoryzacyjnych (login, logout, reset password) wykonywanych w pełni przez SDK.

---

## 2. Request Details

- **HTTP Method:** `POST`
- **URL Structure (Supabase GoTrue):** `POST {NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout`
  - Wywoływane wyłącznie przez SDK; aplikacja nie konstruuje URL ręcznie.
- **Wywołanie z poziomu aplikacji:**
  ```typescript
  // Client Component (przycisk „Wyloguj"):
  import { createClient } from '@/lib/supabase/client'
  const supabase = createClient()
  const { error } = await supabase.auth.signOut()
  ```
  ```typescript
  // Server Action / Route Handler (np. DELETE /api/user/account):
  import { createClient } from '@/lib/supabase/server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  ```
- **Parameters:**
  - **Required:** brak.
  - **Optional (SDK level):** `signOut({ scope: 'global' | 'local' | 'others' })`.
    - `local` (domyślnie po stronie SDK od v2) — invaliduje tylko bieżące urządzenie.
    - `global` — invaliduje wszystkie aktywne sesje użytkownika.
    - **Decyzja produktowa:** używamy domyślnego `local`. Wylogowanie globalne nie jest w scope MVP.
- **Request Body:** brak (Supabase wysyła `Authorization: Bearer <access_token>` zaczerpnięty z aktywnej sesji).

---

## 3. Used Types

W `src/types/api.ts` **nie definiujemy** osobnego DTO/Command Modelu dla wylogowania — operacja jest fire-and-forget bez payloadu. Wystarczające typy (już istniejące lub zapewnione przez SDK):

- `AuthError` z `@supabase/supabase-js` — opcjonalny błąd zwracany przez `signOut()`.
- `ApiErrorDto` (`src/types/api.ts`) — używany **tylko** w hipotetycznym Route Handlerze cleanupowym (np. po stronie `DELETE /api/user/account`); nie wprowadzamy nowego kodu błędu.
- Brak konieczności rozszerzania `ConsentApiErrorCode` / `DeleteAccountApiErrorCode` — wylogowanie nie ma własnego kanału błędów.

Jeżeli powstanie helper opakowujący (rekomendowane), dodajemy w `src/lib/supabase/auth.ts`:

```typescript
export interface SignOutResult {
  ok: true; // zawsze true — błąd „brak sesji" mapowany jako sukces (idempotency)
}
```

---

## 4. Response Details

Endpoint nie zwraca własnego payloadu — odpowiedzi pochodzą z GoTrue:

| Status | Scenariusz | Odpowiedź (effective dla aplikacji) |
| --- | --- | --- |
| **204 No Content** (z GoTrue) | Pomyślne wylogowanie, sesja istniała. | `{ error: null }` po stronie SDK; cookies `sb-access-token` i `sb-refresh-token` wymazane (`Max-Age=0`). |
| **401 Unauthorized** (z GoTrue) | Brak / wygasła sesja (`AuthSessionMissingError`). | Traktujemy jako **sukces** (idempotentne). UI nadal wykonuje redirect i czyści lokalny stan. |
| **5xx** (z GoTrue) | Awaria po stronie Supabase. | Pokaż toast „Nie udało się wylogować — spróbuj ponownie", **ale** lokalnie wymuś czyszczenie cookies + redirect (defense-in-depth). |

> **Reguła UX:** niezależnie od statusu, lokalne efekty (czyszczenie store'a, redirect) zawsze następują — nie blokujemy użytkownika.

---

## 5. Data Flow

### 5.1 Wywołanie z Client Component (typowe — przycisk „Wyloguj" w nagłówku)

```text
User klika "Wyloguj"
  → handler (onClick) wywołuje signOutAndRedirect()
    → supabase.auth.signOut()                           // POST {SUPABASE_URL}/auth/v1/logout
      → GoTrue invaliduje refresh token (auth.users / auth.refresh_tokens)
      → Response 204 + Set-Cookie czyszczące tokeny
    → @supabase/ssr (createBrowserClient) usuwa sb-access-token, sb-refresh-token z document.cookie
    → useCanvasStore: reset slice'ów wymagających danych usera (UISlice.user, ProfileSlice itd.)
    → router.push(`/${locale}`)                        // domyślnie strona publiczna / login
    → next-intl middleware przepuszcza request, brak sesji → publiczne widoki
```

### 5.2 Wywołanie z Route Handlera (po `DELETE /api/user/account`)

```text
DELETE /api/user/account
  → re-auth (verify password)
  → auth.admin.deleteUser(user_id)                     // hard delete via service-role
  → const supabase = await createClient(); await supabase.auth.signOut()
                                                       // czyści cookies w response Next.js
  → response 200 { deleted: true, ... }
  → klient: router.push(`/${locale}/account-deleted`)
```

### 5.3 Synchronizacja z localStorage / Zustand

- **Zachowane (zgodnie ze specyfikacją):**
  - `welderdoc_autosave` — anonimowy/gość może kontynuować pracę po wylogowaniu.
  - `welderdoc_migrated_at` — marker idempotency dla migracji guest → cloud.
- **Reset (zalecany):**
  - Slice'y store'a zawierające user-scoped dane (np. `ProfileSlice`, lista dokumentów w `DocumentSlice`).
  - **Nie resetujemy** `ShapesSlice`/`HistorySlice`/`UISlice.canvas` — autosave w localStorage przejmuje rolę „canvas guest".

---

## 6. Security Considerations

1. **Brak własnego Route Handlera = brak własnej powierzchni ataku.** Odpowiedzialność za invalidację tokenu spoczywa na GoTrue (Supabase). Endpoint dziedziczy security stack Supabase Auth (rate limit GoTrue, CORS, signature JWT).
2. **Cookies `httpOnly` + `secure` + `sameSite=lax`** — zapewnia `@supabase/ssr` przy konstrukcji klienta (to konfiguracja domyślna). Logout nie nadpisuje ustawień — tylko ustawia `Max-Age=0`.
3. **CSRF:** wylogowanie nie zmienia danych użytkownika ani nie udostępnia poufnych informacji — niskie ryzyko CSRF. Niemniej należy zachować zasadę **nigdy nie udostępniać odsłoniętego POST `/api/logout` bez kontroli CSRF**, jeżeli kiedyś powstałby własny Route Handler. Dla SDK call (`supabase.auth.signOut`) ryzyka nie ma — wymaga kontekstu przeglądarki z aktywnym tokenem.
4. **Re-auth nie jest wymagane** — wylogowanie z bieżącego urządzenia nie zmienia danych konta. (Patrz: `DELETE /api/user/account` — TAM wymagany jest re-auth via password.)
5. **Forbidden patterns:**
   - **NIE** czytać `document.cookie` ręcznie i nie usuwać `sb-*` ręcznie — łatwo zostawić niepełny stan; SDK robi to deterministycznie.
   - **NIE** wywoływać `createAdminClient().auth.signOut()` — service-role nie ma kontekstu sesji użytkownika; metoda nie ma efektu.
   - **NIE** wywoływać `createBrowserClient` po stronie serwera (Server Action / Route Handler / Server Component) — brak `document.cookie` po stronie serwera. Server-side używa `await createClient()` z `src/lib/supabase/server.ts`.
6. **Zachowanie autosave dla użytkownika gościa:** ze względu na PRD i `architecture-base.md` §13, klucze `welderdoc_autosave` i `welderdoc_migrated_at` muszą **przetrwać** logout. Implementacja UI flow (krok 9 poniżej) jest punktem, w którym łatwo o regresję.
7. **Konsystentność locale po wylogowaniu:** redirect powinien iść na `/${currentLocale}` (z URL'a / `useLocale()`), NIE na profilowe `user.locale` — bo profilu już nie ma.

---

## 7. Error Handling

| Scenariusz | Źródło | Reakcja |
| --- | --- | --- |
| Brak aktywnej sesji (`AuthSessionMissingError`) | SDK | **Sukces** — operacja idempotentna; nie pokazujemy błędu, kontynuujemy redirect. |
| Network error (offline / DNS / 5xx GoTrue) | SDK | Pokaż toast `auth.errors.signOutFailed` (tłumaczenie z `src/messages/{pl,en}.json`); **mimo to** wymuś redirect i reset store'a. Dlaczego: lokalna sesja w cookie jest kluczowa — JWT expires sam, ale UX nie może utknąć. |
| Cookies nie zostały wyczyszczone (rzadki edge case w SSR po `signOut`) | `@supabase/ssr` | Wymuś `router.refresh()` po `router.push()` aby trafić na świeże middleware (`src/proxy.ts`), które zinwaliduje cookies przez `updateSession()`. |
| Błąd po stronie Server Action (np. `await cookies()` poza request scope) | Next.js runtime | Logowanie do konsoli/Sentry (gdy włączone). UI: użytkownik dostaje generyczny toast i jest cofany na `/${locale}/login`. |

**Brak tabeli `error_log`** w tym domenie — wylogowanie nie loguje się do dedykowanej tabeli błędów (potwierdzone w `api-plan.md` §9 — nie ma rekordu dla logout). Sentry / `console.error` to wystarczające instrumentowanie.

---

## 8. Performance Considerations

1. **Latency:** pojedynczy round-trip do GoTrue (~50–150 ms w regionie EU-Frankfurt). Nie blokuje renderowania UI po stronie klienta.
2. **Brak własnego Route Handlera oznacza brak cold-startu Vercel Function** dla logoutu z Client Component — wszystko leci bezpośrednio do Supabase.
3. **Cache-busting:** `router.push('/${locale}')` po `signOut()` — Next.js domyślnie revaliduje route segmenty; jeśli `/[locale]/page.tsx` jest cache'owany na poziomie segmentu, należy upewnić się, że dane user-scoped są oznaczone jako `dynamic` lub renderowane w Client Component.
4. **Multi-tab synchronization:** Supabase SDK nasłuchuje zdarzenia `storage` — wylogowanie w karcie A automatycznie zsynchronizuje stan w karcie B (event `SIGNED_OUT` z `onAuthStateChange`). Aplikacja powinna reagować na ten event w globalnym providerze (np. `AuthProvider`), wywołując ten sam reset store'a + redirect.

---

## 9. Implementation Steps

> Zgodnie z `tech-stack.md` §7 i CLAUDE.md (sekcja Architecture invariants), wszystkie wywołania Supabase muszą iść przez helpery z `src/lib/supabase/`. **Brak nowego Route Handlera.**

### Krok 1 — Helper kliencki (rekomendowane, ale opcjonalne)

Utwórz `src/lib/supabase/auth.ts` (jeśli jeszcze nie istnieje) z funkcją:

```typescript
'use client'
import { createClient } from '@/lib/supabase/client'

export async function signOutClient(): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.auth.signOut()
  // AuthSessionMissingError jest idempotentny — ignorujemy.
  if (error && error.name !== 'AuthSessionMissingError') {
    // Nie rzucamy — caller decyduje, czy pokazać toast.
    console.warn('signOut error (proceeding with local cleanup):', error.message)
  }
}
```

> Uwaga: jeśli zespół preferuje wywoływać `supabase.auth.signOut()` bezpośrednio z komponentu (bez wrappera), pomiń ten krok — ale pamiętaj o powtórzeniu obsługi `AuthSessionMissingError` w każdym callsite.

### Krok 2 — Komponent UI (przycisk „Wyloguj")

Wsadź do nagłówka aplikacji (`src/components/layout/UserMenu.tsx` lub odpowiednik):

```typescript
'use client'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { signOutClient } from '@/lib/supabase/auth'
import { useCanvasStore } from '@/store/useCanvasStore' // przykładowo

export function SignOutButton() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('auth')
  const resetUserSlices = useCanvasStore((s) => s.resetUserScoped)

  async function handleClick() {
    await signOutClient()
    resetUserSlices()
    router.push(`/${locale}`)
    router.refresh() // wymuś świeży render z middleware bez sesji
  }

  return (
    <button type="button" onClick={handleClick}>
      {t('signOut')}
    </button>
  )
}
```

### Krok 3 — Tłumaczenia

Dodaj klucze do `src/messages/pl.json` i `src/messages/en.json`:

```json
{
  "auth": {
    "signOut": "Wyloguj",
    "errors": {
      "signOutFailed": "Nie udało się wylogować. Spróbuj ponownie."
    }
  }
}
```

(EN: `"signOut": "Sign out"`, `"signOutFailed": "Could not sign out. Please try again."`)

### Krok 4 — Reset Zustand store'a

W `src/store/`:

- Dodaj akcję `resetUserScoped()` w głównym store / dedykowanym slice.
- Akcja czyści: `profile`, listę dokumentów (`DocumentSlice.documents`), `subscription` (jeśli istnieje).
- **NIE czyści:** `ShapesSlice`, `HistorySlice`, `UISlice.canvas` (autosave guest mode).

Zachowaj konwencję z `CLAUDE.md` (sekcja Zustand store conventions) — eksportuj custom hooka per slice; nie wystawiaj `useCanvasStore` bezpośrednio.

### Krok 5 — Globalny `onAuthStateChange` listener (multi-tab sync)

W `src/components/providers/AuthProvider.tsx` (Client Component, `'use client'`) zarejestruj subskrypcję:

```typescript
useEffect(() => {
  const supabase = createClient()
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      resetUserSlices()
      router.push(`/${locale}`)
    }
  })
  return () => data.subscription.unsubscribe()
}, [locale, resetUserSlices, router])
```

Provider montujemy w `src/app/[locale]/layout.tsx` (po `setRequestLocale(locale)`).

### Krok 6 — Reuse w `DELETE /api/user/account`

W przyszłym Route Handlerze `src/app/api/user/account/route.ts` (po hard-delete via `auth.admin.deleteUser(user_id)`):

```typescript
const supabaseSession = await createClient()
await supabaseSession.auth.signOut() // wyczyści cookies w odpowiedzi Next.js
return NextResponse.json({ deleted: true, user_id, deleted_at }, { status: 200 })
```

Klient po sukcesie wykonuje `router.push(\`/${locale}/account-deleted\`)`. Tę zależność dokumentuje już sekcja `api-plan.md` §2.1 / specyfikacja endpointu `delete-user-account`.

### Krok 7 — Testy jednostkowe (Vitest)

Utwórz `src/lib/supabase/auth.test.ts`:

- Mock `createClient` (`vi.mock('@/lib/supabase/client', ...)`) zwracający fałszywy `signOut` z różnymi wynikami:
  1. `{ error: null }` → funkcja zwraca void.
  2. `{ error: { name: 'AuthSessionMissingError', message: '...' } }` → brak rzutu wyjątku, brak `console.warn` (lub akceptujemy warn — zależy od finalnej decyzji).
  3. `{ error: { name: 'NetworkError', message: '...' } }` → `console.warn` wywołany; brak rzutu.
- Pokrycie powinno mieścić się w progach `vitest.config.ts` (lines 80, branches 70).

### Krok 8 — Testy E2E (Playwright)

Dodaj `e2e/auth/sign-out.spec.ts` (project `chromium-desktop`):

1. Zaloguj się przez fixturę (np. `auth.setup.ts` z `storageState`).
2. Otwórz `/${locale}/dashboard` (lub odpowiednik).
3. Kliknij `SignOutButton`.
4. Asercje:
   - URL po redirectcie = `/${locale}` (lub `/${locale}/login`).
   - Cookies `sb-access-token` / `sb-refresh-token` nieobecne (`page.context().cookies()` nie zawiera).
   - `localStorage.welderdoc_autosave` **istnieje** (regression guard dla zachowania scen guest).
   - Nawigacja na `/${locale}/dashboard` → middleware redirectuje na `/${locale}/login` (sesja zinwalidowana).

### Krok 9 — Manualna weryfikacja przed mergem

- [ ] Wylogowanie z Client Component czyści cookies (`Application` tab w DevTools).
- [ ] Wylogowanie nie kasuje `welderdoc_autosave` ani `welderdoc_migrated_at`.
- [ ] Po wylogowaniu w karcie A, karta B reaguje na `SIGNED_OUT` (multi-tab sync).
- [ ] `signOut()` na nieaktywnej sesji nie pokazuje błędu w UI.
- [ ] Redirect po sign-out idzie na `/${locale}` z URL bieżącej strony, **nie** na zapisane locale w usunionym profilu.
- [ ] `pnpm lint && pnpm typecheck && pnpm test:run && pnpm test:e2e -- --project=chromium-desktop` przechodzi.

### Krok 10 — Brak akcji wymaganych

Te punkty są **świadomie pominięte** (nie ma ich w MVP):

- Globalny logout (`scope: 'global'`) — nie w scope.
- Logowanie do tabeli `audit_log` — brak tej tabeli w `db-plan.md`.
- Rate limiting własnego endpointu — nie ma własnego endpointu.
- Custom Route Handler `POST /api/auth/logout` — `api-plan.md` §2.1 explicite mówi, że auth idzie przez SDK; nie tworzymy duplikatu.

---

**Podsumowanie:** wylogowanie w WelderDoc to operacja w 100% delegowana do Supabase Auth SDK. Plan implementacji koncentruje się na: (a) helperze klienckim w `src/lib/supabase/auth.ts`, (b) UI flow z resetem store'a + redirectem na `/${locale}`, (c) globalnym multi-tab listenerze, (d) reuse w `DELETE /api/user/account`. Brak własnego Route Handlera jest decyzją architektoniczną zgodną z `api-plan.md` §2.1 i `tech-stack.md` §7.
