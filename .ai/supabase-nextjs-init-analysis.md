# Inicjalizacja Supabase w Next.js — WelderDoc

> **Status:** analiza gotowa do implementacji  
> **Data:** 2026-05-08  
> **Kontekst:** analogiczna analiza do Astro-projektu, przepisana pod Next.js 16 App Router + `@supabase/ssr`  
> **Powiązane dokumenty:** `.ai/db-plan.md`, `.ai/tech-stack.md`

---

## 1. Weryfikacja wymagań wstępnych

| Wymaganie | Status | Uwaga |
|---|---|---|
| `@supabase/supabase-js ^2.45.0` | ✅ zainstalowany | `package.json` |
| `@supabase/ssr ~0.10.0` | ✅ zainstalowany | `package.json` |
| `supabase/config.toml` | ✅ istnieje | `project_id = "welder-doc-app"` |
| `supabase/migrations/20260507000000_complete_schema.sql` | ✅ istnieje | kompletny schemat MVP |
| `src/types/database.ts` | ❌ brak | wymaga wygenerowania (krok 2) |
| `NEXT_PUBLIC_SUPABASE_URL` w `.env.local` | ⚠️ sprawdź | domyślnie `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` w `.env.local` | ⚠️ sprawdź | pobierz z `pnpm supabase start` |
| `src/middleware.ts` (eksport `proxy` jako `middleware`) | ❌ brak | do stworzenia |

**Różnice względem projektu Astro:**
- Zmienne env: `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (prefiks `NEXT_PUBLIC_` dla klienta, nie `import.meta.env`)
- Brak `context.locals` — server client tworzy się per-request przez `cookies()` z `next/headers`
- Middleware: Next.js wymaga pliku `src/middleware.ts` z eksportem `middleware`; logika jest w `src/proxy.ts` (własna konwencja projektu)
- `@supabase/ssr` zamiast `@supabase/supabase-js` bezpośrednio — pakiet SSR obsługuje cookies-based auth dla App Router
- Typy generowane do `src/types/database.ts` (nie `src/db/database.types.ts`)

---

## 2. Kolejność operacji (co zrobić przed implementacją)

```bash
# 1. Upewnij się że Docker działa
pnpm supabase start          # uruchom lokalny stack; wypisuje URL + klucze

# 2. Uzupełnij .env.local wartościami z powyższego outputu:
#    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key z outputu>
#    SUPABASE_SERVICE_ROLE_KEY=<service_role key z outputu>

# 3. Zastosuj migrację
pnpm supabase db reset       # czyste slate: uruchamia migrations/ od zera

# 4. Wygeneruj typy TypeScript
supabase gen types typescript --local > src/types/database.ts
# LUB przez skrypt (wymaga SUPABASE_PROJECT_ID dla zdalnej instancji):
# pnpm supabase:types

# 5. Teraz możesz tworzyć pliki opisane poniżej
```

> **Uwaga:** Skrypt `supabase:types` w `package.json` generuje typy ze zdalnej instancji (`--project-id`).  
> Lokalnie użyj `supabase gen types typescript --local > src/types/database.ts`.  
> Dla lokalnego devu ta wersja jest wystarczająca — typy są identyczne z migracją.

---

## 3. Struktura plików do stworzenia

```
src/
├── types/
│   └── database.ts              ← [GENEROWANY] typy z supabase gen types
└── lib/
    └── supabase/
        ├── client.ts            ← [NOWY] klient przeglądarkowy (Client Components)
        ├── server.ts            ← [NOWY] klient serwerowy (Server Components, Route Handlers)
        └── middleware.ts        ← [NOWY] helper updateSession() dla src/proxy.ts
