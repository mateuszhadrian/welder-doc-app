# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v5)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 5.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/db-supabase-migrations.md`, `.ai/code-documentation-problems-v4.md`, kod w `src/`, `supabase/migrations/20260507000000_complete_schema.sql`, `supabase/config.toml`, `vercel.json`, `tsconfig.json`, `package.json`, `CLAUDE.md`, `README.md`.
>
> **Stan projektu (2026-05-08):** post-bootstrap, pre-implementation. Pliki w `src/` to szkielety z komentarzami-wytycznymi; jedynymi w pełni działającymi wycinkami runtime są: warstwa abstrakcji `src/canvas-kit/` (wraz z `impl-konva/`), `src/i18n/`, `src/lib/supabase/{client,server,middleware}.ts`, `src/lib/snapEngine.ts` (stuby pure-functions), `src/proxy.ts` oraz `src/app/api/health/route.ts`. Logika domeny (shapes, weld-units, store slices, components) nie istnieje.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, powodujący błąd produkcyjny lub silnie wprowadzający w błąd implementatora.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru.
> - 🟢 **Drobne** — niespójności, kosmetyczne, niska pilność.

---

## 0. Status problemów z v4

| # v4 | Tytuł | Status (v5) | Komentarz |
|---|---|---|---|
| 1.1 | `api-plan.md` POST → GET dla cronów | ✅ **Naprawione** | `api-plan.md` §2.1 (linie 285, 326) jawnie deklaruje `GET` z notą „Vercel Cron domyślnie wysyła GET". Tabele §3 (linie 868–869) używają `GET /api/cron/*`. |
| 1.2 | Niespójny kontrakt `/api/consent` (per-type vs bundle) | ✅ **Naprawione** | `api-plan.md` §2.1 (linia 116–122) używa bundle `types: [...]`; per-type wyłącznie dla wycofania zgody. Synchronizacja z `architecture-base.md` §14 wykonana. |
| 1.3 | Brak Route Handlerów (cron + paddle webhook + consent + user/export) | 🔴 **Wciąż aktywne** | Tylko `src/app/api/health/route.ts` istnieje. Patrz nowy §1.1. |
| 2.1 | `tsconfig.json "jsx": "react-jsx"` vs spec `"preserve"` | ✅ **Naprawione** | `tsconfig.json:7` ma `"jsx": "preserve"`. |
| 2.2 | `/api/consent` nie wymaga `service_role` dla INSERT | ✅ **Naprawione** | `api-plan.md` §2.1 punkt 6 (linia 186) używa `createServerClient` dla INSERT do `consent_log`. `service_role` używane tylko przy zapisie `current_consent_version`. |
| 2.3 | 4 osobne polityki `documents_*` w migracji vs `FOR ALL` w db-plan | ✅ **Naprawione** | Migracja linia 454 ma pojedynczą `documents_owner_all FOR ALL` zgodną z db-plan §4.2. |
| 2.4 | `current_consent_version` modyfikowalna z `authenticated` | ✅ **Naprawione** | `block_protected_columns_update()` (migracja linia 311–325) chroni również `current_consent_version`. db-plan §1.2 i `api-plan.md` §2.2 (linia 710) zaktualizowane. |
| 2.5 | Dev `enable_confirmations = false` vs prod RLS `email_confirmed_at IS NOT NULL` | ✅ **Naprawione** | `db-plan.md` §5.13a oraz `architecture-base.md` §14 dokumentują różnicę dev/prod oraz wymóg włączenia confirmations + SMTP w Supabase Cloud. |
| 2.6 | `AllShapeGeometry = {}` scaffold — brak hard-stopu w CI | 🟡 **Wciąż aktywne (świadome)** | `src/store/types.ts:11` wciąż `= {}`. Komentarz `architecture-base.md` §19 ma ostrzeżenie BREAKING change, ale nadal brak automatycznej bramki — patrz §2.6 niżej. |
| 3.1 | `consent_log.ip_address: unknown` w generowanych typach | 🟢 **Wciąż aktywne (workaround udokumentowany)** | `src/types/database.ts:43` ma `ip_address: unknown`. Wrapper `ConsentLogRow` zaplanowany w db-plan §1.6. |
| 3.2 | `documentCodec.ts` itp. brakujące w `src/lib/` | ✅ **Naprawione w CLAUDE.md** | CLAUDE.md sekcja „Project state" wymienia faktycznie zaimplementowane helpery i listę TODO z architecture §3. |
| 3.3 | E2E smoke heading bez i18n awareness | 🟢 **Wciąż OK** | Akceptowalne dla MVP (oba locales mają identyczny `title`). |
| 3.4 | `vitest-canvas-mock` weak assertion | 🟢 **Wciąż OK** | Smoke test akceptowalny do pierwszej implementacji testu Konvy. |
| 3.5 | Brak `supabase` w `devDependencies` | ✅ **Naprawione** | `package.json:68` ma `supabase@^2.0.0` w devDependencies; `tech-stack.md` §15 wyjaśnia decyzję. |
| 3.6 | Test co-location vs `tests/` directory | 🟢 **Wciąż otwarte** | `vitest.config.ts:12` pozwala na oba wzorce; `architecture-base.md` §3 nie zostało jeszcze doprecyzowane. |

**Wniosek:** 9 z 14 problemów v4 zostało naprawionych. Pozostałe 5 to świadome scaffoldy (2.6, 3.1) lub akceptowalne stan pre-implementation (1.3, 3.3, 3.4, 3.6 — wciąż otwarte do decyzji w §3.4 niżej).

Poniżej: **nowe problemy** zidentyfikowane przy v5 oraz przeniesione aktywne z v4.

---

## 1. 🔴 Krytyczne

### 1.1 (przeniesione z v4 §1.3, niezmienione) Brak Route Handlerów: cron × 2 + Paddle webhook + consent + user/export

**Status:** wciąż aktywne, niezmienione od v4.

**Stan obecny `src/app/api/`:**
```
src/app/api/health/route.ts    ← jedyny istniejący
```

**Brakujące pliki (z `api-plan.md` §2.1):**

| Endpoint | HTTP | Kluczowy ryzyko, gdy brak |
|---|---|---|
| `src/app/api/cron/expire-subscriptions/route.ts` | `GET` | Brak downgrade'u planów po grace period (`refresh_expired_plans()`) — Pro użytkownicy z wygasłą subskrypcją zostają na Pro w nieskończoność. |
| `src/app/api/cron/cleanup-webhook-events/route.ts` | `GET` | `webhook_events` rośnie bez limitu (retencja 90 dni nieegzekwowana). |
| `src/app/api/paddle/webhook/route.ts` | `POST` | `subscription.activated` events drop, US-045 upgrade silently fails (klient zapłacił, plan nie zmieniony). |
| `src/app/api/consent/route.ts` | `POST` | US-001 nie działa, RODO art. 7 ust. 1 audyt nie generuje wpisów. |
| `src/app/api/user/export/route.ts` | `GET` | RODO art. 20 niespełnione — blocker pre-launch. |

