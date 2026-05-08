# Analiza bazy danych WelderDoc — identyfikacja przeszkód dla lokalnego developmentu

> **Ważna obserwacja wstępna:** `supabase/config.toml` ma już `enable_confirmations = false`, co eliminuje jeden z potencjalnie największych problemów (potwierdzenie emaila). Analiza uwzględnia tę konfigurację.
>
> **Data:** 2026-05-07  
> **Dotyczy:** `supabase/migrations/20260507000000_complete_schema.sql`

---

## 1. Lista zidentyfikowanych mechanizmów

### 1.1 RLS (Row Level Security) — polityki dostępu

**Wszystkie tabele mają włączone RLS.** Jest to właściwe zachowanie dla produkcji, ale w środowisku lokalnym wymaga świadomego podejścia.

#### 1.1.a Polityki tabeli `documents` z warunkiem `email_confirmed_at IS NOT NULL`

**Cel produkcyjny:** Blokuje operacje na dokumentach przez użytkowników z niepotwierdzonym adresem email — chroni przed spamem przez jednorazowe konta.

**Wpływ na lokalne dev:**
- Domyślnie nowe konta tworzone przez Supabase Auth NIE mają ustawionego `email_confirmed_at`.
- Każda operacja `SELECT / INSERT / UPDATE / DELETE` na `documents` z tokenu `authenticated` byłaby blokowana.
- **Status: ROZWIĄZANE** — `supabase/config.toml` ma `enable_confirmations = false`. Supabase automatycznie ustawia `email_confirmed_at` przy rejestracji. Brak działania wymagany.

#### 1.1.b Brak polityk `INSERT/UPDATE/DELETE` na `subscriptions`

**Cel produkcyjny:** Mutacje subskrypcji możliwe wyłącznie przez webhook Paddle (via `service_role`).

**Wpływ na lokalne dev:**
- Nie można symulować upgrade do Pro przez zwykłego klienta aplikacji.
- Testy E2E muszą używać klucza `service_role` do bezpośredniej zmiany planu przez `user_profiles`.
- **Ryzyko wyłączenia:** Wysokie — nie wyłączamy tej polityki; zamiast tego używamy `service_role` w setup testów.

#### 1.1.c Brak polityk na `webhook_events`

**Cel produkcyjny:** Tabela dostępna tylko przez backend z `service_role` — żaden klient przeglądarkowy nie może czytać surowych payload webhooków.

**Wpływ na lokalne dev:**
- Testowanie handlera Paddle (`/api/paddle/webhook`) wymaga `service_role` do weryfikacji, że event został zapisany.
- **Ryzyko wyłączenia:** Niskie lokalnie, wysokie produkcyjnie — nie wyłączamy.

---

### 1.2 Triggery bazy danych

#### 1.2.a `on_auth_user_created` → `handle_new_user()` (na `auth.users`)

**Cel produkcyjny:** Automatycznie tworzy wiersz `user_profiles` przy każdej rejestracji.

**Wpływ na lokalne dev:** Generalnie pomocny, nie przeszkadza. Uwaga: jeśli trigger nie odpali (np. bezpośredni INSERT do `auth.users` w specyficznych kontekstach), profil nie powstanie i wszystkie inne operacje zawodzą.

**Ryzyko:** Niskie — trigger działa prawidłowo w lokalnym Supabase.

#### 1.2.b `documents_before_iu_check_free_limit` → `check_free_project_limit()`

**Cel produkcyjny:** Egzekwuje limit 1 projektu dla planu `free` na poziomie DB — jako zabezpieczenie przed race condition z dwóch zakładek i przed bezpośrednimi wywołaniami REST API.