```

> **WAŻNE:** NIE tworzyć `src/middleware.ts`. W Next.js 16 `src/proxy.ts` jest bezpośrednim punktem wejścia — posiadanie obu plików jednocześnie powoduje błąd uruchomienia.

Modyfikacje istniejących plików:
```
src/proxy.ts                     ← [MODYFIKACJA] dodaj wywołanie updateSession() przed intlMiddleware
```

---

## 4. Szczegóły plików

### 4.1 `src/types/database.ts` — generowany

Generowany automatycznie przez `supabase gen types typescript --local`. Zawiera typy dla wszystkich tabel (`user_profiles`, `documents`, `subscriptions`, `consent_log`, `webhook_events`) oraz ich kolumn, enums i relacji.

**Nie edytować ręcznie** — zawsze regenerować po zmianach migracji.

> **Uwaga praktyczna:** `supabase gen types typescript --local` dokłada do pliku linię `Connecting to db 5432` na początku oraz tag `<claude-code-hint .../>` na końcu. Po generowaniu usuń obie linie ręcznie lub skryptem, inaczej `tsc` zgłosi błędy parsowania.

Schemat danych z bazy:
- `Database['public']['Tables']['documents']['Row']` — odczyt
- `Database['public']['Tables']['documents']['Insert']` — zapis
- `Database['public']['Tables']['documents']['Update']` — aktualizacja

---

### 4.2 `src/lib/supabase/client.ts` — klient przeglądarkowy

Używany wyłącznie w **Client Components** (`'use client'`). Tworzony raz per komponent (lub via `useMemo`).

```ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**Kiedy używać:** komponenty React potrzebujące dostępu do Supabase (np. formularz logowania, nasłuchiwanie zmian auth, realtime). Auth state po zalogowaniu jest dostępny przez `supabase.auth.getUser()` po stronie klienta.

**Kiedy NIE używać:** Server Components, Route Handlers, Server Actions — tam używaj `src/lib/supabase/server.ts`.

---

### 4.3 `src/lib/supabase/server.ts` — klient serwerowy

Używany w **Server Components**, **Route Handlers** (`app/api/*/route.ts`) i **Server Actions**. Tworzony per-request — zawiera cookies z `next/headers`.

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Wywoływane z Server Component — read-only cookies.
            // Middleware odświeża sesję, więc można zignorować.
          }
        },
      },
    }
  );
}
```

**Wariant dla Route Handlera z `service_role`** (tylko `app/api/paddle/webhook/route.ts`):

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

export async function createAdminClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,  // service_role — omija RLS
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() { /* admin client nie zarządza sesjami */ },
      },
    }
  );
}
```

> **Uwaga o `SUPABASE_SERVICE_ROLE_KEY`:** bez prefiksu `NEXT_PUBLIC_` — nigdy nie trafia do przeglądarki. Używane wyłącznie w `app/api/paddle/webhook/route.ts` zgodnie z `db-plan.md §5.13`.

---

### 4.4 `src/lib/supabase/middleware.ts` — helper updateSession

Odpowiednik Supabase SSR middleware — odświeża sesję JWT na każde żądanie. Musi być wywoływany przed jakimkolwiek renderowaniem strony.

```ts
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import type { Database } from '@/types/database';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // WAŻNE: nie dodawaj logiki między createServerClient a getUser()
  // getUser() musi zawsze być wywołane, żeby sesja była odświeżona
  const { data: { user } } = await supabase.auth.getUser();

  // Tu możesz dodać guard chroniący trasy chronione, np.:
  // if (!user && isProtectedRoute(request.nextUrl.pathname)) {
  //   return NextResponse.redirect(new URL('/pl/login', request.url));
  // }

  // WAŻNE: zwróć supabaseResponse — zawiera zaktualizowane cookies sesji
  return { supabaseResponse, user };
}
```

**Dlaczego `getUser()` jest obowiązkowe:** `@supabase/ssr` używa `getUser()` (nie `getSession()`) żeby zawsze walidować JWT z serwera Supabase, a nie tylko z lokalnego ciasteczka. Pominięcie tego powoduje losowe wylogowania użytkowników.

---

### 4.5 Modyfikacja `src/proxy.ts`

Istniejący plik ma już placeholder z komentarzem. Dodaj wywołanie `updateSession()` przed logiką intl:

```ts
import { type NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

const intlMiddleware = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user: _user } = await updateSession(request);

  // intl middleware: odczytuje cookies zaktualizowane przez updateSession
  const intlResponse = intlMiddleware(request);

  if (intlResponse) {
    // Przepisz cookies sesji Supabase do odpowiedzi intl
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...options }) => {
      intlResponse.cookies.set(name, value, options);
    });
    return intlResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)'
  ]
};
```