**CLAUDE.md sekcja „Workflow guardrails" (linie 64–73)** już zawiera PR checklistę dla wszystkich pięciu route handlerów, ale checklista jest **manualna** — nie ma automatycznej bramki w CI.

**Rekomendacja (niezmieniona od v4):** dodać do `.github/workflows/ci.yml` step weryfikujący pokrycie `vercel.json.crons[].path` i istnienie `paddle/webhook` + `consent` + `user/export`:

```bash
# scripts/verify-routes.sh
#!/usr/bin/env bash
set -euo pipefail

# 1. Crony: każda ścieżka z vercel.json musi mieć route.ts
node -e '
const cfg = require("./vercel.json");
const fs  = require("fs");
const missing = (cfg.crons ?? []).filter((c) => !fs.existsSync(`./src/app${c.path}/route.ts`));
if (missing.length) { console.error("Missing cron routes:", missing); process.exit(1); }
'

# 2. Paddle webhook: jeśli @paddle/paddle-js w deps → route.ts musi istnieć
node -e '
const pkg = require("./package.json");
if ((pkg.dependencies ?? {})["@paddle/paddle-js"]
  && !require("fs").existsSync("./src/app/api/paddle/webhook/route.ts")) {
  console.error("Missing /api/paddle/webhook/route.ts (Paddle Checkout in deps)"); process.exit(1);
}
'
# (analogicznie dla consent + user/export)
```

Skrypt wywoływany jako `pnpm verify:routes` w job `lint-and-typecheck`. Hard-stop merge zamiast polegania na ludzkiej checkliście.

---

### 1.2 (NOWY) `/api/health` implementation diverges from `api-plan.md` §2.1 contract

**Problem:**

`api-plan.md` §2.1 (linie 254–277) deklaruje kontrakt:

```json
// 200 OK
{ "status": "ok", "timestamp": "2026-05-08T12:00:00Z" }

// 503 Service Unavailable (problem z DB)
{
  "status": "degraded",
  "timestamp": "2026-05-08T12:00:00Z",
  "checks": { "database": "unreachable" }
}
```

`src/app/api/health/route.ts` (cała implementacja):

```typescript
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  const { error } = await supabase.from('user_profiles').select('count').limit(0);
  return NextResponse.json({ ok: !error, error: error?.message ?? null });
}
```

**Niezgodności:**

1. **Kształt odpowiedzi:** `{ ok, error }` vs spec `{ status, timestamp, checks? }`. Brak `timestamp`, brak `status` literal, brak rozróżnienia 200 vs 503.
2. **Status code:** zawsze zwraca 200 nawet przy błędzie DB. Spec wymaga 503 przy `database: unreachable`.
3. **Wyciek wewnętrznego błędu:** pole `error: error?.message` może zwrócić publicznie wewnętrzny opis błędu Postgresa (PII / topology leak). Spec celowo używa generycznego `"unreachable"`.
4. **Wybór tabeli:** `select('count')` na `user_profiles` z nieuwierzytelnionej sesji — RLS odfiltruje wszystkie wiersze (bo `auth.uid() IS NULL`), ale **zapytanie się powiedzie** (zwróci 0 wierszy bez błędu). Health check nie wykryje, że RLS jest źle skonfigurowane — jedynie czy jest jakiekolwiek połączenie z PostgREST.

**Konsekwencje:**

- Każdy konsument health check'a (Vercel deploy check, monitoring zewnętrzny, smoke test) napisany według `api-plan.md` zobaczy nieoczekiwany kształt odpowiedzi → integracja zepsuta.
- Brak rozróżnienia 200/503 oznacza, że Vercel nie wykryje degradacji DB jako failed deployment.
- `error.message` w odpowiedzi może wyciec szczegóły topologii (np. nazwy schematów, czas połączenia) do logów monitoringu — niepotrzebny attack surface.

**Rozwiązanie:** zaktualizować `src/app/api/health/route.ts` zgodnie ze spec'em:

```typescript
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const timestamp = new Date().toISOString();
  const supabase = await createClient();

  // SELECT 1 z `auth.users` przez RLS-bezpieczny RPC lub po prostu pingu PostgREST.
  // Najprościej: HEAD na endpoint `documents` (zwraca 200 lub błąd warstwy sieci).
  const { error } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .limit(0);

  if (error) {
    return NextResponse.json(
      { status: 'degraded', timestamp, checks: { database: 'unreachable' } },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: 'ok', timestamp });
}
```

Uwaga: nie zwracać `error.message` w body — to PII / topology leak.

**Rekomendacja:** wykonać poprawkę w obecnej iteracji (jednostronicowa zmiana). Opcjonalnie dodać Vitest unit test dla shape'u odpowiedzi (mock `createClient` zwracający `{ error: { message: 'fail' } }`); coverage thresholds dla `src/app/**` nie są ustawione (vitest.config.ts include obejmuje tylko `src/lib/**`, `src/shapes/**`, `src/weld-units/**`, `src/store/**`), więc test nie blokuje CI, ale jest tani.

---

## 2. 🟡 Istotne

### 2.1 (NOWY) `db-supabase-migrations.md` reguła generalna sprzeczna z `db-plan.md` §4.2 i kształtem migracji

**Problem:**

Plik `.ai/db-supabase-migrations.md` (dodany do repo, niedatowany ale traktowany jako directive dla AI generującego migracje) zawiera (linia 41):

> „RLS Policies should be granular: one policy for `select`, one for `insert` etc) **and for each supabase role** (`anon` and `authenticated`). **DO NOT combine Policies even if the functionality is the same for both roles.**"

To jest **wprost sprzeczne** z faktycznym stanem migracji `20260507000000_complete_schema.sql:454` oraz dokumentacji `db-plan.md` §4.2 (linie 209–225):

```sql
-- migracja (line 454):
create policy documents_owner_all
  on public.documents
  for all                      -- ← jedna polityka, cztery operacje
  to authenticated
  using (...)
  with check (...);
```

`db-plan.md` §4.2 jawnie używa `FOR ALL` z komentarzem (przeniesiony z naprawy v4 §2.3): „single FOR ALL policy (db-plan §4.2): one source of truth for the membership rule; splitting into 4 per-operation policies would duplicate the body and make the rule prone to desync on future edits".

**Konsekwencje:**

