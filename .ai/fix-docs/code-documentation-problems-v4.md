# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v4)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 4.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/code-documentation-problems-v3.md`, kod w `src/`, `supabase/migrations/20260507000000_complete_schema.sql`, `supabase/config.toml`, `vercel.json`, `tsconfig.json`, `package.json`, `CLAUDE.md`.
>
> **Stan projektu:** post-bootstrap, pre-implementation. Pliki w `src/` to szkielety z komentarzami-wytycznymi; logika domen (shapes, weld-units, store slices, components) nie istnieje. `src/app/api/health/route.ts` jest jedynym zaimplementowanym route handlerem.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, powodujący błąd produkcyjny lub silnie wprowadzający w błąd implementatora.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru.
> - 🟢 **Drobne** — niespójności, kosmetyczne, niska pilność.

---

## 0. Status problemów z v3 — pełna tabela

| # v3 | Tytuł | Status (v4, 2026-05-08) | Komentarz |
|---|---|---|---|
| 1.1 | `HIT_AREA_TOUCH = 16` w kodzie vs spec 20 | ✅ **Naprawione** | `src/canvas-kit/constants.ts:8` ma `HIT_AREA_TOUCH = 20`. |
| 1.2 | Vercel Cron POST vs GET | ✅ **Naprawione w architecture-base.md** | §16 deklaruje `GET`. **ALE:** `api-plan.md` wciąż ma `POST` — patrz nowy §1.1. |
| 1.3 | Cron/webhook/consent/export route handlery nie istnieją | 🔴 **Wciąż aktywne** | Tylko `api/health/route.ts` istnieje. Patrz nowy §1.3. |
| 2.1 | `AllShapeGeometry = {}` scaffold | 🟡 **Wciąż aktywne (świadome)** | Komentarz TODO w `src/store/types.ts:8` poprawnie ostrzega o BREAKING change. |
| 2.2 | `SHAPE_REGISTRY: Partial<Record>` vs spec | ✅ **Naprawione** | Architecture §5 dokumentuje `Partial<Record>` + `getShapeDefinition`. |
| 2.3 | `Shape = BaseShape` placeholder | 🟢 **Świadome (komentarz w kodzie)** | `src/shapes/index.ts:21-29` ma TODO scaffolda. Akceptowalne dopóki kształty nieimplementowane. |
| 2.4 | `_geometryChecksum` w `WeldJointShape` | ✅ **Naprawione** | Architecture §6 nie zawiera już `_geometryChecksum`; §7 jawnie mówi "Nigdy nie jest przechowywana w `WeldJointShape`". |
| 2.5 | Partial index `WHERE schema_version < 1` | ✅ **Naprawione** | Migracja `20260507000000_complete_schema.sql:148` używa pełnego B-tree `(schema_version)` z komentarzem objaśniającym. |
| 2.6 | `devtools` w store | ✅ **Naprawione** | `src/store/use-canvas-store.ts:15-19` zawiera warunkowe `devtools(...)` z `enabled: process.env.NODE_ENV !== 'production'`. |
| 3.1 | `Point` w dwóch miejscach | ✅ **Naprawione** | `src/canvas-kit/pointerInput.ts:22-24` re-eksportuje `Point` z `@/shapes/_base/types` z komentarzem o kanonicznym źródle. |
| 3.2 | Komentarz „CanvasShell podpina pointerInput" | ✅ **Naprawione** | Architecture §3 mówi „CanvasShell.tsx ← `<Stage>+<Layer>`; singleton ref → activeStage.ts → rasterize" oraz „CanvasApp.tsx ← podpina usePointerInput". |
| 3.3 | Walidacja eksportu `weldUnits.length === 0` redundancja | ✅ **Naprawione** | Architecture §12 ma komentarz „weldUnits.length === 0 jest zawsze implikowane przez shapes.length === 0". |
| 3.4 | `consent_log.ip_address: unknown` w generowanych typach | 🟢 **Wciąż aktywne (workaround udokumentowany)** | `src/types/database.ts:43` ma `ip_address: unknown`. Db-plan §1.6 zawiera już proponowany wrapper `ConsentLogRow`. |
| 3.5 | `snapEngine.ts` importuje z `@/shapes/_base/types` | ✅ **Naprawione (przez dokumentację)** | `src/lib/snapEngine.ts:1` zawiera komentarz „lib/ → shapes/_base/types jest zależnością jednostronną i legalną (architecture §3)". |