**Wpływ na lokalne dev:**
- **To jest najpoważniejsza przeszkoda dla testów E2E.**
- Każdy użytkownik stworzony lokalnie ma `plan = 'free'` i może zapisać tylko 1 dokument.
- Próba INSERT drugiego dokumentu rzuca wyjątek `'project_limit_exceeded'`.
- Trigger jest BEFORE trigger — **`service_role` NIE omija triggerów** (omija tylko RLS). Trigger odpala się zawsze.
- Jedynym rozwiązaniem jest najpierw ustawić użytkownikowi `plan = 'pro'`.
- **Ryzyko wyłączenia:** Niskie lokalnie (trigger można tymczasowo wyłączyć tylko dla seed/setup), wysokie produkcyjnie.

#### 1.2.c `user_profiles_before_update_block_protected` → `block_protected_columns_update()`

**Cel produkcyjny:** Blokuje zmianę `plan` i `paddle_customer_id` przez tokeny `authenticated` — tylko `service_role` może te pola modyfikować.

**Wpływ na lokalne dev:**
- Ustawienie planu `pro` dla użytkownika testowego wymaga klienta `service_role`.
- Trigger sprawdza `auth.role()` — wartość pochodzi z JWT. Przy wywołaniu z kluczem `service_role`, `auth.role()` zwraca `'service_role'` i blok jest omijany.
- **Uwaga techniczna:** Przy wywołaniu z `psql`/`seed.sql` (bez JWT), `auth.role()` zwraca `NULL`. W PL/pgSQL `NULL <> 'service_role'` = `NULL` (falsy), więc blok `IF` jest pomijany — aktualizacje z poziomu seed/migracji DZIAŁAJĄ bez ograniczeń.
- **Ryzyko wyłączenia:** Niskie lokalnie, wysokie produkcyjnie — nie wyłączamy; używamy `service_role` w testach.

#### 1.2.d `subscriptions_after_iu_refresh_plan` → `trg_subscriptions_refresh_plan()`

**Cel produkcyjny:** Automatycznie odświeża `user_profiles.plan` po każdym INSERT/UPDATE statusu lub `current_period_end` w `subscriptions`.

**Wpływ na lokalne dev:**
- Wymaga pośredniego podejścia do ustawiania planu Pro: nie można bezpośrednio UPDATE `user_profiles.plan` przez `authenticated` token, ale można przez `service_role`.
- Dla testów wystarczy direct UPDATE na `user_profiles` przez `service_role` — nie trzeba symulować całego flow Paddle.
- **Ryzyko wyłączenia:** Niskie lokalnie.

---

### 1.3 Zewnętrzne integracje

#### 1.3.a Integracja Paddle

**Cel produkcyjny:** Webhooks z Paddle aktualizują status subskrypcji.

**Wpływ na lokalne dev:**
- Brak lokalnego Paddle — nie ma automatycznych webhooków.
- `PADDLE_WEBHOOK_SECRET` musi być ustawiony (nawet jako dummy) w `.env.local` — handler próbuje zweryfikować podpis.
- Testowanie pełnego flow płatności wymaga narzędzi Paddle CLI lub mockowania.
- **Rozwiązanie:** W lokalnym dev pomijamy integrację Paddle; ustawiamy plan przez `service_role` bezpośrednio.

#### 1.3.b Vercel Cron Jobs

**Cel produkcyjny:**
- `/api/cron/expire-subscriptions` (codziennie 03:00 UTC) — wywołuje `refresh_expired_plans()`
- `/api/cron/cleanup-webhook-events` (tygodniowo) — czyści stare eventy

**Wpływ na lokalne dev:** Brak w środowisku lokalnym (Vercel Cron nie działa lokalnie). Można przetestować endpointy ręcznie przez `curl`.

---

### 1.4 CHECK constraints na JSONB w `documents.data`

**Cel produkcyjny:** Gwarantuje strukturalną poprawność sceny — musi być obiektem z kluczami `schemaVersion`, `shapes` (array), `weldUnits` (array). Limit 5 MB.

**Wpływ na lokalne dev:**
- Testy tworzące dokumenty muszą dostarczyć prawidłowy payload JSONB.
- Minimalny prawidłowy dokument: `{ "schemaVersion": 1, "shapes": [], "weldUnits": [] }`
- INSERT z nieprawidłową strukturą zwróci błąd PostgreSQL (nie aplikacyjny).
- **Ryzyko wyłączenia:** Niskie lokalnie — ale nie zalecamy wyłączania; zamiast tego tworzymy helper z prawidłowym fixtures.