- Następna migracja generowana po regułach z `db-supabase-migrations.md` (przez AI lub developera) doda 4 osobne polityki na dowolnej nowej tabeli, łamiąc ustaloną w v4 konwencję.
- Spór między „guideline" (granular per-operation per-role) a „spec" (db-plan, FOR ALL gdzie sensowne) → niespójna baza polityk RLS w długiej perspektywie.
- Rule w `db-supabase-migrations.md` ma sens dla tabel z **różnymi** politykami per-rola (anon vs authenticated) lub per-operacja (np. SELECT publiczny + INSERT prywatny). Dla `documents` — gdzie każda operacja ma identyczny `USING/WITH CHECK` body i jedyny dozwolony rola to `authenticated` — granularny split jest czystą duplikacją.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** doprecyzować regułę w `db-supabase-migrations.md` — granular **gdy** body lub rola się różnią; `FOR ALL` dozwolone gdy identyczne USING + WITH CHECK dla wszystkich operacji jednej roli:

```diff
  - RLS Policies should be granular: one policy for `select`, one for `insert` etc)
    and for each supabase role (`anon` and `authenticated`). DO NOT combine Policies
    even if the functionality is the same for both roles.
+ - RLS Policies should be granular per Supabase role (`anon` vs `authenticated`)
+   — never combine policies across roles. Within a single role, prefer
+   `FOR ALL` when the USING and WITH CHECK clauses are identical for every
+   operation (e.g. `documents_owner_all` in db-plan §4.2). Split into per-operation
+   policies (`select`, `insert`, `update`, `delete`) only when the predicate
+   differs (e.g. allow public SELECT but only owner INSERT/UPDATE/DELETE).
```

**Opcja B:** zostawić regułę „granular" jako-jest i przepisać migrację `documents` na 4 polityki + zaktualizować db-plan §4.2.

**Rekomendacja:** Opcja A. Stan ustalony w v4 (jedna polityka FOR ALL dla `documents`) jest bardziej idiomatyczny dla Postgresa, redukuje duplikację i ułatwia audyt. Reguła „granular per-operation" pochodzi z generycznego template'u Supabase i nie zawsze jest właściwa — wymaga uzupełnienia o klauzulę „identical body".

---

### 2.2 (NOWY) `tech-stack.md` §13 opis `SUPABASE_SERVICE_ROLE_KEY` jest nieaktualny

**Problem:**

`tech-stack.md:284`:

| Nazwa | Scope | Notatka |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Wyłącznie w `app/api/paddle/webhook/route.ts` |

Ale w istocie service_role jest używany w czterech miejscach po implementacji:

1. `app/api/paddle/webhook/route.ts` — webhook upsert do `subscriptions` (RLS zabrania mutacji z `authenticated`).
2. `app/api/cron/expire-subscriptions/route.ts` — wywołanie `refresh_expired_plans()` (cron działa bez sesji JWT).
3. `app/api/cron/cleanup-webhook-events/route.ts` — DELETE z `webhook_events` (RLS zabrania jakiegokolwiek dostępu — tylko service_role).
4. `app/api/consent/route.ts` — wyłącznie do UPDATE `user_profiles.current_consent_version` po pomyślnym bundle insert (kolumna chroniona triggerem dla non-service_role).

`api-plan.md` §3 (linia 869) tabela poziomów dostępu prawidłowo wymienia `POST /api/paddle/webhook` + `GET /api/cron/*` jako service_role. `api-plan.md` §2.1 (linia 187) dodatkowo dokumentuje precyzyjne wąskie użycie service_role w `/api/consent`.

`src/lib/supabase/server.ts:44` eksportuje `createAdminClient()` jako reuse-able helper — nie ma żadnej restrykcji wskazującej, że jest tylko dla webhooka Paddle.

**Konsekwencje:**

- Implementator route handlera dla `cron/expire-subscriptions` zajrzy do `tech-stack.md` §13 i zobaczy „wyłącznie w `app/api/paddle/webhook/route.ts`". Może błędnie wniosek, że nie powinien używać service_role — i napisze handler bez weryfikacji `CRON_SECRET`/bez service_role, polegając na anon key (które nie ma uprawnień do `webhook_events.delete()`).
- Niespójność „source of truth" między `tech-stack.md` (one-liner) a `api-plan.md` (lista użyć).

**Rozwiązanie:** zaktualizować `tech-stack.md` §13:

```diff
- | `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Wyłącznie w `app/api/paddle/webhook/route.ts` |
+ | `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Server-only operations bypassing RLS:
+   `app/api/paddle/webhook/route.ts` (subscriptions upsert),
+   `app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts`
+   (no JWT context), oraz `app/api/consent/route.ts` (bundle UPDATE
+   `current_consent_version` po INSERT do consent_log). Nigdy w client/Server
+   Component. Helper: `createAdminClient()` z `src/lib/supabase/server.ts`. |
```

**Rekomendacja:** drobna poprawka, ale przed implementacją cron handlerów. Bez tego pierwsza implementacja prawdopodobnie minie się ze spec'em.

---

### 2.3 (NOWY) `pnpm supabase:types` używa `$SUPABASE_PROJECT_ID` ale skrypty pnpm nie auto-ładują `.env.local`

**Problem:**

`package.json:20`:

```json
"supabase:types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts"
```

`.env.example:13`:
```
SUPABASE_PROJECT_ID=
```

`tech-stack.md` §13 (linia 290): `SUPABASE_PROJECT_ID` zadeklarowane w sekcji „CI/CD".

**Pułapka:** `pnpm` (jak `npm`/`yarn`) **nie** auto-ładuje `.env.local` ani `.env` przy uruchamianiu skryptów. Zmienne środowiskowe pochodzą z bieżącej powłoki. Next.js auto-ładuje `.env.local` dla `pnpm dev`/`pnpm build`, ale to jest szczególna funkcja Next.js — **nie** efekt pnpm.

W rezultacie:
```bash
$ pnpm supabase:types
> supabase gen types typescript --project-id  --schema public > src/types/database.ts
                                            ^^ pusty (--project-id bez wartości)
Error: Project ID is required
```

Lokalnie developer musi mieć `SUPABASE_PROJECT_ID` w `~/.zshrc` / `~/.bashrc` lub eksportować ad-hoc:

```bash
$ export SUPABASE_PROJECT_ID=abcdef && pnpm supabase:types
```

Albo użyć narzędzia jak `dotenv-cli`:
```bash
$ pnpm dlx dotenv-cli -e .env.local -- pnpm supabase:types
```

**Konsekwencje:**

- `tech-stack.md` §13 i `CLAUDE.md` „Commands" sugerują, że `pnpm supabase:types` jest gotową komendą — w istocie wymaga preconfig powłoki / sourcing'u.
- W CI (GitHub Actions) zmienne secret są dostępne jako env vars → `pnpm supabase:types` działa bez problemów. Lokalna pułapka jest cicha.