> **Uwaga o kolejności middleware:** Supabase `updateSession()` musi być przed `intlMiddleware`, ponieważ intl może dokonać redirect (np. dodanie prefiksu locale) — po redirectcie sesja nie jest odświeżana. Przepisanie cookies z `supabaseResponse` do `intlResponse` gwarantuje, że ciasteczka sesji nie zginą przy przekierowaniach intl.

---

### 4.6 `src/middleware.ts` — NIE TWORZYĆ

W Next.js 16 `src/proxy.ts` jest bezpośrednim punktem wejścia (zastępuje `middleware.ts`). Next.js 16 wykrywa plik `proxy.ts` eksportujący `proxy` + `config` i traktuje go jako middleware.

Obecność OBU plików (`src/middleware.ts` i `src/proxy.ts`) powoduje błąd uruchomienia:
```
Error: Both middleware file "./src/middleware.ts" and proxy file "./src/proxy.ts" are detected.
Please use "./src/proxy.ts" only.
```

**Nie tworzyć `src/middleware.ts`** — `src/proxy.ts` jest kompletnym setupem.

---

## 5. Wzorce użycia po inicjalizacji

### Server Component — pobranie sesji

```ts
// src/app/[locale]/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/pl/login');

  const { data: documents } = await supabase
    .from('documents')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false });

  return <DocumentList documents={documents ?? []} />;
}
```

### Route Handler — operacja z service_role (webhook)

```ts
// src/app/api/paddle/webhook/route.ts
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createAdminClient(); // omija RLS
  // ...
}
```

### Client Component — logowanie

```ts
// src/components/auth/LoginForm.tsx
'use client';
import { createClient } from '@/lib/supabase/client';

export function LoginForm() {
  const supabase = createClient();

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // ...
  }
  // ...
}
```

### Typowanie zapytań

```ts
import type { Database } from '@/types/database';

type Document = Database['public']['Tables']['documents']['Row'];
type NewDocument = Database['public']['Tables']['documents']['Insert'];
```

---

## 6. Zmienne środowiskowe — podsumowanie

| Zmienna | Gdzie używana | Wartość lokalna |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | klient + serwer | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | klient + serwer | z outputu `supabase start` |
| `SUPABASE_SERVICE_ROLE_KEY` | tylko server (webhook) | z outputu `supabase start` |
| `SUPABASE_PROJECT_ID` | tylko skrypt `pnpm supabase:types` | ID zdalnego projektu |

> `NEXT_PUBLIC_*` zmienne trafiają do bundle'a przeglądarki — poprawne dla URL i anon key (są publiczne by design). `SERVICE_ROLE_KEY` nigdy nie powinien mieć prefiksu `NEXT_PUBLIC_`.

---

## 7. Weryfikacja po implementacji

```bash
# 1. Typecheck — zero błędów
pnpm typecheck

# 2. Dev server — sprawdź czy middleware nie wyrzuca błędów
pnpm dev

# 3. Sprawdź czy sesja jest tworzona przy nawigacji:
#    - Studio lokalne: http://localhost:54323 (Supabase Studio)
#    - Auth > Users — po rejestracji powinien pojawić się nowy user

# 4. Smoke test
pnpm test:run tests/smoke.test.ts
```

---

## 8. Co NIE jest objęte tą inicjalizacją

Poniższe elementy są zależne od tej inicjalizacji, ale są oddzielnymi feature'ami:

| Feature | Gdzie implementować |
|---|---|
| Strona logowania / rejestracji | `src/app/[locale]/login/page.tsx` + `LoginForm.tsx` |
| Callback OAuth / email confirm | `src/app/[locale]/auth/callback/route.ts` |
| Guard chroniący trasy (redirect dla niezalogowanych) | `src/proxy.ts` — sekcja `if (!user && isProtectedRoute(...))` |
| Migracja dokumentu gościa do chmury (US-007) | `src/lib/migrations/guestMigration.ts` (po zalogowaniu) |
| Zarządzanie profilem użytkownika | `src/app/[locale]/settings/page.tsx` + supabase query na `user_profiles` |
| Webhook handler Paddle | `src/app/api/paddle/webhook/route.ts` (używa `createAdminClient`) |
| Cron `/api/cron/expire-subscriptions` | po konfiguracji Vercel Cron |