---

### 1.5 Synchronizacja `schema_version` (trigger `documents_before_iu_sync_schema_version`)

**Cel produkcyjny:** Utrzymuje kolumnę `schema_version` zsynchronizowaną z `data->>'schemaVersion'` dla partial index i migracji codec.

**Wpływ na lokalne dev:** Brak — trigger działa transparentnie. Jeśli `data` zawiera `schemaVersion`, kolumna zostanie ustawiona automatycznie.

---

### 1.6 Partial index `documents_schema_version_idx`

**Cel produkcyjny:** `WHERE schema_version < 1` — wykrywa stare dokumenty wymagające migracji.

**Wpływ na lokalne dev:** Aktualnie pusty (wersja 1 jest jedyną). Brak problemów.

---

## 2. Instrukcje wyłączania mechanizmów dla lokalnego developmentu

### Krok 1: Weryfikacja konfiguracji `supabase/config.toml`

Potwierdź, że plik `supabase/config.toml` zawiera właściwą konfigurację (już ustawioną w projekcie):

```toml
[auth.email]
enable_confirmations = false
```

To eliminuje problem z `email_confirmed_at IS NOT NULL` w politykach RLS tabeli `documents`. Użytkownicy tworzeni lokalnie będą mieli automatycznie potwierdzony email.

Nie wymaga żadnych działań — konfiguracja jest prawidłowa.

---

### Krok 2: Uzupełnienie `supabase/seed.sql` o dane testowe

Plik `supabase/seed.sql` jest wywoływany przez `pnpm supabase db reset` po każdym resetowaniu bazy. Wypełnij go danymi ułatwiającymi development:

```sql
-- supabase/seed.sql

-- ================================================================
-- Dane testowe dla lokalnego developmentu
-- UWAGA: Ten plik nie jest przeznaczony dla produkcji
-- ================================================================

-- Użytkownicy testowi tworzeni są przez Supabase Auth CLI lub E2E global-setup.
-- Seed.sql jest przeznaczony do konfiguracji stanu bazy po stworzeniu użytkowników.

-- Opcjonalnie: jeśli masz stałe UUID dla użytkowników testowych,
-- możesz je tu ustawić. Przykład (UUID muszą pasować do twoich kont testowych):

-- Ustawienie planu Pro dla użytkownika testowego
-- (działa bo seed.sql uruchamia się bez JWT — auth.role() = NULL => blok triggera pomijany)
-- DO $$ BEGIN
--   UPDATE public.user_profiles
--   SET plan = 'pro'
--   WHERE id = '00000000-0000-0000-0000-000000000001'; -- UUID twojego testowego konta Pro
-- END $$;
```

> **Ważna uwaga techniczna:** Aktualizacje wykonywane z `psql`/`seed.sql` (bez kontekstu JWT) omijają blokadę `block_protected_columns_update` automatycznie, ponieważ `auth.role()` zwraca `NULL` — `NULL <> 'service_role'` = `NULL` (falsy w PL/pgSQL). Nie trzeba żadnej specjalnej konfiguracji.

---

### Krok 3: Stworzenie klienta administracyjnego dla testów E2E

Stwórz helper dla Playwright, który używa `service_role` key do setupu stanu przed testami:

```typescript
// e2e/helpers/supabase-admin.ts
import { createClient } from '@supabase/supabase-js'

// Klucz service_role jest dostępny tylko po stronie serwera/testów — nigdy nie trafia do przeglądarki
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service_role omija RLS
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export { supabaseAdmin }
```

---

### Krok 4: Stworzenie helpera do tworzenia użytkowników testowych