**Rozwiązanie — wybór:**

**Opcja A:** Dodać `dotenv-cli` do `devDependencies` i zmienić skrypt:
```diff
- "supabase:types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts"
+ "supabase:types": "dotenv -e .env.local -- supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts"
```
Plus pozwala fallback na shell env (gdy `.env.local` nie istnieje, `dotenv-cli` po prostu nie nadpisuje).

**Opcja B:** Dodać notę do `tech-stack.md` §14 (Skrypty) lub `CLAUDE.md` „Commands":

```diff
  pnpm supabase:types           # regenerate src/types/database.ts (requires SUPABASE_PROJECT_ID env var)
+                               # locally: source .env.local first
+                               # (pnpm scripts don't auto-load .env files —
+                               # only `next` does, and only for dev/build)
```

**Rekomendacja:** Opcja A. Niska bariera wejścia (jeden devDep), eliminuje cichy failure mode. Naturalnie rozszerzalne na inne CLI scripts wymagające env vars (np. po dodaniu Paddle CLI).

---

### 2.4 (NOWY) `proxy.ts` matcher wyklucza `/api`, ale Route Handlery odwołują się do Supabase

**Problem:**

`src/proxy.ts:32-37`:

```typescript
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)'
  ]
};
```

Negatywna lookahead `?!api` oznacza, że **proxy nie uruchamia się dla `/api/*`**. To jest standard Next.js (Route Handlery same zarządzają sesją), ale w naszej architekturze `proxy.ts` wykonuje `updateSession()` (refresh JWT przez `@supabase/ssr`).

`architecture-base.md` §16 (linia 1233):
> „Middleware: `src/proxy.ts` (nie standardowa `middleware.ts`) eksportuje `proxy` i `config`. Łańcuch wywołań: `updateSession()` (Supabase `@supabase/ssr`) → `next-intl` middleware. Kolejność jest obowiązkowa — Supabase musi odświeżyć token przed routingiem locale."

`src/lib/supabase/middleware.ts:32-34`:
> „getUser() musi być wywołane na każdym żądaniu — odświeża token JWT i waliduje sesję po stronie serwera. Pominięcie = losowe wylogowania."

**Pytanie projektowe:** czy Route Handlery (`/api/consent`, `/api/user/export`, `/api/health`) **muszą** dostać świeży token z proxy?

**Aktualny stan w kodzie:**
- `src/lib/supabase/server.ts:6-30` (`createClient()`) używany przez Route Handlery sam wywołuje `getUser()` przy first request — `@supabase/ssr` umieszcza handler `cookies.setAll` który ustawia odświeżone cookie tokens na response. Route Handlery mogą mutować cookies w response (w przeciwieństwie do Server Components), więc refresh działa lokalnie per-request.
- Dla `/api/health` brak weryfikacji sesji — nie ma znaczenia.
- Dla `/api/consent`, `/api/user/export` — pierwszy `auth.getUser()` w handlerze sam zrobi refresh jeśli token wygasł.