**Wniosek:** 11 z 14 problemów v3 zostało naprawionych. 3 pozostają (1.3, 2.1, 3.4) — wszystkie świadome (scaffoldy/odłożone do implementacji właściwego feature'u).

Poniżej: **nowe problemy** zidentyfikowane przy v4, oraz przeniesione aktywne z v3.

---

## 1. 🔴 Krytyczne

### 1.1 `api-plan.md` § 2.1 + § 3 deklaruje `POST /api/cron/*`, ale architecture-base.md § 16 i CLAUDE.md wymagają `GET` (Vercel Cron domyślnie woła GET)

**Problem (regresja od v3):** v3 § 1.2 zalecał zmianę `POST → GET` dla cronów. `architecture-base.md` zostało poprawione (§16 ma `GET   /api/cron/...`), ale `api-plan.md` jest **niezgodne** w kilku miejscach jednocześnie:

`api-plan.md` linie:
- `:249` — `#### POST /api/cron/expire-subscriptions`
- `:288` — `#### POST /api/cron/cleanup-webhook-events`
- `:835` — Tabela poziomów dostępu: `Service Role | POST /api/paddle/webhook, POST /api/cron/* | SUPABASE_SERVICE_ROLE_KEY`
- `:836` — `Cron Secret | POST /api/cron/* | Authorization: Bearer {CRON_SECRET}`
- `:914` — „Time-based — `POST /api/cron/expire-subscriptions` daily 03:00 UTC"

`architecture-base.md:1220-1221` (poprawnie):
```
GET   /api/cron/expire-subscriptions     ← Vercel Cron 03:00 UTC daily
GET   /api/cron/cleanup-webhook-events   ← Vercel Cron 02:00 UTC Sunday
```

`CLAUDE.md` (poprawnie):
> „export `GET` (not POST — Vercel Cron sends GET by default) with `Authorization: Bearer ${CRON_SECRET}` header verification"

**Konsekwencje:** `api-plan.md` jest najszczegółowszym źródłem kontraktów endpointów (zawiera ładunki, kody błędów, logikę przetwarzania). Implementator otworzy ten plik aby napisać `route.ts` i napisze `export async function POST(...)`. Vercel Cron wyśle GET → 405 Method Not Allowed. Crony nie zadziałają w produkcji:
- Plany Pro nie będą downgrade'owane po grace period (nie wykona się `refresh_expired_plans()`).
- `webhook_events` urośnie bez retencji 90 dni.
- Vercel pokaże błędy w logach Cron, ale UI deploymentu będzie zielony.

**Rozwiązanie:** Zaktualizować `api-plan.md` w 5 miejscach:

```diff
- #### `POST /api/cron/expire-subscriptions`
+ #### `GET /api/cron/expire-subscriptions`

- #### `POST /api/cron/cleanup-webhook-events`
+ #### `GET /api/cron/cleanup-webhook-events`

  | **Service Role** | `POST /api/paddle/webhook`, `POST /api/cron/*` | … |
- | **Cron Secret** | `POST /api/cron/*` | `Authorization: Bearer {CRON_SECRET}` |
+ | **Service Role** | `POST /api/paddle/webhook`, `GET /api/cron/*` | … |
+ | **Cron Secret** | `GET /api/cron/*` | `Authorization: Bearer {CRON_SECRET}` |

- 2. **Time-based** — `POST /api/cron/expire-subscriptions` daily 03:00 UTC
+ 2. **Time-based** — `GET /api/cron/expire-subscriptions` daily 03:00 UTC
```

**Rekomendacja:** wykonać poprawkę przed jakąkolwiek implementacją cron route handlerów. `api-plan.md` jest „source of truth" dla cron endpointów — pozostawienie błędu w trzech źródłach (api-plan vs architecture vs CLAUDE) gwarantuje że ktoś pójdzie za niewłaściwym.

---

### 1.2 `api-plan.md` § 2.1 i § 2.2 mają niespójny kontrakt `POST /api/consent` z `architecture-base.md` § 14

**Problem:**

`architecture-base.md` § 14 (kolejność operacji rejestracji):
```
2. POST /api/consent { types: ['terms_of_service','privacy_policy','cookies'], version, userAgent }
```
Jeden POST z tablicą typów (bundle TOS + PP + cookies w jednym wywołaniu).

`api-plan.md:114-122`:
```json
{
  "consent_type": "terms_of_service",
  "version": "1.0",
  "accepted": true
}
```
Pojedynczy `consent_type`. § 2.2 (kod TS dla rejestracji `:349-359`) potwierdza interpretację „pojedynczy" — wykonuje **dwa kolejne fetch-e** (jeden dla TOS, drugi dla PP, brak dla cookies):

```typescript
await fetch('/api/consent', { ... body: { consent_type: 'terms_of_service', ... } })
await fetch('/api/consent', { ... body: { consent_type: 'privacy_policy', ... } })
```

Nie ma trzeciego wywołania dla `cookies`, choć db-plan.md §1.5 wymaga `consent_type IN ('terms_of_service','privacy_policy','cookies')` i architecture §14 jawnie wymienia wszystkie trzy.

**Dwa różne kontrakty + niekompletne pokrycie typów**:
- arch §14: 1 request × 3 typy w array
- api-plan §2.1: pojedynczy typ w request
- api-plan §2.2 (przykład rejestracji): 2 z 3 wymaganych typów

**Konsekwencje:**
- Implementator nie wie czy pisać handler przyjmujący array, czy pojedynczy typ.
- Jeśli pójdzie za api-plan §2.1 (pojedynczy), formularz rejestracji wykona 3 fetche zamiast 1 → 3× round-trip do anonimizacji IP, 3× INSERT do consent_log w **różnych** transakcjach (bez ACID dla bundle).
- Brak zgody `cookies` w przykładzie §2.2 oznacza, że PRD US-001 („Wymagany jest checkbox zgody na Regulamin i Politykę Prywatności") nie pokrywa cookies, ale architecture §14 wymaga wszystkich trzech.
- `current_consent_version` w `user_profiles` ma być denormalizacją „TOS+PP+cookies bundle" (db-plan §1.2) — to wymaga zapisu wszystkich trzech typów w jednej transakcji albo client-side składania bundle.

**Rozwiązanie — wybór architektury:**

**Opcja A (zalecana):** Zaktualizować api-plan.md do bundle (zgodne z arch §14):
```json
POST /api/consent
{
  "types": ["terms_of_service", "privacy_policy", "cookies"],
  "version": "1.0",
  "accepted": true
}
```
Handler INSERT-uje 3 wiersze w jednej transakcji. Jeden request = jedno wywołanie anonimizacji IP. `current_consent_version` ustawiana atomowo po pomyślnym INSERT.

**Opcja B:** Zaktualizować architecture §14 do per-type (zgodne z api-plan §2.1):
- Wymaga 3 osobnych requestów z formularza rejestracji.
- Atomowość bundle musi być symulowana client-side (try/catch + rollback).
- `current_consent_version` wymaga UPDATE w osobnym requeście dopiero po pomyślności wszystkich trzech.

**Rekomendacja:** Opcja A — bundle. Powody:
1. Atomowość: 3 typy zgody to logiczna jedność (zgoda przy rejestracji), nie 3 niezależne zdarzenia.
2. Mniej round-tripów: 1 request zamiast 3.
3. Łatwiejsza obsługa błędów: jeden punkt failover (cały bundle albo nic) zamiast partial-failure (TOS zapisany, PP padł).
4. `current_consent_version` jako bundle version wymaga atomowości — Opcja B wprowadza okno czasowe gdzie `consent_log` ma TOS + PP, ale nie cookies.

Endpoint `POST /api/consent` z bundle musi zachować kompatybilność z funkcją „wycofanie zgody" (per-type) — tu można użyć rozróżnienia: array `types[]` traktowany jako bundle insert; pojedynczy `consent_type` traktowany jako revocation. Albo dodać osobny endpoint `POST /api/consent/revoke` dla per-type wycofania.

---

### 1.3 (przeniesione z v3 § 1.3, rozszerzone) Brak Route Handlerów: cron + webhook Paddle + consent + user/export

**Status:** wciąż aktywne. v3 zaadresował wymagania `GET` HTTP method (dla cronów), ale fizyczne pliki wciąż nie istnieją.

**Stan obecny `src/app/api/`:**
```
src/app/api/health/route.ts    ← jedyny istniejący
```

**Brakujące pliki (z `api-plan.md` § 2.1):**
```
src/app/api/cron/expire-subscriptions/route.ts        (GET, Authorization: Bearer ${CRON_SECRET})
src/app/api/cron/cleanup-webhook-events/route.ts      (GET, Authorization: Bearer ${CRON_SECRET})
src/app/api/paddle/webhook/route.ts                   (POST, weryfikacja paddle-signature)
src/app/api/consent/route.ts                          (POST, RODO motyw 30, anonimizacja IP)
src/app/api/user/export/route.ts                      (GET, RODO art. 20)
```

**Wymóg merge do `main`:**
- `vercel.json` deklaruje 2 crony — pierwszy push do `main` bez tych route handlerów → Vercel Cron uderzy w 404, downgrade planów + retencja webhook_events nie działają.
- Bez `paddle/webhook/route.ts` upgrade do Pro nie aktywuje subskrypcji (US-045 nie zadziała).
- Bez `consent/route.ts` US-001 (rejestracja z zgodą) nie działa.
- Bez `user/export/route.ts` RODO art. 20 nie jest spełnione (db-plan §5.14 punkt 6 ma to oznaczone ✅ jako kontrakt, ale implementacja TODO).

**Rozwiązanie:** dodać do CLAUDE.md w sekcji „Workflow guardrails" (lub do `.github/PULL_REQUEST_TEMPLATE.md`) checklistę pre-merge:

```markdown
## PR checklist — przed merge do `main`

- [ ] Jeśli `vercel.json.crons[]` nie pusty: każdej ścieżce odpowiada
      `src/app/api/<path>/route.ts` z eksportem `GET` i weryfikacją
      `Authorization: Bearer ${CRON_SECRET}`.
- [ ] Jeśli aplikacja używa Paddle Checkout (`@paddle/paddle-js`):
      `src/app/api/paddle/webhook/route.ts` istnieje i weryfikuje
      `paddle-signature` przez `PADDLE_WEBHOOK_SECRET`.
- [ ] Jeśli formularz rejestracji jest zaimplementowany:
      `src/app/api/consent/route.ts` istnieje z anonimizacją IP
      przez `src/lib/ipAnonymize.ts`.
```

CLAUDE.md już ma analogiczny zapis dla cronów (linia `:71`); rozszerzyć go o pozostałe route handlery.

**Rekomendacja:** rozważyć dodanie skryptu CI sprawdzającego pokrycie `vercel.json.crons[].path` plikami w `src/app/api/`, np. `pnpm verify:crons`, wywoływanego w workflow `lint-and-typecheck`. To zatrzymuje merge automatycznie zamiast polegać na ludzkiej checkliście.

---

## 2. 🟡 Istotne

### 2.1 `tsconfig.json` — `"jsx": "react-jsx"` vs `tech-stack.md` § 2 `"jsx": "preserve"`

**Problem:**

`tsconfig.json:7`:
```json
"jsx": "react-jsx",
```

`tech-stack.md:35`:
> „`tsconfig.json`: `"strict": true`, `"moduleResolution": "Bundler"`, `"jsx": "preserve"`, `"types": ["vitest/jsdom"]`"

**Kontekst:**
- Next.js (App Router, Next 15+) **standardowo** generuje tsconfig z `"jsx": "preserve"`. Next ma własny SWC-based JSX transform i delegowanie pozwala mu kontrolować transformację per-target.
- `"react-jsx"` używa nowego JSX transform (React 17+) i każe TypeScriptowi emitować `_jsx`/`_jsxs` zamiast `React.createElement`. Kompiluje się i działa, ale Next.js nie polega na transformacji TS — używa swojego.
- Realne ryzyka `react-jsx`:
  1. Możliwe konflikty z RSC (React Server Components) gdy TS emituje JSX runtime przed Next-em.
  2. Jeśli Vitest używa `vite-tsconfig-paths` + `@vitejs/plugin-react`, plugin oczekuje określonego importu JSX runtime — desync może powodować dziwne błędy w testach komponentów React 19.

**Konsekwencje:**
- Implementator komponentów TSX będzie pisał kod zakładając standard Next.js (`preserve`); jeśli odkryje błąd, nie znajdzie wyjaśnienia w dokumentacji.
- Decyzja o `react-jsx` mogła być świadoma, ale brak komentarza w `tsconfig.json` lub adnotacji w tech-stack.md.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** zsynchronizować z dokumentacją:
```diff
- "jsx": "react-jsx",
+ "jsx": "preserve",
```

**Opcja B:** zaktualizować `tech-stack.md` § 2 i dodać komentarz w `tsconfig.json`:
```json
{
  "compilerOptions": {
    // "react-jsx" zamiast Next.js-default "preserve" — świadomy wybór dla [POWÓD].
    "jsx": "react-jsx"
  }
}
```

**Rekomendacja:** Opcja A. `react-jsx` w projekcie Next.js to nietypowa decyzja, a powodu nie udało mi się znaleźć w żadnym dokumencie. Najprawdopodobniej `tsconfig.json` został wygenerowany przez `create-next-app` w wariancie który ma `react-jsx`, a tech-stack.md odnosi się do innego wariantu. Zsynchronizowanie z `preserve` zmniejsza ryzyko subtelnych issues w przyszłości.

---

### 2.2 `api-plan.md` § 2.1 logika `/api/consent` zaleca `service_role` mimo że RLS pozwala authenticated INSERT

**Problem:**

`api-plan.md:156`:
> „4. INSERT do `consent_log` z użyciem klienta `service_role` (dla ustawienia anonimizowanego IP; RLS `user_id = auth.uid()` egzekwowane ręcznie w kodzie)"

Ale migracja `20260507000000_complete_schema.sql` ma:
```sql
create policy consent_log_insert_authenticated
  on public.consent_log
  for insert
  to authenticated
  with check (user_id = auth.uid());
```

Polityka RLS w pełni pokrywa scenariusz: użytkownik authenticated może INSERT do `consent_log` ze swoim `user_id`. Anonimizacja IP po stronie serwera nie wymaga `service_role` — IP jest po prostu polem które serwer zapisze (tak samo jak `user_agent`).

**Konsekwencje (security smell):**
- `service_role` omija WSZYSTKIE polityki RLS — każde użycie tego klienta w route handlerze poszerza powierzchnię ataku. Jeśli logika handlera ma bug (np. nie weryfikuje user_id z sesji), service_role pozwoli zapisać consent dla **dowolnego** user_id.
- „RLS `user_id = auth.uid()` egzekwowane ręcznie w kodzie" — to dosłowne odtworzenie tego co RLS robi automatycznie, ale podatne na regresję (developer może zapomnieć weryfikacji).
- Reguła „service_role tylko gdy konieczne" (db-plan § 1.6, tech-stack § 7) — `/api/consent` nie spełnia warunku konieczności.

**Rozwiązanie:** zaktualizować `api-plan.md` § 2.1 logikę:

```diff
- 4. INSERT do `consent_log` z użyciem klienta `service_role` (dla ustawienia
-    anonimizowanego IP; RLS `user_id = auth.uid()` egzekwowane ręcznie w kodzie)
+ 4. INSERT do `consent_log` z użyciem klienta `createServerClient` (sesja
+    użytkownika, sesja JWT). RLS automatycznie waliduje `user_id = auth.uid()`.
+    Pole `ip_address` ustawiane przez handler po anonimizacji (klient anon
+    może zapisać dowolne pole non-RLS).
```

**Zastosowanie service_role tylko gdy potrzebne:**
- `POST /api/paddle/webhook` — TAK (`subscriptions` ma RLS bez polityk INSERT/UPDATE/DELETE; tylko service_role może mutować).
- `POST /api/cron/*` — TAK (cron działa w kontekście systemu, nie usera; brak sesji JWT).
- `POST /api/consent` — NIE (pełna polityka RLS na `consent_log`).
- `GET /api/user/export` — NIE (RLS na `documents`, `consent_log`, `subscriptions` pozwala SELECT-y wszystkim własnym danym).

---

### 2.3 Migracja tworzy 4 osobne polityki dla `documents`, ale db-plan § 4.2 i architecture § 15 deklarują pojedynczą `FOR ALL`

**Problem:**

`db-plan.md` § 4.2:
```sql
CREATE POLICY documents_owner_all ON public.documents
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid() AND EXISTS (...))
  WITH CHECK (owner_id = auth.uid() AND EXISTS (...));
```

Migracja `20260507000000_complete_schema.sql` (linie ok. 433-501) tworzy **cztery** osobne polityki:
- `documents_select_authenticated`
- `documents_insert_authenticated`
- `documents_update_authenticated`
- `documents_delete_authenticated`

Funkcjonalnie równoważne (`FOR ALL` to alias dla 4 osobnych polityk SELECT/INSERT/UPDATE/DELETE z identycznym body), ale:

- Nazwy w migracji nie pasują do db-plan ani do `architecture-base.md` § 15 (tabela RLS overview używa „ALL").
- Implementator szukający w bazie polityki `documents_owner_all` przez `\d+ documents` lub Studio nie znajdzie jej.
- Audyt (np. „pokaż mi wszystkie polityki documents") wyświetli 4 wpisy zamiast jednego — utrudnia inspect.

**Konsekwencje (drobne):**
- Niezgodność nazewnictwa — db-plan § 4.2 pokazuje przykład `CREATE POLICY documents_owner_all` jako wzorzec, którym implementator może chcieć się posłużyć. Po skonsultowaniu z migracją zobaczy 4 inne nazwy.
- Każda zmiana logiki (np. dodanie sprawdzenia stanu konta) wymaga edycji 4 polityk zamiast 1 — ryzyko desynchronizacji.

**Rozwiązanie — wybór:**

**Opcja A:** Zaktualizować db-plan.md § 4.2 do struktury z migracji (4 polityki). Najmniej zmian.

**Opcja B:** Zmienić migrację na pojedynczą `FOR ALL`:
```sql
create policy documents_owner_all
  on public.documents
  for all
  to authenticated
  using (owner_id = auth.uid() and exists (
    select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
  ))
  with check (owner_id = auth.uid() and exists (
    select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
  ));
```

**Rekomendacja:** Opcja B (jedna polityka) — zgodne z db-plan, prostsze do utrzymania, mniej duplikacji body. **ALE** — migracja jest już zaapliokowana lokalnie i opisana jako czysty CREATE bez DROP IF EXISTS. Zmiana tej migracji w miejscu wymaga `pnpm supabase db reset` (co dla solo dewelopera jest OK), albo nowej migracji `2026...01_consolidate_documents_policies.sql` która `DROP POLICY` 4 starych + `CREATE POLICY` jednej `FOR ALL`.

Stan projektu (pre-implementation, lokalna baza, brak produkcji) pozwala na pierwsze podejście (edit-in-place + db reset).

---

### 2.4 `api-plan.md` § 2.2 pozwala authenticated klientowi UPDATE-ować `user_profiles.current_consent_version` bezpośrednio — brak weryfikacji że odpowiedni `consent_log` istnieje

**Problem:**

`api-plan.md:663-672`:
```typescript
const { data, error } = await supabase
  .from('user_profiles')
  .update({
    locale: 'en',                      // opcjonalne
    current_consent_version: '1.1'     // opcjonalne
  })
  .eq('id', userId)
```

Migracja `block_protected_columns_update` blokuje tylko `plan` i `paddle_customer_id`. Pole `current_consent_version` jest **modyfikowalne** przez authenticated klienta przez RLS `user_profiles_update_authenticated`.

`db-plan.md` § 1.2:
> „`current_consent_version` | `TEXT` | nullable | Denormalizacja ostatniej zaakceptowanej wersji TOS+PP+cookies"

`architecture-base.md` § 14:
> „Zdarzenie ponownej zgody = nowy INSERT do `consent_log`, UPDATE `current_consent_version`."

**Konsekwencje (integralność danych):**
- User może wykonać `UPDATE user_profiles SET current_consent_version = '999.0' WHERE id = auth.uid()` przez DevTools / curl bez `INSERT` do `consent_log`.
- Audit zgód RODO art. 7 ust. 1 traci spójność: `current_consent_version = '1.1'`, ale `consent_log` nie zawiera wpisu dla tej wersji.
- Logika weryfikacji „czy user zaakceptował aktualne TOS" (architecture §14: „przy każdym zalogowaniu pobierz `user_profiles.current_consent_version`. Jeśli `NULL` lub starsza niż aktualna wersja TOS/PP → pokaż modal zgody") opiera się na zaufaniu do `current_consent_version` — user może to zafałszować.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** Dodać trigger na `user_profiles` blokujący zmianę `current_consent_version` z `authenticated` (analogicznie do `block_protected_columns_update`):

```sql
-- Rozszerzyć block_protected_columns_update o current_consent_version:
create or replace function public.block_protected_columns_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' then
    new.plan                    := old.plan;
    new.paddle_customer_id      := old.paddle_customer_id;
    new.current_consent_version := old.current_consent_version;  -- NEW
  end if;
  return new;
end;
$$;
```

Wtedy `current_consent_version` może być ustawiane wyłącznie przez `POST /api/consent` (z `service_role` lub przez SECURITY DEFINER funkcję).

**Opcja B:** Dodać CHECK constraint który weryfikuje że `current_consent_version` ma korespondujący wpis w `consent_log` (skomplikowane — wymaga subquery, nie wspierane przez prosty CHECK).

**Opcja C:** Polegać na konwencji aplikacji + monitoring (audyt zgód post-MVP).

**Rekomendacja:** Opcja A. Trigger jest tani, deterministyczny, omija problem race condition. Aktualizować `db-plan.md` § 1.2 (dodać `current_consent_version` do listy chronionych kolumn) i `api-plan.md` § 2.2 (usunąć `current_consent_version` z dozwolonych pól update; zostawić tylko `locale`).

---

### 2.5 `supabase/config.toml` `enable_confirmations = false` vs polityki `documents` wymagają `email_confirmed_at IS NOT NULL`

**Problem:**

`supabase/config.toml:42`:
```toml
[auth.email]
enable_confirmations = false
```

Migracja `documents_*_authenticated` polityki RLS:
```sql
exists (
  select 1 from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null
)
```

Architecture § 14 zakłada workflow z confirmations on:
> „1. supabase.auth.signUp({...}) ↓ sukces → sesja tymczasowa (email unverified, email_confirmed_at = NULL)"

**Stan rzeczywisty:** GoTrue (Supabase Auth) z `enable_confirmations = false` automatycznie ustawia `email_confirmed_at = now()` przy signUp — user dostaje sesję od razu i polityka RLS przepuści jego operacje na `documents`. Test funkcjonalny przejdzie.

**Konsekwencje:**
- Lokalny dev działa, ale dokumentacja architecture § 14 (która opisuje confirmations on jako workflow) wprowadza w błąd:
  - „sesja tymczasowa (email unverified, email_confirmed_at = NULL)" — w lokalnym dev to nie jest prawda.
  - „RLS na `documents` blokuje zapis przez `email_confirmed_at IS NOT NULL`" — w lokalnym dev nie blokuje (bo jest auto-confirmed).
- Implementator testów rejestracji + ochrony przed nadużyciem (PRD US-005 vs US-001) nie może lokalnie zweryfikować zachowania niepotwierdzonego konta.
- Produkcja wymaga `enable_confirmations = true` żeby polityka miała sens — ale plik produkcyjnej konfiguracji nie istnieje (brak osobnej `config.production.toml` lub instrukcji w docs jak to ustawić w Supabase Cloud).
- Dla nowych userów na produkcji bez podstawowej konfiguracji email provider (SMTP), confirmations on = blokada rejestracji dopóki SMTP nie jest skonfigurowane.

**Rozwiązanie:**

1. Dodać do `db-plan.md` § 5.13 (Kompatybilność ze stackiem) lub do nowej sekcji „Środowiska":
   ```markdown
   **Confirmations email:** lokalnie `enable_confirmations = false` (Inbucket
   nie wymagany do testów); produkcja **musi mieć** `enable_confirmations =
   true` w Supabase Cloud Auth Settings — inaczej polityka RLS dla `documents`
   wymagająca `email_confirmed_at IS NOT NULL` jest faktycznie bez efektu
   (auto-confirm bypass). Konfiguracja SMTP w Supabase Cloud konieczna przed
   pierwszym użytkownikiem produkcyjnym.
   ```

2. Dodać do architecture-base § 14 nakaz włączenia confirmations w prod:
   ```diff
   - 1. supabase.auth.signUp({ email, password })
   -    ↓ sukces → sesja tymczasowa (email unverified, email_confirmed_at = NULL)
   + 1. supabase.auth.signUp({ email, password })
   +    ↓ sukces → sesja (PROD: email unverified, email_confirmed_at = NULL;
   +              DEV z `enable_confirmations = false`: auto-confirmed)
   ```

3. Dodać do `.env.example` lub osobnego `supabase/config.production.example.toml` instrukcję:
   ```toml
   # PRODUKCJA (Supabase Cloud → Auth → Settings):
   # - Enable email confirmations = ON
   # - Confirm email change = ON
   # - SMTP custom provider = wymagane (np. Resend, Postmark)
   ```

**Rekomendacja:** dodanie powyższych dokumentacji + utworzenie issue „configure SMTP + email confirmations on Supabase Cloud" jako blocker pre-launch. Bez tego polityka „email_confirmed_at IS NOT NULL" daje fałszywe poczucie bezpieczeństwa.

---

### 2.6 (przeniesione z v3 § 2.1) `AllShapeGeometry = {}` scaffold — brak hard-stopu w CI gdy pierwszy kształt jest dodany

**Status:** Wciąż aktywne. Komentarz w `src/store/types.ts:5-9` jest poprawny:
```typescript
// SCAFFOLD: puste {} dopóki żaden kształt nie jest zaimplementowany.
// TODO: przy dodaniu pierwszego src/shapes/[typ]/ zastąpić scaffolda pełną intersectionem
// Zmiana jest BREAKING dla wszystkich call-sites commitShapeUpdate.
export type AllShapeGeometry = {};
```

**Problem dodatkowy:** żaden mechanizm CI/CD nie egzekwuje zmiany, gdy pierwszy kształt zostanie dodany. Implementator może:
1. Dodać `src/shapes/plate/` z `PlateShape`
2. Dodać wpis do `SHAPE_REGISTRY`
3. Zapomnieć zaktualizować `AllShapeGeometry` z `{}` na `Omit<PlateShape, 'id' | 'type'>`

`commitShapeUpdate(id, before, after)` przy `AllShapeGeometry = {}` przyjmuje **dowolny** obiekt jako `ShapeUpdate` (z wyjątkiem `type`). Bez bramki TS literówki w nazwach pól (`with` vs `width`) nie zostaną wychwycone.

**Rozwiązanie:** dodać proste sprawdzenie do `vitest` testu kontraktu:
```typescript
// tests/store/shape-update-contract.test.ts
import { SHAPE_REGISTRY } from '@/shapes/registry';
import type { AllShapeGeometry } from '@/store/types';

it('AllShapeGeometry musi być pełną intersectionem dla każdego zarejestrowanego kształtu', () => {
  const registered = Object.keys(SHAPE_REGISTRY).length;
  if (registered === 0) return; // scaffold OK
  // Sanity check: jeżeli SHAPE_REGISTRY ma >= 1 wpis, AllShapeGeometry NIE może być pustym {}
  type IsEmpty<T> = keyof T extends never ? true : false;
  const _isEmpty: IsEmpty<AllShapeGeometry> extends true ? never : true = true; // FAIL gdy {} + registered > 0
});
```

Albo prościej — komentarz w architecture-base § 19 (Dodanie nowego kształtu):
```diff
  4. `src/store/types.ts` — dodanie do `AllShapeGeometry`
+ 5. **Pierwszy kształt:** zastąpić `AllShapeGeometry = {}` pełną intersectionem
+    `Omit<PlateShape, 'id' | 'type'> & ...`. Jest to BREAKING change dla
+    `commitShapeUpdate` call-sites — bez tego wszystkie call-sites tracą
+    bezpieczeństwo typów.
```

**Rekomendacja:** opcja prostsza (komentarz w architecture-base § 19) — wystarczające ostrzeżenie pre-implementation.

---

## 3. 🟢 Drobne

### 3.1 (przeniesione z v3 § 3.4) `consent_log.ip_address: unknown` w generowanych typach

**Status:** wciąż aktywne. `src/types/database.ts:43`:
```typescript
ip_address: unknown
```

**Stan dokumentacji:** db-plan.md § 1.6 ma wzmiankę:
```
> Uwaga TypeScript: supabase gen types mapuje Postgres INET na unknown ...
> Przy implementacji /api/consent użyć wrappera ConsentLogRow.
```

Wrapper nie jest jednak utworzony — będzie dodany przy implementacji `/api/consent` (TODO odłożone).

**Brak zmiany od v3.** Akceptowalne — workaround udokumentowany.

---

### 3.2 `documentCodec.ts` opisany w architecture § 13 — brak pliku w `src/lib/`

**Problem:**

Architecture § 3 + § 13 referuje:
```
src/lib/documentCodec.ts ← serialize/deserialize sceny
```

`ls src/lib/`:
```
snapEngine.ts
supabase/
```

Brakuje `documentCodec.ts`, `captureGeometry.ts`, `shapeBounds.ts`, `exportEngine.ts`, `overlapDetector.ts`, `ipAnonymize.ts` — wszystkie wymienione w §3 directory tree.

**Konsekwencje:** żadne (pre-implementation), tylko adnotacja stanu.

**Rozwiązanie:** dodać do CLAUDE.md sekcji „Project state" listę faktycznie zaimplementowanych lib helperów:
```diff
- WelderDoc is a browser SaaS … The repo is in **post-bootstrap, pre-implementation** state: scaffolding, configs, and `.ai/` design docs are in place, but most files under `src/` (shapes, store slices, components, libs) are empty placeholders.
+ WelderDoc is a browser SaaS … The repo is in **post-bootstrap, pre-implementation** state: scaffolding, configs, and `.ai/` design docs are in place, but most files under `src/` (shapes, store slices, components, libs) are empty placeholders. **Currently implemented in `src/lib/`:** `snapEngine.ts` (stub with pure-function signatures), `supabase/{client,server,middleware}.ts`. Architecture § 3 lists future helpers (`documentCodec.ts`, `captureGeometry.ts`, `shapeBounds.ts`, `exportEngine.ts`, `overlapDetector.ts`, `ipAnonymize.ts`) — none implemented yet.
```

**Rekomendacja:** opcjonalne — większość referencji jest w architecture-base, które jest spec'em a nie inwentarzem stanu.

---

### 3.3 `e2e/smoke.spec.ts` — kruchy selektor heading bez i18n awareness

**Problem:**

`e2e/smoke.spec.ts`:
```typescript
test('homepage renders the WelderDoc title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'WelderDoc' })).toBeVisible();
});
```

Tłumaczenie pl: `"title": "WelderDoc"` — heading zgodny.
Tłumaczenie en: `"title": "WelderDoc"` — heading zgodny.

**Stan ok dla MVP**, ale:
- Test nie sprawdza która lokalizacja (PL/EN) jest aktywna.
- `localePrefix: 'as-needed'` + brak prefiksu = locale `pl` (wg routing.ts:6).
- `page.goto('/')` redirects do `/` (default `pl`); jeżeli kiedyś heading dla `pl` zmieni się na „WelderDoc" + ikona albo coś, test złapie problem ale nie wyjaśni że to z powodu lokalizacji.

**Konsekwencje:** brak (smoke test wystarczająco trywialny).

**Rozwiązanie:** akceptowalne. Notatka informacyjna; rozszerzyć test po implementacji pierwszej feature (US-018 dodawanie plate).

---

### 3.4 `tests/smoke.test.ts` zawiera test `vitest-canvas-mock` ale Vitest nie ma `vitest-canvas-mock` w setupie powiązanego z konkretnym testem

**Problem:**

`tests/smoke.test.ts:14-18`:
```typescript
it('has canvas mock available', () => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  expect(ctx).not.toBeNull();
});
```

`vitest.setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
import 'vitest-canvas-mock';
```

`vitest-canvas-mock` jest zarejestrowane globalnie. Test sprawdza tylko, że `getContext('2d')` zwraca cokolwiek (≠ null). To przejdzie nawet bez `vitest-canvas-mock` (jsdom dostarcza minimalny stub `getContext` zwracający `null` dla niewspieranych typów, ale dla 2D od jakiegoś czasu zwraca minimalny obiekt). Test może być fałszywie zielony nawet gdy mock jest niezarejestrowany.

**Rozwiązanie (opcjonalne):** zmienić assertion na coś weryfikującego specyficzne API mock'a:
```typescript
it('has canvas mock available', () => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  expect(ctx).not.toBeNull();
  // vitest-canvas-mock instaluje __getEvents() / __clearEvents() na ctx
  expect(typeof (ctx as any).__getEvents).toBe('function');
});
```

**Rekomendacja:** odłożyć do momentu, gdy testy Konvy faktycznie zaczną używać canvas mock. Aktualny test jest „smoke" i nie blokuje niczego.

---

### 3.5 `package.json scripts` brakuje `pnpm supabase:start` / `pnpm supabase:reset` — CLAUDE.md mentions ale nie ma w `package.json`

**Problem:**

CLAUDE.md sekcja „Commands":
```bash
pnpm supabase start           # local Postgres + Auth + Studio (requires Docker)
pnpm supabase db reset        # destructive: re-apply migrations from supabase/migrations/
```

`package.json scripts` zawiera tylko `supabase:types`. Komendy `supabase start` / `supabase db reset` działają jednak przez `pnpm dlx supabase ...` lub jeśli jest globalny CLI; `pnpm supabase ...` wymaga, żeby `supabase` był skryptem w `package.json` lub bin'em w `node_modules/.bin/`.

W rzeczywistości — `supabase` package nie jest w `dependencies` ani `devDependencies`. Komenda `pnpm supabase start` zadziała tylko jeśli user ma `supabase` zainstalowane globalnie (Homebrew, npm -g) lub korzysta z `npx supabase`.

**Konsekwencje:**
- Nowy developer kopiuje komendy z CLAUDE.md, dostaje błąd „supabase: command not found".
- W repo brak `supabase` w devDependencies — musi być zainstalowany globalnie albo przez `pnpm dlx`.

**Rozwiązanie — wybór:**

**Opcja A:** Dodać `supabase` do `devDependencies`:
```bash
pnpm add -D supabase
```
Wtedy `pnpm supabase start` zadziała przez `node_modules/.bin/supabase`.

**Opcja B:** Zaktualizować CLAUDE.md i wszystkie docs:
```bash
- pnpm supabase start
+ npx supabase start    # lub pnpm dlx supabase start
```

**Rekomendacja:** Opcja A. Nieprzewidywalność globalnej instalacji supabase CLI (różne wersje na różnych machinach) jest podatna na desync z migracjami. Lokalna instalacja w devDependencies pinuje wersję CLI razem z resztą stacku.

---

### 3.6 `tests/` directory listed jako oddzielny od `src/`, ale vitest skanuje też `src/**/*.{test,spec}.{ts,tsx}`

**Problem:**

Architecture § 3:
```
tests/    ← Vitest unit/integration (poza src/)
e2e/      ← Playwright e2e + visual regression
```

`vitest.config.ts:12`:
```typescript
include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}']
```

Test może być w `src/lib/snapEngine.test.ts` lub `tests/snap.test.ts` — oba zostaną podniesione. Architecture sugeruje że tests żyją wyłącznie w `tests/`, ale `vitest.config.ts` pozwala na co-location w `src/`.

**Konsekwencje:** brak błędu, ale niespójny styl. CLAUDE.md sekcja Commands zawiera „Run a single Vitest test: `pnpm test:run path/to/file.test.ts`" — nie precyzuje konwencji (co-location czy oddzielny).

**Rozwiązanie:** wybrać jedno:

**Opcja A:** Usunąć `src/**/*.{test,spec}.{ts,tsx}` z `vitest.config.ts include` i wymóc co-location off:
```diff
- include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
+ include: ['tests/**/*.{test,spec}.{ts,tsx}'],
```

**Opcja B:** Pozwolić na obie konwencje, doprecyzować architecture § 3:
```diff
- tests/    ← Vitest unit/integration (poza src/)
+ tests/    ← Vitest unit/integration; pojedyncze testy mogą być co-locowane w src/
```

**Rekomendacja:** Opcja B — co-location w `src/` jest często wygodniejsze dla testów unit (`src/lib/snapEngine.test.ts` obok `src/lib/snapEngine.ts`). `tests/` rezerwowane dla integration / cross-module.

---

## 4. Rekomendacje priorytetowe (lista działań)

### Przed startem implementacji Route Handlerów (ASAP):
1. 🔴 **§1.1** — zsynchronizować `api-plan.md` `POST /api/cron/*` → `GET /api/cron/*` w 5 miejscach. Bez tego cron handlery będą napisane z `export async function POST(...)` i Vercel Cron uderzy w 405.
2. 🔴 **§1.2** — wybrać jeden kontrakt `/api/consent` (rekomendacja: bundle z `architecture-base.md` § 14) i zsynchronizować `api-plan.md` § 2.1 + § 2.2.
3. 🟡 **§2.2** — zaktualizować `api-plan.md` § 2.1 logikę `/api/consent`: usunąć rekomendację `service_role` (wystarczy authenticated client + RLS).
4. 🟡 **§2.4** — dodać `current_consent_version` do `block_protected_columns_update` triggera (nowa migracja); zaktualizować `db-plan.md` § 1.2 i `api-plan.md` § 2.2.

### Przed pierwszym push do `main` (production deploy guardrail):
5. 🔴 **§1.3** — dodać do CLAUDE.md PR checklistę dla wszystkich brakujących route handlerów (cron + paddle/webhook + consent + user/export). Rozważyć skrypt CI weryfikujący pokrycie `vercel.json.crons[]`.

### Przed pierwszym deployem produkcyjnym:
6. 🟡 **§2.5** — udokumentować różnicę dev/prod dla `enable_confirmations`; utworzyć issue „configure SMTP + email confirmations on Supabase Cloud".

### Przy implementacji pierwszego kształtu:
7. 🟡 **§2.6** — zaktualizować `architecture-base.md` § 19 (Dodanie nowego kształtu) o BREAKING change scaffolda `AllShapeGeometry = {}` → pełna intersection.

### W dowolnym momencie (drobne / opcjonalne):
8. 🟡 **§2.1** — zsynchronizować `tsconfig.json "jsx"` z tech-stack.md (zalecane: `"preserve"` w obu).
9. 🟡 **§2.3** — wybrać między pojedynczą `FOR ALL` (db-plan) a 4 osobnymi politykami (migracja); ujednolicić.
10. 🟢 **§3.1** — wrapper `ConsentLogRow` przy implementacji `/api/consent` (już zaplanowane w db-plan).
11. 🟢 **§3.2** — zaktualizować CLAUDE.md sekcji „Project state" o aktualną listę zaimplementowanych helperów.
12. 🟢 **§3.3** — rozszerzyć smoke e2e o weryfikację locale (po implementacji pierwszej feature).
13. 🟢 **§3.4** — wzmocnić assertion vitest-canvas-mock (po pierwszej implementacji testu Konvy).
14. 🟢 **§3.5** — dodać `supabase` do `devDependencies` (lokalne pinowanie wersji CLI).
15. 🟢 **§3.6** — doprecyzować `architecture-base.md` § 3 nt. co-location testów.

---

## 5. Podsumowanie

**Stan dokumentacji vs kod:** poprzednia iteracja (v3) naprawiła 11 z 14 zidentyfikowanych problemów — duża dyscyplina utrzymania spójności. Pozostałe 3 problemy v3 to świadome scaffoldy z poprawnymi komentarzami TODO.

**Główne ryzyka v4:**

1. **`api-plan.md` jako third source of truth** — dokument zawiera najszczegółowsze kontrakty endpointów, ale jest desynchronizowany z `architecture-base.md` (cron HTTP method) i `db-plan.md` (`/api/consent` payload, użycie service_role). Implementator zaczynający od api-plan napotka 3 niezgodności jeszcze przed napisaniem pierwszej linii kodu route handlera.

2. **Brak fizycznych route handlerów** — `vercel.json` deklaruje 2 crony, dokumentacja deklaruje 5 endpointów, repo ma 1 (`/api/health`). Pierwszy deploy produkcyjny **wymaga** uzupełnienia minimum cron handlerów + Paddle webhook + consent. Bez automatycznego sprawdzenia w CI ryzyko zapomnienia jest wysokie.

3. **Niespójność prod vs dev w obszarze auth** — `enable_confirmations = false` lokalnie maskuje problem RLS `email_confirmed_at IS NOT NULL`. Bez konfiguracji SMTP w Supabase Cloud + włączenia confirmations, polityka RLS w produkcji jest faktycznie bez efektu.

**Filtr „przed implementacją kształtów":** nic z analizy v4 nie blokuje startu implementacji domeny shapes. Wszystkie krytyczne problemy dotyczą warstwy API/auth/cron, które są implementowane równolegle z formularzami auth i UI subskrypcji — nie z kanwą.

**Filtr „przed pierwszym deployem":** punkty 1, 2, 3, 5, 6 z listy działań.