```typescript
// e2e/helpers/create-test-user.ts
import { supabaseAdmin } from './supabase-admin'

interface TestUser {
  id: string
  email: string
  password: string
  plan: 'free' | 'pro'
}

export async function createTestUser(options: {
  email: string
  password: string
  plan?: 'free' | 'pro'
}): Promise<TestUser> {
  const { email, password, plan = 'free' } = options

  // 1. Stwórz użytkownika przez Supabase Admin Auth API
  //    email_confirm: true = ręczne potwierdzenie (choć lokalnie email_confirmations = false już to robi)
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // gwarantuje email_confirmed_at IS NOT NULL
    })

  if (authError || !authData.user) {
    throw new Error(`Nie udało się stworzyć użytkownika: ${authError?.message}`)
  }

  const userId = authData.user.id

  // 2. trigger on_auth_user_created automatycznie tworzył user_profiles z plan='free'
  //    Poczekaj chwilę na trigger (zazwyczaj działa natychmiastowo, ale asynchronicznie)
  await new Promise(resolve => setTimeout(resolve, 100))

  // 3. Ustaw plan Pro jeśli potrzebne
  //    service_role omija blokadę block_protected_columns_update
  if (plan === 'pro') {
    const { error: planError } = await supabaseAdmin
      .from('user_profiles')
      .update({ plan: 'pro' })
      .eq('id', userId)

    if (planError) {
      throw new Error(`Nie udało się ustawić planu Pro: ${planError.message}`)
    }
  }

  return { id: userId, email, password, plan }
}

export async function deleteTestUser(userId: string): Promise<void> {
  // ON DELETE CASCADE usuwa user_profiles i documents automatycznie
  await supabaseAdmin.auth.admin.deleteUser(userId)
}
```

---

### Krok 5: Konfiguracja zmiennych środowiskowych lokalnie

Upewnij się, że `.env.local` zawiera:

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key z `pnpm supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<service_role key z `pnpm supabase status`>

# Dummy wartości dla zależności zewnętrznych — nie używane lokalnie
PADDLE_WEBHOOK_SECRET=dummy_local_secret_not_real
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Klucze pobierz poleceniem:
```bash
pnpm supabase status
```

---

### Krok 6: Opcjonalne — lokalna migracja pomocnicza dla przypadków edge

Jeśli testy Playwright wymagają wielu dokumentów dla użytkownika Free (np. testowanie komunikatu o limicie przez bezpośredni bypass), stwórz opcjonalną lokalną migrację. **WAŻNE: Ten plik musi być w `.gitignore` lub oznaczony jako lokalna obsługa:**

```bash
# Tworzenie pliku (nie commituj tego do repo bez oznaczenia)
touch supabase/migrations/99999_local_dev_helpers.sql
```

```sql
-- supabase/migrations/99999_local_dev_helpers.sql
-- WYŁĄCZNIE LOKALNE ŚRODOWISKO — NIE DEPLOYOWAĆ NA PRODUKCJĘ
-- Jeśli ten plik trafi do CI/CD, deployment musi go ignorować.