**Wniosek:** w praktyce Route Handlery działają poprawnie, **ale** kosztem dodatkowego round-tripu refresh per Route Handler call (zamiast jednego globalnego refresh w proxy). Architektura, którą zalecała `architecture-base.md` §16 („Supabase musi odświeżyć token przed routingiem"), nie jest egzekwowana dla `/api/*`.

**Konsekwencje:**

1. **Performance:** każde wywołanie route handlera, które sięga po sesję, wykona własny refresh — przy concurrent requests klient może uzyskać kilka odświeżeń tego samego tokena (Supabase ssr ma debouncing, ale nie eliminuje round-trip per first-request).
2. **Spójność architektury:** `architecture-base.md` opisuje proxy jako globalny refresher, ale `/api/*` nie pasuje do tego modelu — implementator nie wiedząc o tym szczególe może spodziewać się, że w handlerze `request.headers.cookie` zawiera świeży token (a zawiera ten z poprzedniej sesji, dopóki handler sam nie wywoła `getUser`).
3. **Brak refresh dla `/api/health`:** nieautoryzowany endpoint, więc nieistotne.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** zaktualizować `architecture-base.md` §16, aby jawnie odnotować, że Route Handlery są wyłączone z proxy i muszą same robić refresh:

```diff
+ **Wyłączenie `/api/*` z proxy matchera (`?!api`):** Route Handlery nie
+ przechodzą przez `updateSession()` w `proxy.ts`. Odświeżenie tokenu odbywa
+ się per-request wewnątrz handlera przy pierwszym wywołaniu
+ `supabase.auth.getUser()` (klient `createServerClient` z `@supabase/ssr`
+ rejestruje handler `cookies.setAll` zapisujący odświeżone tokeny do
+ `Response` cookies). Konsekwencja: route handlery wymagające sesji muszą
+ wywołać `auth.getUser()` PRZED dowolną operacją na danych użytkownika
+ (inaczej operują na potencjalnie wygasłym tokenie).
```

**Opcja B:** rozszerzyć matcher, aby objąć `/api/(consent|user|paddle)/*` (z wyłączeniem health, cron):
```diff
- '/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)'
+ '/((?!api/(?:health|cron)|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)'
```
Ale to dodaje proxy overhead na każde wywołanie tych route handlerów + wymaga osobnego case dla webhook (Paddle nie ma cookies).

**Rekomendacja:** Opcja A. Status quo działa poprawnie; problem jest dokumentacyjny, nie funkcjonalny. Doprecyzować architecture-base, by przyszli implementatorzy nie polegali na nieistniejącej semantyce „token jest świeży na wejściu route handlera".

---

### 2.5 (NOWY) `proxy.ts` cookie-copy może gubić opcje cookie nieobecne w `ResponseCookie.getAll()`

**Problem:**

`src/proxy.ts:23-25`:

```typescript
supabaseResponse.cookies.getAll().forEach(({ name, value, ...options }) => {
  intlResponse.cookies.set(name, value, options);
});
```

Komentarz wyżej (linie 11–14) słusznie tłumaczy, dlaczego cookies muszą być skopiowane na response z `intl`. Ale destrukturyzacja `{ name, value, ...options }` zakłada, że `getAll()` zwraca obiekt z polami `name`, `value`, oraz polami opcji (`expires`, `domain`, `httpOnly`, `secure`, `sameSite`, `path`, `maxAge`, `priority`).

W Next.js typing, `ResponseCookie` (zwracany z `NextResponse.cookies.getAll()`) ma kontrakt:
```typescript
interface ResponseCookie {
  name: string;
  value: string;
  expires?: Date | string | number;
  domain?: string;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  priority?: 'low' | 'medium' | 'high';
  sameSite?: 'strict' | 'lax' | 'none' | boolean;
  secure?: boolean;
  partitioned?: boolean;     // Chrome CHIPS
}
```

**Kontrast:** `RequestCookie` (zwracany z `request.cookies.getAll()`) ma tylko `name` i `value` — bez opcji. Aktualny kod używa `supabaseResponse.cookies.getAll()` (response, nie request) → poprawnie.

**Bug ryzyko:** jeśli Supabase `setAll()` w `middleware.ts:21` ustawi cookie z polem nieprzewidzianym przez TS (np. `partitioned`, dodane w nowszej wersji `@supabase/ssr`), destrukturyzacja `...options` zachowa je pod tą samą nazwą i `cookies.set(name, value, options)` spróbuje je zapisać. Tu `set(name, value, options)` w Next.js ma sygnaturę:

```typescript
set(name: string, value: string, options?: Partial<ResponseCookie>): NextResponse;
```

Jeśli `partitioned: true` jest w `options`, ale wersja Next.js nie obsługuje tego pola → ciche zignorowanie. Bezpieczne, ale kruche przy bumpie `@supabase/ssr`.

**Konsekwencje (real-world):**
- Aktualnie żadnego błędu, ale lock'i wersji `@supabase/ssr ~0.10.0` (`tech-stack.md` §16 macierz) są pinowane do patch range właśnie dlatego — beta API breakable.
- Przy bumpie minor (0.11.x) jeśli Supabase doda np. `priority` lub `partitioned`, cookies mogą trafić na intl response z polami które Next nie zachowa lub które TypeScript zacznie flagować jako mismatch typów.

**Rozwiązanie:** użyć eksplicytnej kopii pól (bezpieczne):

```typescript
supabaseResponse.cookies.getAll().forEach((cookie) => {
  intlResponse.cookies.set(cookie);   // ← przyjmuje cały obiekt ResponseCookie
});
```

`NextResponse.cookies.set()` ma overload przyjmujący cały `ResponseCookie` — to jest natywna ścieżka kopiowania bez destrukturyzacji.

**Rekomendacja:** drobna poprawka, defensywna względem przyszłych zmian w `@supabase/ssr`. Komentarz w `proxy.ts:8-16` może zostać niezmieniony; semantyka jest identyczna.

---

### 2.6 (przeniesione z v4 §2.6, niezmienione) `AllShapeGeometry = {}` scaffold — brak hard-stopu w CI

**Status:** wciąż aktywne. Komentarz w `src/store/types.ts:5-9` jest poprawny:

```typescript
// SCAFFOLD: puste {} dopóki żaden kształt nie jest zaimplementowany.
// TODO: przy dodaniu pierwszego src/shapes/[typ]/ zastąpić scaffolda pełną intersectionem
// Zmiana jest BREAKING dla wszystkich call-sites commitShapeUpdate.
export type AllShapeGeometry = {};
```

`architecture-base.md` §19 (linia 1332) zostało rozszerzone o ostrzeżenie BREAKING change po v4. Ale to wciąż **dokumentacja, nie egzekucja**. Implementator może:

1. Dodać `src/shapes/plate/` z `PlateShape` i wpisem do `SHAPE_REGISTRY`.
2. Zapomnieć zaktualizować `AllShapeGeometry` z `{}` na `Omit<PlateShape, 'id' | 'type'>`.
3. `commitShapeUpdate(id, before, after)` przy `AllShapeGeometry = {}` przyjmuje **dowolny** obiekt jako `ShapeUpdate` (z wyjątkiem `type`). Bez bramki TS literówki w nazwach pól (`with` vs `width`) nie zostaną wychwycone przez kompilator.

**Rozwiązanie (niezmienione od v4):** dodać prosty test kontraktu w Vitest:

```typescript
// tests/store/shape-update-contract.test.ts
import { SHAPE_REGISTRY } from '@/shapes/registry';
import type { AllShapeGeometry } from '@/store/types';

it('AllShapeGeometry musi być pełną intersectionem dla każdego zarejestrowanego kształtu', () => {
  const registered = Object.keys(SHAPE_REGISTRY).length;
  if (registered === 0) return; // scaffold OK przy pustym registry

  type IsEmpty<T> = keyof T extends never ? true : false;
  // FAIL gdy SHAPE_REGISTRY ma >= 1 wpis a AllShapeGeometry wciąż = {}
  const _check: IsEmpty<AllShapeGeometry> extends true ? never : true = true;
});
```

Test żyje w `tests/store/`, więc nie blokuje CI dopóki `SHAPE_REGISTRY` jest pusty (dziś); aktywuje się automatycznie przy pierwszej rejestracji kształtu.

**Rekomendacja:** dodać test pre-implementation pierwszego kształtu — koszt < 10 minut, eliminuje typowy footgun przy onboardingu nowego kształtu.

---

### 2.7 (NOWY) `/api/consent` bundle insert + `current_consent_version` UPDATE NIE są atomowe

**Problem:**

`api-plan.md` §2.1 (linie 178–189) opisuje przepływ `/api/consent`:

```
6. INSERT(y) do consent_log używają klienta createServerClient (sesja użytkownika).
   Bundle insert przez pojedyncze .insert([row1, row2, row3]) — PostgREST gwarantuje
   atomowość per-request.

7. Tylko po pomyślnym bundle insert handler wywołuje createAdminClient (service_role)
   raz, by zapisać user_profiles.current_consent_version = version (kolumna chroniona
   triggerem przed authenticated writem).
```

**Krok 6 i krok 7 to dwa osobne wywołania PostgREST**, każde własną transakcją. Brak współdzielonej transakcji DB.

Sekwencja:
1. `supabase.from('consent_log').insert([{terms}, {privacy}, {cookies}])` → atomowe per-call (PostgREST).
2. `adminSupabase.from('user_profiles').update({current_consent_version}).eq('id', user.id)` → atomowe per-call.

Jeśli krok 1 zakończy się sukcesem, krok 2 padnie (sieć, chwilowa awaria DB), `consent_log` zawiera trzy wpisy ale `user_profiles.current_consent_version` pozostaje `NULL` lub stara wartość.

**Konsekwencje:**

- `architecture-base.md` §14 (linia 1099–1104) opisuje fallback: „przy każdym zalogowaniu pobierz `user_profiles.current_consent_version`. Jeśli `NULL` lub starsza niż aktualna wersja TOS/PP → pokaż modal zgody przed wejściem do aplikacji". Czyli partial failure jest wykrywalny z UI w następnej sesji.
- **Ale:** użytkownik widzi „Twoja zgoda została zapisana" toast po POST 201 (consent log INSERT), a przy następnym logowaniu znów go pyta o zgodę → frustracja UX, brak wyjaśnienia.
- Audyt RODO art. 7 ust. 1 ma dziurę: `consent_log` zawiera version `1.0` (3 wpisy z `accepted_at = T`), `user_profiles` ma `current_consent_version = NULL` (lub starsza wersja). Audytor pyta: „która wersja jest aktualna dla tego usera?" — odpowiedź wymaga sprawdzenia `consent_log` od najnowszego wpisu, co jest wbrew sensowi denormalizacji.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** przenieść logikę bundle insert + update `current_consent_version` do **jednej funkcji `SECURITY DEFINER`** w bazie:

```sql
create or replace function public.record_consent_bundle(
  p_user_id uuid,
  p_version text,
  p_accepted boolean,
  p_ip inet,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.consent_log (user_id, consent_type, version, accepted, ip_address, user_agent)
  values
    (p_user_id, 'terms_of_service', p_version, p_accepted, p_ip, p_user_agent),
    (p_user_id, 'privacy_policy',   p_version, p_accepted, p_ip, p_user_agent),
    (p_user_id, 'cookies',          p_version, p_accepted, p_ip, p_user_agent);

  if p_accepted then
    update public.user_profiles
    set current_consent_version = p_version
    where id = p_user_id;
  end if;
end;
$$;
```

Handler `/api/consent` wywołuje wyłącznie `supabase.rpc('record_consent_bundle', ...)` z klienta z sesją (RLS + RPC działa na `authenticated`; SECURITY DEFINER omija block_protected_columns_update wewnątrz funkcji). Cała operacja w jednej transakcji DB.

**Opcja B:** zaakceptować non-atomicity z istniejącym fallbackiem (modal przy logowaniu) — tańsze w implementacji, ale UX gap pozostaje.

**Rekomendacja:** Opcja A. Atomowość audytu RODO to inwestycja jednorazowa (jedna migracja, jedna funkcja), a eliminuje dziurę „consent_log != current_consent_version" trwale. Aktualizacja:

1. Nowa migracja `2026XXXX_record_consent_bundle.sql` — funkcja + GRANT EXECUTE TO authenticated.
2. `api-plan.md` §2.1 — zaktualizować logikę handlera (jeden RPC call zamiast 2-step).
3. `db-plan.md` §4.7 — dodać `record_consent_bundle` do listy SECURITY DEFINER funkcji.

Aspekt bezpieczeństwa: funkcja przyjmuje `p_user_id` jako parametr — handler **musi** przekazać `auth.uid()` z sesji, nie wartość z body. Można to wymusić, sprawdzając `auth.uid() = p_user_id` jako pierwszą instrukcję funkcji (RAISE EXCEPTION inaczej).

---

## 3. 🟢 Drobne

### 3.1 (przeniesione z v4 §3.1) `consent_log.ip_address: unknown` w generowanych typach

**Status:** wciąż aktywne, niezmienione. `src/types/database.ts:43`:
```typescript
ip_address: unknown
```

**Dokumentacja:** `db-plan.md` §1.6 (linia 134–139) zawiera proponowany wrapper:
```typescript
// src/types/supabase-helpers.ts
export type ConsentLogRow = Omit<Tables<'consent_log'>, 'ip_address'> & { ip_address: string | null }
```

Wrapper będzie tworzony przy implementacji `/api/consent`. **Brak zmiany od v4.** Akceptowalne — workaround udokumentowany.

---

### 3.2 (przeniesione z v4 §3.3) E2E smoke test bez weryfikacji locale

**Status:** wciąż OK. Oba locales mają identyczny `title: "WelderDoc"`, więc test przechodzi dla obu wariantów. Rozszerzyć po implementacji pierwszej feature (US-018).

---

### 3.3 (przeniesione z v4 §3.4) `vitest-canvas-mock` weak assertion w smoke teście

**Status:** wciąż OK. `tests/smoke.test.ts` sprawdza tylko, że `getContext('2d')` nie zwraca `null` — może być fałszywie zielony nawet bez canvas mocka. Wzmocnić po pierwszej implementacji testu Konvy (np. assertion na `__getEvents` API z mocka).

---

### 3.4 (przeniesione z v4 §3.6) Test co-location vs `tests/` directory — wciąż otwarte

**Status:** wciąż otwarte. `vitest.config.ts:12` pozwala na oba wzorce; CLAUDE.md i `architecture-base.md` §3 nie precyzują konwencji.

**Rekomendacja (z v4):** zaktualizować `architecture-base.md` §3:
```diff
- tests/    ← Vitest unit/integration (poza src/)
+ tests/    ← Vitest integration / cross-module suites
+           (testy unit pojedynczego helpera mogą być co-locowane jako
+           src/lib/<x>.test.ts — vitest.config.ts include obejmuje oba wzorce)
```

To zostało częściowo już zrobione (linia 183–187 ma podobny komentarz). Wystarczające — można uznać za zamknięte po v5.

---

### 3.5 (NOWY) `canvas-kit/index.ts` eksportuje `CanvasPointerHandler` poza kontrakt §22.1

**Problem:**

`src/canvas-kit/index.ts:30-43`:
```typescript
export type {
  CommonShapeProps,
  GProps,
  RectProps,
  // ...
  RasterizeOptions,
  CanvasPointerHandler            // ← nieuwzględniony w arch §22.1
} from './primitives';
```

`architecture-base.md` §22.1 (linie 1453–1474) listuje publiczny kontrakt canvas-kit. `CanvasPointerHandler` (alias `(e: PointerEvent) => void`) nie jest wymieniony — jest tylko częścią `CommonShapeProps.onPointerDown` etc.

**Konsekwencje:**

- Eksport jest legalny i przydatny (renderery shape'ów mogą deklarować type-safe handlery), ale poszerza powierzchnię publiczną canvas-kit poza spec.
- Implementator architektury §22 zakładający, że canvas-kit eksportuje **tylko** to co w spec'u, może dodać własne wewnętrzne `type Handler` zamiast używać `CanvasPointerHandler` — drobna duplikacja.

**Rozwiązanie:** zaktualizować `architecture-base.md` §22.1 o brakujący eksport:

```diff
  // Stałe
  export { HIT_AREA_TOUCH, HIT_AREA_DESKTOP, devicePixelRatio } from './constants'
+
+ // Typy props prymitywów + utility types
+ export type {
+   CommonShapeProps, GProps, RectProps, LineProps, ArcProps, CircleProps, PathProps, TextProps,
+   RasterizeOptions, CanvasPointerHandler
+ } from './primitives'
```

(Spec aktualnie nie wymienia żadnych typów props prymitywów jako publicznego API, ale są niezbędne dla renderer'ów — `architecture-base.md` §22.4 implicytnie zakłada, że renderer importuje typy props z `@/canvas-kit`. Trzeba to zrobić jawnie.)

**Rekomendacja:** drobna poprawka dokumentacji — bez zmian w kodzie.

---

### 3.6 (NOWY) `proxy.ts` `?? NextResponse.next()` jest dead code

**Problem:**

`src/proxy.ts:18-29`:
```typescript
const { supabaseResponse, user: _user } = await updateSession(request);
const intlResponse = intlMiddleware(request);
if (intlResponse) {
  // ...
  return intlResponse;
}
return supabaseResponse ?? NextResponse.next();
//                       ^^^^^^^^^^^^^^^^^^^^^
//                       dead code: supabaseResponse jest zawsze ustawione
```

`src/lib/supabase/middleware.ts:5-6`:
```typescript
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  // ... reassigned in setAll(), ale zawsze do NextResponse.next(...)
```

`supabaseResponse` jest **zawsze** zainicjalizowany jako `NextResponse.next(...)` na linii 6 i jeśli nie zostanie nadpisany w `setAll()`, pozostaje. Returnuje się z destrukturyzacji niezawodnie.

`?? NextResponse.next()` jest dead code — nigdy nie wykonana ścieżka.

Komentarz `proxy.ts:14-16`:
> „Fallback `?? NextResponse.next()` jest defensywny — w obecnej konfiguracji `intlMiddleware` zawsze coś zwraca, ale wolimy nie zakładać tego implicite."

Komentarz dotyczy `intlResponse`, ale `?? NextResponse.next()` jest na `supabaseResponse` (po `if (intlResponse)`) — czyli komentarz nie pasuje do miejsca.

**Konsekwencje:**

- Dead code zaśmieca i wprowadza w błąd przy code review (czytelnik szuka, kiedy `supabaseResponse` może być falsy — i nigdy nie znajduje).
- Niezgodność komentarz vs faktyczna lokalizacja `??`.

**Rozwiązanie:**

```diff
- return supabaseResponse ?? NextResponse.next();
+ return supabaseResponse;
```

I zaktualizować komentarz (linie 14–16) — lub usunąć, bo opisuje sytuację, której nie ma.

**Rekomendacja:** drobna poprawka. Cleanupowa, bez wpływu funkcjonalnego.

---

### 3.7 (NOWY) `architecture-base.md` §17 prescribes login redirect to `user.locale`, nieimplementowane w `layout.tsx`

**Problem:**

`architecture-base.md` §17 (linia 1281–1283):
> „**Zalogowany:** dodatkowo `UPDATE user_profiles.locale = '<wybrany>'` (zapis przez Supabase SDK). Po następnym logowaniu (zwłaszcza na innym urządzeniu) layout root wykonuje `redirect` na `/<user.locale>/...`, jeśli `pathname locale ≠ user.locale`."

`src/app/[locale]/layout.tsx` aktualnie wykonuje tylko:
```typescript
if (!hasLocale(routing.locales, locale)) notFound();
setRequestLocale(locale);
const messages = await getMessages();
// brak fetch'a user.locale, brak redirect
```

**Status:** zachowanie nie jest jeszcze potrzebne (pre-implementation auth), więc to jest spec deklarowany na przyszłość, nie błąd implementacji.

**Konsekwencje:**

- Brak — póki nie ma zalogowanego użytkownika, redirect jest no-op.
- Pierwszy push z formularzem logowania powinien mieć tę logikę dodaną do `layout.tsx` lub do osobnego middleware locale, inaczej User experience „zalogował się EN, layout ładuje PL" pozostanie.

**Rozwiązanie:** dodać do CLAUDE.md sekcji „PR checklist" (linia 64–73) lub do osobnej listy „Auth implementation":

```markdown
## PR checklist — implementacja auth (US-002):

- [ ] `src/app/[locale]/layout.tsx` (lub osobny `LocaleGuard.tsx`) po
      `setRequestLocale(locale)` sprawdza `auth.getUser()`. Jeśli zalogowany
      i `user.user_metadata.locale ≠ pathname locale` (po pobraniu z
      `user_profiles.locale`) → `redirect` na `/<user.locale>/...`.
```

**Rekomendacja:** opcjonalne. Zachowanie zostawić architecture-base'owi, ale dodać przypomnienie w PR checkliście (CLAUDE.md). Bez tego implementator US-002 zapomni i UX desync między device'ami pojawi się już w MVP.

---

### 3.8 (NOWY) `tsconfig.json compilerOptions.types: ["vitest/jsdom"]` ogranicza auto-load `@types/*`

**Problem:**

`tsconfig.json:18`:
```json
"types": ["vitest/jsdom"]
```

Per dokumentacja TypeScript: ustawienie `types` (pustego lub z konkretną listą) **wyłącza** automatyczne włączanie wszystkich `@types/*` z `node_modules`. Tylko explicit lista jest brana pod uwagę.

W rezultacie `@types/node`, `@types/react`, `@types/react-dom` (zadeklarowane w `package.json:53-55`) nie są auto-loadowane przez `tsc`. Ich typy są dostępne tylko przez:
1. Bezpośrednie `import` w pliku.
2. Tranzytywne ładowanie przez Next.js (`next-env.d.ts`).
3. JSX runtime (`@types/react` przez `jsx: "preserve"`).

`pnpm typecheck` (`tsc --noEmit`) przechodzi, więc w praktyce typy są dostępne. Ale niespójność między:
- `tech-stack.md` §9 (linia 207): „`tsconfig.json` `compilerOptions.types` zawiera `["vitest/jsdom"]`."
- Brak adnotacji, że to wyłącza auto-load `@types/node`/`@types/react`.

**Konsekwencje:**

- Implementator dodający nową devDependency np. `@types/uuid` nie zobaczy globalnych typów — musi explicit `import` w plikach lub dodać do `types: [...]`.
- Subtelne błędy typów w produkcyjnym kodzie używającym Node API (`process.env`, `Buffer`) mogą prześlizgnąć się jeśli Next.js zmieni sposób ładowania `@types/node`.
- Brak komentarza w `tsconfig.json` objaśniającego, dlaczego `types: [...]` jest restrykcyjne.

**Rozwiązanie — wybór:**

**Opcja A:** rozszerzyć `types` o pełną listę:
```json
"types": ["vitest/jsdom", "node", "react", "react-dom"]
```
Eksplicit i przewidywalne; ale duplikuje to, co Next.js i JSX runtime ładują automatycznie.

**Opcja B:** usunąć `types` (powrót do auto-load wszystkiego):
```json
// usuwa "types": ["vitest/jsdom"]
// Vitest będzie ładowane przez import 'vitest/jsdom' w vitest.setup.ts
```
Najprostsze; vitest globals (`describe`, `it`) wciąż aktywne dzięki `globals: true` w `vitest.config.ts:11`.

**Opcja C:** zostawić jak jest, dodać komentarz:
```json
{
  "compilerOptions": {
    // "types: [...]" wyłącza auto-load @types/*. Dodać tu typy które nie są
    // ładowane przez next-env.d.ts ani JSX runtime ani import w pliku.
    "types": ["vitest/jsdom"]
  }
}
```

**Rekomendacja:** Opcja B. Nie ma uzasadnionego powodu, by ograniczać auto-load `@types/*` w tym projekcie — `globals: true` w vitest config + `import 'vitest-canvas-mock'` w setup wystarczają. Restrykcja `types: [...]` to częsta cargo-cult-rekomendacja z tutoriali Vitest, niepotrzebna w projektach z Next.js.

---

## 4. Rekomendacje priorytetowe (lista działań)

### Przed startem implementacji Route Handlerów (ASAP):

1. 🔴 **§1.1** — implementować brakujące Route Handlery (cron × 2, paddle webhook, consent, user/export). Rozważyć `pnpm verify:routes` jako bramkę CI.
2. 🔴 **§1.2** — zaktualizować `src/app/api/health/route.ts` zgodnie z `api-plan.md` §2.1 (status/timestamp/checks; 503 przy błędzie DB; bez wycieku `error.message`).
3. 🟡 **§2.7** — zdecydować: bundle insert + update jako jedna SECURITY DEFINER funkcja, czy zaakceptować non-atomicity z fallbackiem. Rekomendacja: opcja A (DB function).

### Przed pierwszym deployem produkcyjnym:

4. 🟡 **§2.2** — zaktualizować `tech-stack.md` §13 dla `SUPABASE_SERVICE_ROLE_KEY` (lista 4 użyć zamiast „wyłącznie Paddle webhook").
5. 🟡 **§2.4** — doprecyzować `architecture-base.md` §16, że proxy nie obejmuje `/api/*`; refresh per-request w handlerach.

### W dowolnym momencie (drobne / opcjonalne, ale tańsze niż później):

6. 🟡 **§2.1** — doprecyzować regułę w `db-supabase-migrations.md` (granular per-rola, `FOR ALL` dozwolone gdy identyczny body w jednej roli).
7. 🟡 **§2.3** — dodać `dotenv-cli` do devDeps, zaktualizować skrypt `supabase:types`.
8. 🟡 **§2.5** — uprościć cookie-copy w `proxy.ts` do `intlResponse.cookies.set(cookie)`.
9. 🟡 **§2.6** — dodać Vitest test kontraktu `AllShapeGeometry` (aktywuje się gdy `SHAPE_REGISTRY` ma ≥ 1 wpis).

### Drobne (kosmetyczne, niska pilność):

10. 🟢 **§3.1** — wrapper `ConsentLogRow` przy implementacji `/api/consent` (już planowane).
11. 🟢 **§3.2 / §3.3** — wzmocnić smoke testy po pierwszej feature.
12. 🟢 **§3.4** — zamknąć dyskusję test co-location przez doprecyzowanie `architecture-base.md` §3 (już częściowo zrobione).
13. 🟢 **§3.5** — dodać do `architecture-base.md` §22.1 listy publicznych typów (props + `CanvasPointerHandler`).
14. 🟢 **§3.6** — usunąć dead code `?? NextResponse.next()` z `proxy.ts`.
15. 🟢 **§3.7** — dodać do CLAUDE.md PR checklisty wpis o redirect na `user.locale` przy implementacji auth.
16. 🟢 **§3.8** — usunąć restrykcyjny `types: ["vitest/jsdom"]` z `tsconfig.json` (Opcja B).

---

## 5. Podsumowanie

**Stan dokumentacji vs kod (delta v4 → v5):**

- 9 z 14 problemów v4 naprawionych (vs 11/14 w v3 → v4) — utrzymanie wysokiej dyscypliny synchronizacji `api-plan.md` ↔ `architecture-base.md` ↔ migration ↔ `db-plan.md`. W szczególności wszystkie problemy klasy 🔴 z v4 obszaru API/auth zostały zaadresowane (cron HTTP method, consent payload bundle, service_role usage w `/api/consent`, 4 polityki vs FOR ALL).
- 3 problemy v4 carried-forward jako 🟡/🟢 — wszystkie świadome scaffoldy / akceptowalne stan pre-implementation.
- 11 nowych problemów zidentyfikowanych w v5: 1 × 🔴 (`/api/health` divergence), 5 × 🟡 (głównie dokumentacyjne lub pre-emptywne), 5 × 🟢 (kosmetyczne).

**Główne ryzyka v5:**

1. **`api-plan.md` jako kontrakt nie jest weryfikowane przez CI** — `/api/health` jest pierwszym route handlerem, w którym implementacja desynchronizowała się ze spec'em. Identyczne ryzyko przy kolejnych route handlerach (consent, user/export). Bramka CI (`verify:routes`) lub kontrakt-testy (Pact-style) byłyby wartościowe — patrz §1.1 rekomendacja.

2. **Plik `db-supabase-migrations.md` jako AI directive sprzeczny z istniejącą bazą** — dodany do repo jako przewodnik dla generowania migracji, ale jego reguła „granular policies" jest sprzeczna ze stanem osiągniętym w v4 (single `FOR ALL` na `documents`). Pierwsza nowa migracja generowana przez AI zgodnie z tym przewodnikiem złamie konwencję — patrz §2.1.

3. **Atomowość audytu RODO `/api/consent`** — 2-step (consent_log INSERT + user_profiles UPDATE) z fallbackiem przez modal przy logowaniu — działa, ale wprowadza okno niespójności widoczne dla audytora prawnego. Migracja na SECURITY DEFINER RPC eliminuje problem trwale (§2.7).

**Filtr „przed implementacją kształtów":** żadne z odkryć v5 nie blokuje startu implementacji domeny shapes. Wszystkie 🔴 dotyczą warstwy API; 🟡 to dokumentacja + jeden refactoring DB. Implementacja shape'ów może iść równolegle z naprawami API.

**Filtr „przed pierwszym deployem produkcyjnym":** wymagane są naprawy §1.1 (Route Handlers), §1.2 (health endpoint), §2.7 (atomowość consent) oraz utrzymanie naprawnych z v4 obszarów (RODO, RLS, cron HTTP). `db-supabase-migrations.md` (§2.1) i `tech-stack.md` (§2.2) powinny być zaktualizowane przed jakąkolwiek nową migracją lub nowym route handlerem korzystającym z service_role.