-- Pomocnicza funkcja do bezpiecznego ustawiania planu testowego (omija triggery)
-- Używana wyłącznie w seed/test setup
CREATE OR REPLACE FUNCTION public.test_force_set_plan(uid UUID, new_plan TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.user_profiles
  SET plan = new_plan
  WHERE id = uid;
$$;

-- WAŻNE: Usuń tę funkcję przed deploymentem produkcyjnym!
-- pnpm supabase migration repair --status applied 99999_local_dev_helpers
```

> **Alternatywa:** Zamiast tej migracji, używaj zawsze `supabaseAdmin` z `service_role` — jest to wystarczające do wszystkich scenariuszy testowych.

---

## 3. Instrukcje włączania mechanizmów dla produkcji

Wszystkie mechanizmy produkcyjne są **domyślnie aktywne** w migracji `20260507000000_complete_schema.sql`. Nie trzeba ich "włączać" — są włączone od startu.

### Krok 1: Weryfikacja że lokalna migracja testowa nie trafiła do produkcji

```bash
# Sprawdź które migracje zostaną zastosowane na produkcji
pnpm supabase db diff --schema public

# Sprawdź listę migracji w projekcie
ls -la supabase/migrations/

# Jeśli istnieje 99999_local_dev_helpers.sql, usuń go PRZED deploymentem
rm supabase/migrations/99999_local_dev_helpers.sql
```

### Krok 2: Weryfikacja zmiennych środowiskowych na Vercel

```bash
# Lista zmiennych na Vercel (wymaga zalogowania `vercel login`)
vercel env ls

# Wymagane zmienne na produkcji:
# NEXT_PUBLIC_SUPABASE_URL     — URL projektu produkcyjnego Supabase
# NEXT_PUBLIC_SUPABASE_ANON_KEY — anon key produkcji
# SUPABASE_SERVICE_ROLE_KEY    — service_role key produkcji
# PADDLE_WEBHOOK_SECRET         — prawdziwy secret z dashboardu Paddle
# NEXT_PUBLIC_APP_URL           — produkcyjny URL aplikacji
```

### Krok 3: Weryfikacja konfiguracji Supabase Auth dla produkcji

W Supabase Dashboard → Production project → Authentication → Settings upewnij się, że:
- **Email Confirmations:** Włączone (`enable_confirmations = true` w warunkach produkcyjnych)
- **JWT Expiry:** Ustawiony odpowiednio (3600 sekund = 1 godzina, jak w `config.toml`)

> **UWAGA:** `config.toml` dotyczy tylko lokalnego stacku. Produkcyjne ustawienia Auth zarządzane są przez Supabase Dashboard lub API.

### Krok 4: Weryfikacja schema produkcyjnej Supabase

```bash
# Sprawdź czy migracje są zastosowane na produkcji
pnpm supabase db diff --linked

# Jeśli są różnice, zastosuj migracje
pnpm supabase db push
```

### Krok 5: Konfiguracja Vercel Cron Jobs

Upewnij się, że `vercel.json` (lub `vercel.ts`) zawiera konfigurację cronów:

```json
{
  "regions": ["fra1"],
  "crons": [
    {
      "path": "/api/cron/expire-subscriptions",
      "schedule": "0 3 * * *"
    },
    {
      "path": "/api/cron/cleanup-webhook-events",
      "schedule": "0 2 * * 1"
    }
  ]
}
```

---

## 4. Procedury weryfikacji

### 4.1 Weryfikacja poprawności lokalnego stacku

```bash
# 1. Uruchom lokalny stack Supabase
pnpm supabase start

# 2. Sprawdź status
pnpm supabase status
# Oczekiwane: wszystkie serwisy running, wypisane URL i klucze

# 3. Zresetuj bazę (stosuje migracje i seed)
pnpm supabase db reset

# 4. Sprawdź w Studio czy tabele istnieją
# Otwórz http://127.0.0.1:54323 w przeglądarce
# Sprawdź: public.user_profiles, public.documents, public.subscriptions,
#          public.consent_log, public.webhook_events
```

### 4.2 Weryfikacja triggerów i RLS — ręczne testy SQL

W Supabase Studio → SQL Editor (lokalny: `http://127.0.0.1:54323`):

```sql
-- Test 1: Weryfikacja że trigger on_auth_user_created działa
-- (po stworzeniu użytkownika przez Auth, profil powinien istnieć)
SELECT COUNT(*) FROM public.user_profiles;

-- Test 2: Weryfikacja domyślnego planu
SELECT id, plan FROM public.user_profiles LIMIT 5;
-- Oczekiwane: plan = 'free'

-- Test 3: Weryfikacja block_protected z perspektywy seed (bez JWT)
-- Uruchom w SQL Editor Studio (kontekst postgres, bez JWT):
UPDATE public.user_profiles SET plan = 'pro' WHERE id = (SELECT id FROM public.user_profiles LIMIT 1);
-- Oczekiwane: sukces (brak JWT → auth.role() = NULL → trigger przepuszcza)
SELECT plan FROM public.user_profiles LIMIT 1;
-- Oczekiwane: 'pro'

-- Test 4: Weryfikacja check_free_project_limit
-- Ustaw z powrotem plan free
UPDATE public.user_profiles SET plan = 'free' WHERE plan = 'pro';

-- Przygotuj dane testowe
INSERT INTO public.documents (owner_id, name, data)
SELECT id, 'Projekt 1', '{"schemaVersion":1,"shapes":[],"weldUnits":[]}'::jsonb
FROM public.user_profiles LIMIT 1;
-- Oczekiwane: sukces (pierwszy projekt)

INSERT INTO public.documents (owner_id, name, data)
SELECT id, 'Projekt 2', '{"schemaVersion":1,"shapes":[],"weldUnits":[]}'::jsonb
FROM public.user_profiles LIMIT 1;
-- Oczekiwane: BŁĄD 'project_limit_exceeded'

-- Cleanup testu
DELETE FROM public.documents;
```

### 4.3 Weryfikacja przez uruchomienie testów

```bash
# Testy jednostkowe (nie wymagają bazy danych)
pnpm test:run

# Testy E2E (wymagają działającego lokalnego Supabase)
# Przed uruchomieniem: upewnij się że supabase start jest aktywne
pnpm supabase start
pnpm test:e2e -- --project=chromium-desktop
```

### 4.4 Weryfikacja po deploymencie na produkcję

```bash
# 1. Sprawdź status deploymenty
vercel status

# 2. Sprawdź logi dla błędów bazy danych
vercel logs --filter=error

# 3. Przetestuj endpoint health
curl https://twoja-domena.vercel.app/api/health

# 4. Sprawdź w Supabase Dashboard (produkcja):
# - Zakładka "Database" → "Triggers" → potwierdź że wszystkie 9 triggerów istnieje
# - Zakładka "Auth" → "Policies" → potwierdź że RLS jest aktywne
# - Zakładka "Database" → "Functions" → potwierdź że wszystkie 9 funkcji istnieje
```

### 4.5 Weryfikacja mechanizmów subskrypcji (smoke test przez service_role)

```bash
# W konsoli Node.js lub skrypcie testowym:
# (Zastąp URL i klucze produkcyjnymi dla weryfikacji prod)
node -e "
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function smokeTest() {
  // Weryfikacja że effective_plan() działa
  const { data, error } = await admin.rpc('effective_plan', { uid: '00000000-0000-0000-0000-000000000000' })
  console.log('effective_plan(nieistniejący user):', data, error?.message)
  // Oczekiwane: 'free' (użytkownik nie istnieje → brak subskrypcji → free)
}
smokeTest()
"
```

---

## 5. Dodatkowe uwagi i ostrzeżenia

### 5.1 Kluczowa zasada: triggers vs. RLS

> **`service_role` omija RLS (Row Level Security), ale NIE omija triggerów BEFORE/AFTER.**

Tabela podsumowująca co jest omijane przez `service_role`:

| Mechanizm | Czy `service_role` omija? | Jak obejść lokalnie |
|-----------|--------------------------|---------------------|
| RLS `FOR SELECT` | ✅ Tak | — |
| RLS `FOR INSERT` | ✅ Tak | — |
| RLS `FOR UPDATE` | ✅ Tak | — |
| `check_free_project_limit` (BEFORE trigger) | ❌ Nie | Ustaw `plan = 'pro'` przed testem |
| `block_protected_columns_update` (BEFORE trigger) | ❌ Nie, ALE `auth.role()='service_role'` → blok jest omijany wewnątrz triggera | Używaj `service_role` klienta |
| `sync_schema_version_from_data` (BEFORE trigger) | ❌ Nie — ale to pomocny trigger | Dostarczaj `schemaVersion` w JSONB |
| `set_updated_at` (BEFORE trigger) | ❌ Nie — ale to pomocny trigger | — |

### 5.2 Kolejność operacji przy tworzeniu użytkownika Pro w testach

Prawidłowa sekwencja dla Playwright global-setup:

```
1. supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })
   → trigger on_auth_user_created → INSERT do user_profiles (plan='free')
2. POCZEKAJ ~100ms na wykonanie triggera (asynchroniczny w kontekście callback)
3. supabaseAdmin.from('user_profiles').update({ plan: 'pro' }).eq('id', userId)
   → auth.role()='service_role' → block_protected przepuszcza zmianę
4. Użytkownik jest gotowy do testowania funkcji Pro
```

### 5.3 Minimalny prawidłowy payload dla tabeli `documents`

Każdy INSERT/UPDATE dokumentu musi mieć ten format minimalny:

```json
{
  "schemaVersion": 1,
  "shapes": [],
  "weldUnits": [],
  "canvasWidth": 2970,
  "canvasHeight": 2100
}
```

`canvasWidth` i `canvasHeight` nie są wymagane przez CHECK constraint, ale są wymagane przez `documentCodec.ts` do prawidłowego odtworzenia sceny.

### 5.4 Testowanie limitu projektów — prawidłowe podejście

Do testowania komunikatu `'project_limit_exceeded'` (US-047):

```typescript
// ✅ PRAWIDŁOWE podejście w Playwright:
// Użytkownik Free próbuje zapisać 2. projekt — oczekiwany toast z limitem
const freeUser = await createTestUser({ email: 'free@test.com', password: '...', plan: 'free' })
// freeUser ma plan='free', może mieć max 1 projekt
// Zapisz 1 projekt przez UI... powinien przejść
// Spróbuj zapisać 2. projekt przez UI... powinien pokazać toast

// ❌ NIEPRAWIDŁOWE:
// Nie testuj przez bezpośredni INSERT z service_role dla limitu Free
// (service_role omija RLS ale trigger i tak odpali — test jest prawidłowy)
```

### 5.5 Obsługa wyjątku `project_limit_exceeded` w aplikacji

Aplikacja musi rozpoznawać błąd: `error.message.includes('project_limit_exceeded')` i mapować na klucz `next-intl`. Pamiętaj o dodaniu tego klucza do `src/messages/pl.json` i `src/messages/en.json`.

### 5.6 Weryfikacja czy `auth.role()` działa prawidłowo lokalnie

Jeśli masz wątpliwości co do zachowania `auth.role()` w kontekście seed/migracji, sprawdź w SQL Editor Studio:

```sql
-- Wywołane bez JWT w Studio (postgres context):
SELECT auth.role();
-- Oczekiwane: NULL lub 'anon'
-- (potwierdza że block_protected trigger nie blokuje updateów z seed.sql)
```

### 5.7 Nie wyłączaj RLS globalnie

Jedną z najgorszych praktyk jest wyłączanie RLS na tabelach dla lokalnego developmentu:

```sql
-- ❌ NIGDY NIE RÓB TEGO:
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;
```

Prowadzi to do sytuacji gdzie testy przechodzą lokalnie (brak RLS) ale failują na produkcji (RLS aktywne). Zamiast tego zawsze używaj `service_role` w setup testów.

### 5.8 Dokumentacja Inbucket dla lokalnych emaili

Lokalny Supabase uruchamia Inbucket (fake SMTP) na `http://127.0.0.1:54324`. Chociaż `enable_confirmations = false` eliminuje potrzebę klikania w linki potwierdzające, Inbucket jest użyteczny do testowania flow resetu hasła (US-004).

### 5.9 Trigger `effective_plan()` — zależność od czasu

Funkcja `effective_plan()` korzysta z `now()`. W testach weryfikujących zachowanie po wygaśnięciu subskrypcji, ustaw `current_period_end` na przeszłość:

```sql
-- Symulacja wygasłej subskrypcji (tylko przez service_role):
INSERT INTO public.subscriptions (user_id, paddle_subscription_id, paddle_customer_snapshot, status, plan_tier, current_period_end)
VALUES ('USER_UUID', 'test_sub_1', 'cus_test', 'canceled', 'pro_monthly', now() - interval '1 day');
-- → trigger subscriptions_after_iu_refresh_plan odświeży plan → plan = 'free'
```
