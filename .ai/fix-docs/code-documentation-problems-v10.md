# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v10)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 10.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/db-supabase-migrations.md`, poprzednie analizy v2–v9, kod w `src/` (Route Handlery, canvas-kit, lib, store, shapes, app/[locale]), migracje w `supabase/migrations/` (4 sztuki), `supabase/config.toml`, `vercel.json`, `.github/workflows/ci.yml`, `scripts/verify-routes.sh`, `package.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `next.config.ts`, `commitlint.config.mjs`, `.lintstagedrc.json`, `.env.example`, `.gitignore`, `CLAUDE.md`.
>
> **Stan projektu (2026-05-08):** post-bootstrap, pre-implementation domeny. Warstwa API (5 Route Handlerów), 4 migracje Supabase i `lib/ipAnonymize.ts` zaimplementowane i pokryte testami. Logika domeny (shapes, weld-units, store slices, components canvas) wciąż nie istnieje.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, wprowadzający w błąd implementatora/operations lub powodujący regresję poprawki z poprzednich cykli.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru, ale nie blokują pracy.
> - 🟢 **Drobne** — niespójności kosmetyczne, niska pilność.

---

## 0. Status problemów z v9

| # v9 | Tytuł | Status (v10) | Komentarz |
|---|---|---|---|
| 1.1 | Migracja `20260507` `COMMENT ON COLUMN user_profiles.current_consent_version` kłamie o source of write | ✅ **Naprawione** | Migracja `20260510000000_fix_consent_version_comment.sql` reissuuje `COMMENT ON COLUMN` z poprawnym opisem (route handler na kliencie sesji + RPC `record_consent_bundle()` jako `postgres`, **nie** service_role). Plik istnieje w `supabase/migrations/`. |
| 1.2 | `CLAUDE.md` linia 69 — proxy.ts „currently stubbed" | ✅ **Naprawione** | `CLAUDE.md` linia 69 ma teraz pełny opis chain'a `Supabase updateSession() → next-intl middleware`, bez słowa „stubbed". |
| 2.1 | `consent/route.ts` vs `paddle/webhook/route.ts` — niespójne kody błędów malformed JSON | ✅ **Naprawione** | `consent/route.ts:38-39` zwraca `'invalid_payload'` (catch z `request.json()`), spójne z `paddle/webhook/route.ts:103`. |
| 2.2 | `consent/route.ts:117` — silent fallback `current_consent_version: null` na DB error | ✅ **Naprawione** | Aktualnie `consent/route.ts:117-125` jawnie sprawdza `profileError` i zwraca 500; `?? null` służy tylko ochronie przy brakującym wierszu profilu, nie maskuje błędu DB. |
| 2.3 | `architecture-base.md` §9 + §22.1 — `devicePixelRatio` jako wartość, nie funkcja | ✅ **Częściowo naprawione** | §9 linia 798 i §22.1 linie 1429–1432 używają `devicePixelRatio()`. Pozostała wzmianka §20 linia 1302 wciąż pisze `pixelRatio={window.devicePixelRatio}` w sekcji „Konva na tablet / stylus" — niezgodna z invariantem §22.9.4 (jedyne miejsce do czytania `window.devicePixelRatio` to `canvas-kit/constants.ts`). Patrz §3.1 v10. |
| 2.4 | `pointerInput.ts:24` — duplikat `export type { Point }` | ✅ **Naprawione** | `src/canvas-kit/pointerInput.ts:24` ma `import type { Point }` (nie `export`). Komentarz w plików (linia 23) wyjaśnia, że barrel zwraca oba typy. |
| 2.5 | `tech-stack.md` §14 — brak skryptów `supabase:types:local` + `prepare` | ✅ **Naprawione** | `tech-stack.md` §14 (linie 327–354) zawiera oba skrypty. |
| 2.6 | `tech-stack.md` §11 + §15 nie pokrywa narzędzi (husky, lint-staged, …) | ✅ **Naprawione** | §11.1 (linie 247–256) lista pełna; §15 (linie 410–413) zawiera te same wpisy. |
| 3.1 | Migracja `20260507` linie 296–310 — outdated SQL comment block na `block_protected_columns_update` | 🟢 **Carry-forward** | Komentarz inline w migracji (CREATE OR REPLACE FUNCTION) wciąż mówi „current_consent_version: only the /api/consent route handler (service_role)" — to SQL line comment, **nie** `pg_description`, więc nie wyciekają do Supabase Studio ani gen types. Naprawa wymagałaby dodatkowej migracji `CREATE OR REPLACE FUNCTION` z poprawionym komentarzem albo akceptujemy stale info (kompromis: dokumentacja `db-plan.md` §1.2 już ma poprawny opis). |
| 3.2 | `paddle/webhook/route.ts:174-177` — silent return przy niepełnych danych subskrypcji | ✅ **Naprawione** | Linie 175–189 dodają `console.warn` z eventId, eventType, hasSubId, hasCustomerId, hasStatus, hasPlanTier, rawStatus, rawPriceId — pełne diagnostyki przed return. |
| 3.3 | `architecture-base.md` §15 linia 1157 — opis `block_protected_columns_update` niekompletny | ✅ **Naprawione** | Tabela §15 wymienia oba bypass'y: `current_user = 'postgres'` (SECURITY DEFINER) i `auth.role() = 'service_role'` (admin client). |
| 3.4 | `tech-stack.md` §12 `vercel.json` snippet bez `"$schema"` | ✅ **Naprawione** | §12 (linie 281–298) snippet zaczyna się od `"$schema"` — zgodny z faktycznym `vercel.json:2`. |
| 3.5 | Carry-forwardy z v8 (§3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9) | 🟢 **Carry-forward bez zmian** | Wszystkie nadal akceptowalne kosmetyki, niska pilność. |
| 3.6 | `tech-stack.md` §14 linia 313 — `lint` script niezgodny z `package.json` | ✅ **Naprawione** | `package.json` linia 10: `"lint": "eslint ."`; `tech-stack.md` §14 linia 333 ma identyczny zapis. |

**Wniosek dla cyklu v9 → v10:** **9 z 13 problemów v9 naprawionych** (najlepszy wynik od cyklu v7 → v8). Wszystkie problemy 🔴 z v9 (1.1, 1.2) i większość 🟡 (2.1, 2.2, 2.4, 2.5, 2.6) — naprawione. Jedyne carry-forwardy: §2.3 (`window.devicePixelRatio` w §20 architecture-base) i §3.1 (SQL line comment w migracji). Tempo naprawiania pozytywne — autor zaktualizował dokumenty po analizie v9 oraz dodał migrację `20260510000000_fix_consent_version_comment.sql` w odpowiedzi na v9 §1.1.

Poniżej — **nowe problemy zidentyfikowane w v10**. Skoncentrowane na driftach wprowadzonych po dodaniu czwartej migracji oraz subtelniejszych niespójnościach pomiędzy kodem a narracją w dokumentach.

---

## 1. 🔴 Krytyczne

### 1.1 (NOWY) `CLAUDE.md` linia 18 + `db-plan.md` §5.12a — odwołanie do „trzech migracji" / „dwóch poprawkowych" po dodaniu `20260510000000`

**Problem:**

Po sesji v9 do `supabase/migrations/` dodano czwartą migrację `20260510000000_fix_consent_version_comment.sql` (15 linii, naprawia komentarz `pg_description`). Plik istnieje, ale dwa pliki dokumentacyjne wciąż mówią o stanie sprzed jego dodania:

1. **`CLAUDE.md` linia 18:**
   > Three Supabase migrations are applied: `20260507000000_complete_schema.sql`, `20260508000000_record_consent_bundle.sql`, `20260509000000_paddle_webhook_hardening.sql`. Domain layer (shapes, weld-units, store slices, canvas components) is not yet implemented.
2. **`.ai/db-plan.md` §5.12a (linia 457):**
   > Po pierwszej greenfield migracji `20260507000000_complete_schema.sql` zastosowano **dwie** poprawkowe migracje:
   >
   > - `20260508000000_record_consent_bundle.sql` …
   > - `20260509000000_paddle_webhook_hardening.sql` …
   >
   > Każda kolejna zmiana schematu/funkcji jest dodawana jako nowa migracja `YYYYMMDDHHmmss_short_description.sql` zgodnie z `db-supabase-migrations.md`.

Stan faktyczny:

```bash
$ ls supabase/migrations/
20260507000000_complete_schema.sql
20260508000000_record_consent_bundle.sql
20260509000000_paddle_webhook_hardening.sql
20260510000000_fix_consent_version_comment.sql   # ← NOWA, nieudokumentowana
```

Migracja `20260510000000_fix_consent_version_comment.sql` reissuuje `COMMENT ON COLUMN public.user_profiles.current_consent_version` (krok zalecony w v9 §1.1 — naprawiono pomyślnie), ale dokumentacja nie została zsynchronizowana.

**Konsekwencje:**

- 🔴 **Implementator kolejnej migracji** czytając `db-plan.md` §5.12a otrzymuje listę „post-greenfield migracji = 2", potencjalnie niepoprawnie ocenia kontekst (np. zakłada, że `pg_description` nadal jest stale, bo §5.12a nie wymienia 20260510). Może zacząć debugować już-rozwiązany problem.
- 🔴 **Code review nowego PR** — reviewer szukający odpowiednika `pnpm supabase db reset` / „czy dev musi ponownie aplikować migracje" sprawdza `CLAUDE.md` line 18: widzi „three migrations", liczy `ls supabase/migrations/ | wc -l = 4`, i otrzymuje sygnał „dokumentacja jest stale, lokalna baza może być w nieznanym stanie". Niepotrzebny noise.
- 🟡 **Cykl analiz code-documentation-problems** — kolejny analizator (v11) zacznie od wątpliwości „skąd ta 4. migracja, czemu nie ma jej w żadnej liście?" zamiast od nowych problemów. Każdy cykl analizy płaci ten koszt dopóki dokumentacja nie zostanie zsynchronizowana.

**Rozwiązanie:**

1. **`CLAUDE.md` linia 18** — zmienić „Three" na „Four" i dopisać czwartą migrację:
   ```diff
   - Three Supabase migrations are applied: `20260507000000_complete_schema.sql`, `20260508000000_record_consent_bundle.sql`, `20260509000000_paddle_webhook_hardening.sql`.
   + Four Supabase migrations are applied: `20260507000000_complete_schema.sql`, `20260508000000_record_consent_bundle.sql`, `20260509000000_paddle_webhook_hardening.sql`, `20260510000000_fix_consent_version_comment.sql` (fixes outdated `pg_description` on `user_profiles.current_consent_version` per v9 §1.1).
   ```
2. **`db-plan.md` §5.12a** — zmienić „dwie" na „trzy" i dopisać wpis:
   ```markdown
   - **`20260510000000_fix_consent_version_comment.sql`** — reissuuje `COMMENT ON COLUMN public.user_profiles.current_consent_version` z poprawnym opisem source of write (klient sesji + RPC `record_consent_bundle` jako `postgres`, nie `service_role`). Naprawia `pg_description` widoczne w Supabase Studio i potencjalnie w `supabase gen types` — rozwiązanie code-doc-v9 §1.1.
   ```

**Rekomendacja:** Naprawić **przed kolejną sesją Claude / przed kolejnym PR-em domeny shape'ów**. To jest mechaniczna edycja dwóch plików w sumie ~3 linie tekstu — koszt naprawy tysiące razy mniejszy niż koszt ciągłego potykania się o stale info. Bez tej naprawy kolejny cykl analiz (v11) odnotuje to samo jako carry-forward.

---

### 1.2 (NOWY) `tech-stack.md` §11.1 wpisuje `@eslint/eslintrc` jako „FlatCompat bridge", ale `eslint.config.mjs` nie używa `FlatCompat` w ogóle

**Problem:**

`tech-stack.md` §11.1 (linia 256):

> `@eslint/eslintrc` | `^3.0.0` | FlatCompat — most między starym formatem `extends: 'next'` a flat configiem ESLint 9

Sugeruje to, że `eslint.config.mjs` używa wzorca:

```javascript
import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: __dirname });
const config = [
  ...compat.extends('next/core-web-vitals'),
  ...compat.extends('next/typescript'),
  // ...
];
```

Stan faktyczny w `eslint.config.mjs:1-2`:

```javascript
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
```

Tj. używamy **natywnych eksportów flat-config** z `eslint-config-next@^16` (paczka pakietu eksportuje `core-web-vitals` i `typescript` jako gotowe array'e flat-config). `FlatCompat` nie jest importowane ani używane w żadnym pliku projektu.

Jednocześnie `package.json:49` ma `"@eslint/eslintrc": "^3.0.0"` i lockfile go pinuje (`pnpm-lock.yaml: @eslint/eslintrc@3.3.5`). Pakiet jest **zainstalowany, ale nieużywany**.

**Konsekwencje:**

- 🔴 **Implementator zmieniający ESLint config** czyta `tech-stack.md` §11.1, oczekuje że `eslint.config.mjs` ma `FlatCompat`, próbuje rozszerzyć config dopisując `compat.extends('eslint-plugin-foo')`. Po pierwszym `pnpm lint` dostaje TS / ESM error („FlatCompat is not defined"). Marnuje 15-30 minut zanim zorientuje się, że tech-stack.md nie odzwierciedla rzeczywistości.
- 🟡 **Dead-code w deps** — `@eslint/eslintrc` to ~2 MB w `node_modules` (transitive deps `globals`, `ajv`, `espree`). Nie zwiększa rozmiaru bundla aplikacji (devDep), ale wydłuża `pnpm install` o nikły, mierzalny czas.
- 🟢 **Drift cross-document** — to jeden z dwóch ostatnich punktów w `tech-stack.md` §15, które rozjeżdżają się z konfiguracją (drugim jest §11.1 linia 261 — `commitlint.config.cjs` vs faktyczny `commitlint.config.mjs`, patrz §3.3 v10).

**Rozwiązanie (rekomendowane: opcja A):**

**Opcja A — usunąć dep + wpis w tech-stack.md (rekomendowana):**
- `package.json`: usunąć linię 49 `"@eslint/eslintrc": "^3.0.0",`
- `pnpm-lock.yaml`: regenerowany przez `pnpm install`
- `tech-stack.md` §11.1: usunąć linię 256 dotyczącą `@eslint/eslintrc`
- `tech-stack.md` §15 lista `devDependencies`: usunąć linię 404 `@eslint/eslintrc@^3.0.0`

Uzasadnienie: `eslint-config-next@^16` eksportuje gotowe flat-config arraye, FlatCompat jest niepotrzebny. Mniej deps = mniejsza powierzchnia ataku.

**Opcja B — udokumentować jako „zarezerwowane na przyszłą rozbudowę":**
- Dodać komentarz w `eslint.config.mjs` lub w `tech-stack.md` §11.1 wyjaśniający, że `@eslint/eslintrc` jest pinowane „na wypadek dopisania `compat.extends(...)` w przyszłości".

Niezalecana — łamie zasadę „install only what you use".

**Rekomendacja:** Opcja A. Usuwa zaplątanie pojęciowe i odchudza deps. Naprawa: 5-10 minut + `pnpm install`.

---

## 2. 🟡 Istotne

### 2.1 (NOWY) `architecture-base.md` §15 linia 1157 oraz §14 linie 1097–1101 — w prozie wymieniają `sync_paddle_customer` jako konsumenta bypass'a `current_user = 'postgres'`, ale faktycznie ten trigger NIE pisze do chronionych kolumn

**Problem:**

Architecture-base.md i db-plan.md w kilku miejscach wymieniają `sync_paddle_customer` jako konsumenta gałęzi `current_user = 'postgres'` w `block_protected_columns_update`:

`architecture-base.md` §15 (linia 1157):
> `block_protected_columns_update` chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated`; bypass dla `current_user = 'postgres'` (SECURITY DEFINER funkcje typu `record_consent_bundle`, `refresh_user_plan_from_subscriptions`, `sync_paddle_customer`)

`db-plan.md` §1.2 (linia 35):
> `current_user = 'postgres'` — rola owner'a wykonującego `SECURITY DEFINER` funkcję (np. `record_consent_bundle()`, `refresh_user_plan_from_subscriptions()`, `sync_paddle_customer()`).

Zapis sugeruje, że wszystkie trzy funkcje mogą zapisywać do `paddle_customer_id` / `plan` / `current_consent_version` dzięki bypassowi `current_user = 'postgres'` w block-triggerze.

Stan faktyczny: `sync_paddle_customer()` (migracja `20260507`, linie 348–363) **rzeczywiście** UPDATE'uje `user_profiles.paddle_customer_id`, więc **bezpośrednio** korzysta z bypass'u. To jest poprawne. Natomiast tabela bypass'ów w db-plan.md §1.2 dalej (linie 39–41) precyzuje:

> `paddle_customer_id` — trigger `sync_paddle_customer` (z webhooka Paddle) **lub bezpośrednio przez webhook handler**.

Tutaj „bezpośrednio przez webhook handler" odnosi się do `paddle/webhook/route.ts:241-244`:

```typescript
await supabase
  .from('user_profiles')
  .update({ paddle_customer_id: customerId })
  .eq('id', userId);
```

Ten UPDATE jest wywoływany przez `createAdminClient()` (`SUPABASE_SERVICE_ROLE_KEY`). W triggerze `block_protected_columns_update`:
- gałąź 1: `current_user = 'postgres'` — NIE prawda dla service_role (admin client działa jako rola `service_role`, nie `postgres`)
- gałąź 2: `auth.role() = 'service_role'` — TAK prawda; bypass działa

Czyli webhook handler **bezpośrednio przez service_role** korzysta z **drugiej** gałęzi bypass'a (`auth.role() = 'service_role'`), a NIE pierwszej (`current_user = 'postgres'`). Tabela §1.2 db-plan.md poprawnie to opisuje.

Niespójność jest subtelna: prosa w §15 architektury i §1.2 db-plan.md (linia 35) wymienia `sync_paddle_customer` jako jednego z trzech konsumentów `current_user = 'postgres'`. To jest poprawne pod warunkiem, że czytelnik rozumie:
- `sync_paddle_customer` jako trigger function (uruchamiana przez DB engine w kontekście `current_user = 'postgres'`, bo jest SECURITY DEFINER).
- `webhook handler` jako oddzielne miejsce zapisu, używające drugiej gałęzi bypass'a.

Ale **tabela §15 architecture-base.md nie rozróżnia tych dwóch źródeł zapisu** — pisze, że obie gałęzie bypass'a istnieją, ale nie mówi, kto z których korzysta. A db-plan.md §1.2 ma to rozróżnienie tylko w 1 miejscu (linie 39–41), nie w prozie powyżej.

**Konsekwencje:**

- 🟡 **Implementator nowej trigger function** typu `sync_paddle_customer` (np. „sync_subscription_quota_to_user_profiles") czyta §15 → widzi listę bypass-konsumentów → kopiuje wzorzec, pisząc trigger który UPDATE'uje `plan`. Ze SECURITY DEFINER + `current_user = 'postgres'` zadziała. OK.
- 🟡 **Implementator nowego endpointu administracyjnego** czyta §15 → widzi „SECURITY DEFINER funkcje" jako jedyny scenariusz bypass'a — może przeoczyć, że `service_role` admin client też omija block trigger przez drugą gałąź. Może niepotrzebnie owinąć logikę w SECURITY DEFINER function zamiast użyć admin client'a bezpośrednio.
- 🟢 Niepoprawnie tylko wtedy, gdy odbiorca dokumentu czyta §15 selektywnie, bez rozumienia rozróżnienia kanałów zapisu.

**Rozwiązanie:**

Zaktualizować tabelę `architecture-base.md` §15 linia 1157, by wprost wymieniała OBA kanały zapisu do chronionych kolumn:

```diff
- `block_protected_columns_update` chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated`; bypass dla `current_user = 'postgres'` (SECURITY DEFINER funkcje typu `record_consent_bundle`, `refresh_user_plan_from_subscriptions`, `sync_paddle_customer`) i `auth.role() = 'service_role'` (admin client w webhookach Paddle) — patrz `db-plan.md` §1.2
+ `block_protected_columns_update` chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated`. Dwa kanały bypass'a (zgodne intencjonalnie):
+ • DB-side (`current_user = 'postgres'`) — wszystkie SECURITY DEFINER funkcje wykonujące się jako rola właściciela: `record_consent_bundle` (zapisuje `current_consent_version`), `refresh_user_plan_from_subscriptions` (zapisuje `plan`), `sync_paddle_customer` (zapisuje `paddle_customer_id`).
+ • App-side (`auth.role() = 'service_role'`) — `createAdminClient` w `app/api/paddle/webhook/route.ts` przy `customer.*` wykonuje bezpośredni `UPDATE user_profiles SET paddle_customer_id = …`, omija block-trigger przez tę gałąź.
+ Patrz `db-plan.md` §1.2.
```

Dodatkowo — w `db-plan.md` §1.2 linia 38 (po liście „Zapisy odbywają się wyłącznie przez funkcje `SECURITY DEFINER` lub `service_role`") — dodać explicit zdanie:

> Webhook handler `app/api/paddle/webhook/route.ts:241-244` zapisuje `paddle_customer_id` przez `createAdminClient()` (`service_role`), omijając block-trigger przez gałąź `auth.role() = 'service_role'`. Trigger `sync_paddle_customer` to fallback dla przypadku gdy `customer.*` event nie dociera lub przychodzi po `subscription.*` (rozwiązuje brak ordering Paddle).

---

### 2.2 (NOWY) `paddle/webhook/route.ts` `handleCustomerEvent` chicken-and-egg z `lookupUserId` przy pierwszym `customer.created`

**Problem:**

W `paddle/webhook/route.ts:222-245` `handleCustomerEvent` używa funkcji `lookupUserId(supabase, data)` (linie 247–272) z 3-stopniową kaskadą:

1. `customData.user_id` (z payloadu — Paddle to atrybut przekazywany **wyłącznie** z `Paddle.Checkout.open({ customData })`, czyli z subscription flow, **NIE** z `customer.*` events)
2. `paddle_customer_id` lookup (`user_profiles WHERE paddle_customer_id = data.customer.id ?? data.customer_id ?? data.id`)
3. RPC `lookup_user_id_by_email(p_email)` z emailem z `data.customer.email ?? data.email`

Scenariusz „cold start" — pierwszy event Paddle dla nowego użytkownika to `customer.created` (Paddle wysyła `customer.created` przed `subscription.created`):

- Krok 1: `customData.user_id` — **brak** (`customer.*` events nie przenoszą `customData`).
- Krok 2: `user_profiles.paddle_customer_id` lookup — **brak** (jeszcze nigdy nie zapisany; webhook handler dla customer.* JEST tym kto by go zapisał).
- Krok 3: email lookup — **wymaga**, by `data.customer.email` lub `data.email` było obecne. Dla `customer.*` events Paddle wysyła `data.email` jako pole top-level — więc email jest dostępny. RPC `lookup_user_id_by_email` znajdzie użytkownika.

OK, ale: jeśli z dowolnego powodu email nie matchuje (np. user zarejestrował się na Pro przez inny adres niż w Supabase Auth, lub email jeszcze nie potwierdzony i nie ma w `auth.users` z odpowiednim flagiem) — krok 3 zwraca null, handler loguje warning „orphan customer event", **return** (linia 238). `paddle_customer_id` w `user_profiles` pozostaje NULL.

Potem przychodzi `subscription.created` z tym samym customerId. `lookupUserId` w `handleSubscriptionEvent` próbuje:
- Krok 1: `customData.user_id` — TAK, jeśli checkout był uruchomiony z `customData: { user_id }`, to user_id jest tu.
- Krok 2 (gdy checkout bez customData): `user_profiles.paddle_customer_id` — wciąż NULL, lookup fails.
- Krok 3: email lookup — TAK, jeśli email się zgadza.

Subscription wstawia się z `user_id`. Trigger `subscriptions_after_iu_sync_customer` (migracja `20260507` linie 348-363) wpisuje `paddle_customer_snapshot` do `user_profiles.paddle_customer_id` **gdy ten jest NULL**. Stan w końcu zbiega się.

**Konsekwencje:**

- 🟡 **Konfiguracja Paddle Checkout bez `customData`** — `architecture-base.md` §16 / `api-plan.md` §2.2 (linia 813) zalecają `customData: { user_id }`, ale to wymaganie nie jest egzekwowane przez kod. Implementator landing page upgrade'u może zapomnieć. Wtedy:
  - `customer.created` może być orphanem (brak emaila → null lookup),
  - `subscription.created` używa email lookup, podpina subskrypcję,
  - trigger `sync_paddle_customer` wypełnia `paddle_customer_id` z `paddle_customer_snapshot`.
  Czyli OK końcowo, ale pierwsze webhook idzie do rekordu sierocego (`webhook_events` zawiera, ale brak efektu na `user_profiles`).
- 🟡 **Edge case: user zmienił email w Supabase Auth po checkoutu, nie zaktualizował w Paddle** — `lookup_user_id_by_email` nie znajdzie użytkownika, bo szuka po starej wartości emaila Paddle vs nowej w `auth.users`. To znana dziura, ale jako pre-MVP akceptowalna.
- 🟢 Naprawa nie wymaga zmian kodu — tylko explicitna dokumentacja:
  - **Co dzieje się gdy pierwszy `customer.created` przyjdzie przed `subscription.created`** i dlaczego trigger `sync_paddle_customer` w subscriptions istnieje jako fallback.
  - **Co się stanie gdy `customData.user_id` jest pominięte w checkout** (eventual consistency przez email + trigger).

**Rozwiązanie:**

Dodać do `api-plan.md` §2.1 (sekcja `POST /api/paddle/webhook` — Logika przetwarzania, po kroku 5) komentarz wyjaśniający chicken-and-egg:

```markdown
**Recovery flow (`customer.*` jako pierwszy webhook):**
Paddle nie gwarantuje kolejności `customer.created` vs `subscription.created`.
- `customer.created` jako pierwszy: `lookupUserId` w `handleCustomerEvent` próbuje email lookup (RPC `lookup_user_id_by_email`). Sukces → UPDATE `paddle_customer_id`. Niepowodzenie (email niezarejestrowany lub niezgodny) → orphan log, brak efektu. Pierwszy `subscription.created` użyje `customData.user_id` (zalecane) lub email; trigger `sync_paddle_customer` wypełni `paddle_customer_id` z `paddle_customer_snapshot` jeśli wciąż NULL.
- `subscription.created` jako pierwszy: trigger `sync_paddle_customer` wpisuje `paddle_customer_id` do `user_profiles`. Następujący `customer.updated` dla tego użytkownika (jeśli kiedykolwiek przyjdzie) znajdzie usera przez `paddle_customer_id` lookup.
```

Dodatkowo — dodać w `architecture-base.md` §16 (po opisie webhook handler'a) sekcję „Reguły implementacji checkout":

```markdown
**Checkout Paddle (US-045) — wymaganie `customData.user_id`:** call do `Paddle.Checkout.open({...})` MUSI ustawiać `customData: { user_id: <auth.uid()> }`. Bez tego pierwszy webhook subskrypcji idzie przez 3-stopniowy lookup (`customData → paddle_customer_id → email`) i może dotrzeć do orphan log jeśli email Paddle różni się od Supabase Auth. Ten wymóg nie jest weryfikowany przez kod handler'a; PR-checklist musi go wymusić ręcznie.
```

---

### 2.3 (NOWY) `architecture-base.md` §20 linia 1302 — wzmianka `pixelRatio={window.devicePixelRatio}` niezgodna z §22.9.4

**Problem:**

Architecture-base.md §22.9.4 (invariant linia 1583) jest jednoznaczny:

> `pixelRatio` ustawiane wyłącznie w `CanvasShell` — żaden inny komponent nie czyta `window.devicePixelRatio` bezpośrednio.

A §22.1 (linia 1429) mówi:

> Stałe i helpery (w tym `devicePixelRatio` jako funkcja SSR-safe — wołać z nawiasami: `devicePixelRatio()`. **Bezpośredni dostęp do `window.devicePixelRatio` jest zabroniony poza `src/canvas-kit/` przez §22.9.4.**)

Ale §20 linia 1302 (sekcja „Konva na tablet / stylus", lista znanych ryzyk technicznych) wciąż używa formy bezpośredniej:

```markdown
- `pixelRatio={window.devicePixelRatio}` ustawiane przez `CanvasShell` (impl-konva → na `<Stage>`)
```

Czyli ta sama wartość — używana przy opisie tej samej rzeczy (jak `CanvasShell` ustawia DPR na stage'u) — w jednym miejscu (§9 linia 798) jest opisana jako `devicePixelRatio()` z nawiasami i SSR-safe wrapperem, w drugim (§20) jako `window.devicePixelRatio` bez wrapper'a.

Stan faktyczny w kodzie (`src/canvas-kit/impl-konva/CanvasShell.tsx:31`):

```typescript
<Stage ref={stageRef} width={width} height={height} pixelRatio={devicePixelRatio()}>
```

Importowane z `../constants` (`src/canvas-kit/constants.ts:17-20`):

```typescript
export function devicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}
```

Wrapper jest SSR-safe (zwraca `1` w SSR) — kluczowy detail dla Server Components. §20 linia 1302 sugeruje bezpośrednie czytanie z `window`, co w SSR rzuciłoby `ReferenceError` (Next.js App Router renderuje Server Components po stronie serwera).

**Konsekwencje:**

- 🟡 **Implementator komponentu pomocniczego** (np. `MiniMapPreview.tsx` w sidebar) czyta §20 linię 1302 → kopiuje literałem `pixelRatio={window.devicePixelRatio}` do swojego komponentu. Pierwszy SSR render wywala build z `ReferenceError: window is not defined` (chyba, że plik jest wymuszony jako client-side przez `'use client'`).
- 🟡 **Cross-document drift** — §9 (Canvas i nawigacja) i §22.1 (kontrakt publiczny) używają `devicePixelRatio()`; §20 (znane ryzyka) — `window.devicePixelRatio`. Czytelnik ma niespójny model mentalny.
- 🟢 Carry-forward z v9 §2.3 — częściowo naprawione (§9 + §22.1), ale §20 pominięte.

**Rozwiązanie:**

Naprawić linię 1302 architectury:

```diff
- - `pixelRatio={window.devicePixelRatio}` ustawiane przez `CanvasShell` (impl-konva → na `<Stage>`)
+ - `pixelRatio={devicePixelRatio()}` (wrapper SSR-safe z `@/canvas-kit/constants`) ustawiane przez `CanvasShell` (impl-konva → na `<Stage>`); patrz §22.9.4 — bezpośredni dostęp do `window.devicePixelRatio` poza `src/canvas-kit/` jest zabroniony.
```

Naprawa: jedno-zdaniowa edycja architectury. Zamyka v9 §2.3 ostatecznie.

---

### 2.4 (NOWY) `consent/route.ts` — odpowiedź dla bundle ma `inserted` w kolejności DESC, api-plan.md §2.1 sugeruje ASC (TOS → PP → cookies)

**Problem:**

`api-plan.md` §2.1 linie 142–152 — przykład odpowiedzi dla bundle insert:

```json
{
  "inserted": [
    { "id": 42, "consent_type": "terms_of_service", "version": "1.0", "accepted": true, "accepted_at": "2026-05-08T12:00:00Z" },
    { "id": 43, "consent_type": "privacy_policy",   "version": "1.0", "accepted": true, "accepted_at": "2026-05-08T12:00:00Z" },
    { "id": 44, "consent_type": "cookies",          "version": "1.0", "accepted": true, "accepted_at": "2026-05-08T12:00:00Z" }
  ],
  "current_consent_version": "1.0"
}
```

Kolejność: `terms_of_service` → `privacy_policy` → `cookies`, identyczna z `INSERT INTO consent_log VALUES (...)` w `record_consent_bundle()` (migracja `20260508` linie 52–58 — INSERT trzech wierszy w tej kolejności w jednej INSERT statement, więc `id`-y rosnące w tej kolejności).

Stan faktyczny w `src/app/api/consent/route.ts:100-107`:

```typescript
const { data: inserted, error: selectError } = await supabase
  .from('consent_log')
  .select('id, consent_type, version, accepted, accepted_at')
  .eq('user_id', user.id)
  .eq('version', bundleBody.version)
  .in('consent_type', bundleBody.types)
  .order('accepted_at', { ascending: false })
  .limit(bundleBody.types.length);
```

`order: false` = DESC. Klient otrzymuje `inserted` w **odwrotnej** kolejności niż przykład API spec (`cookies` → `privacy_policy` → `terms_of_service`).

W praktyce — wszystkie trzy wiersze mają identyczne `accepted_at` (Postgres `now()` wewnątrz jednej transakcji = ten sam timestamp). Postgres nie gwarantuje stabilnej kolejności przy `ORDER BY` z duplikatami timestamp'a — może być dowolna. W praktyce indeksowanie po `id` daje DESC po `id`, co oznacza `cookies` (id=44) przed `terms_of_service` (id=42).

**Konsekwencje:**

- 🟡 **Klient front-endowy oczekujący stałej kolejności** (np. UI pokazujące „TOS / PP / cookies" z `inserted.map((row, i) => <Row key={row.id} title={titleFromIndex(i)} />)`) — pokaże nazwy „TOS" przy danych cookies. Bug wizualny.
- 🟡 **Test automatyczny weryfikujący odpowiedź endpointa** napisany na podstawie api-plan.md spec — fail (oczekuje TOS jako pierwszego, dostaje cookies).
- 🟢 Faktyczny stan zapisu w DB jest poprawny — to tylko niespójność reprezentacji odpowiedzi.

**Rozwiązanie (rekomendowane: opcja A):**

**Opcja A — kod podąża za spec'em:** zmienić `consent/route.ts:106` z `ascending: false` na `ascending: true` (lub `id ASC`):

```diff
-      .order('accepted_at', { ascending: false })
+      .order('id', { ascending: true })
```

Uzasadnienie: rosnące `id` zawsze daje stabilną i przewidywalną kolejność `terms_of_service` → `privacy_policy` → `cookies` (zgodnie z porządkiem INSERT-u w `record_consent_bundle`). Spec api-plan.md zostaje bez zmian.

**Opcja B — spec dopasowuje się do kodu:** zmienić przykład w api-plan.md §2.1 na DESC. Niezalecane, bo:
- Odwraca naturalny porządek dokumentów (TOS jest „pierwszą zgodą").
- Sortowanie po `accepted_at DESC` z duplikatami timestamp'ów jest niedeterministyczne — spec nie powinien zakładać kolejności, której DB nie gwarantuje.

**Rekomendacja:** Opcja A. Naprawia nieintuicyjną kolejność i deterministycznie matchuje spec API. Naprawa: jedna linia kodu.

---

### 2.5 (NOWY) `paddle/webhook/route.ts:127` rozpoznaje `customer.*` events, ale `lookup_user_id_by_email` nie ma uprawnień by przeczytać `auth.users.email` w trybie cold start z Paddle Sandbox

**Problem:**

`lookup_user_id_by_email` w migracji `20260509` linie 25–41:

```sql
create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;
$$;

revoke execute on function public.lookup_user_id_by_email(text) from public;
grant execute on function public.lookup_user_id_by_email(text) to service_role;
```

`SECURITY DEFINER` + owner = `postgres` → ma dostęp do `auth.users.email`. OK.
`grant execute … to service_role` → admin client (`createAdminClient()` w `paddle/webhook/route.ts:117`) może wywołać.

Test sandboxowy Paddle: payload eventu `customer.created` ma `data.email` jako top-level pole (zgodnie z dokumentacją Paddle Billing), ale **payload event dla `customer.created`** może nie mieć obu pól `data.email` ORAZ `data.customer.email` jednocześnie — schema Paddle jest:

```json
{
  "event_type": "customer.created",
  "data": {
    "id": "ctm_01...",
    "email": "user@example.com",
    "name": "..."
  }
}
```

Tj. dla `customer.*` events `data.email` jest top-level, ale `data.customer` jest **brak**. Kod handler'a:

```typescript
const email = data.customer?.email ?? data.email;
```

OK, fallback działa. Ale dla `subscription.*` events:

```json
{
  "event_type": "subscription.created",
  "data": {
    "id": "sub_01...",
    "customer": { "id": "ctm_01...", "email": "user@example.com" },
    ...
  }
}
```

Tu `data.customer.email` istnieje. Kod jest spójny.

**Realny problem: `/api/paddle/webhook` test** — kod używa `lookup_user_id_by_email` z emailem (krok 3 fallback), ale **`data.customer?.email`** w `customer.*` events może być `undefined`. Wtedy fallback do `data.email`. Jeśli oba `undefined` (sandbox payload bez emaila, np. test webhook z UI Paddle bez wypełnionego customer'a) — `email = undefined`, kontrola `if (email) {}` (linia 262) → false → fallthrough do `return null` → orphan log.

To nie jest bug, to oczekiwana ścieżka. Ale komentarz w kodzie (linie 263–266) sugeruje, że RPC pokrywa wszystkie cases:

```typescript
// RPC `lookup_user_id_by_email` (SECURITY DEFINER, service_role only) —
// skaluje się do dowolnej liczby użytkowników (problems-v6 §1.1). Zastępuje
// wcześniejsze `auth.admin.listUsers({ perPage: 200 })` które gubiło użytkowników
// poza pierwszą stroną paginacji.
```

To jest zgodność z poprzednim hardeningiem (problems-v6 §1.1). OK historycznie. Brakuje natomiast:
- W `api-plan.md` §2.1 linie 101–105 (Lookup użytkownika — kolejność priorytetów) — explicit notatki, że krok 3 (RPC) wymaga obecności emaila w payload Paddle, czego dla `customer.*` events Paddle nie zawsze zapewnia (sandbox testowy może wysyłać shorter payload).

**Konsekwencje:**

- 🟢 **Realne ryzyko**: niskie. Production payload Paddle Billing dla `customer.created` ma `data.email`. Sandbox test webhook może być uboższy, ale to test, nie prod.
- 🟢 **Test E2E payment flow** — implementator musi pamiętać, że trigger sandbox webhook bez `data.email` da `lookup` null → orphan log. Bez explicit doc tego w `api-plan.md` może to wyglądać jak bug.

**Rozwiązanie:**

Doprecyzować w `api-plan.md` §2.1 linie 101–105 (lista 1–4 priorytetów lookup) — dodać explicit, że krok 3 wymaga obecności jednego z dwóch pól w payload:

```diff
- 3. Fallback: `RPC public.lookup_user_id_by_email(p_email)` …
+ 3. Fallback: `RPC public.lookup_user_id_by_email(p_email)` z emailem z `data.customer?.email ?? data.email` (`SECURITY DEFINER`, `service_role only`, migracja `20260509000000_paddle_webhook_hardening.sql`). Wymaga, by przynajmniej jedno z dwóch pól było obecne w payload Paddle. Production payload `customer.created/updated` ma `data.email`; production payload `subscription.*` ma `data.customer.email`. Sandbox webhook test (Paddle Dashboard → Webhooks → „Send test event") może wysyłać payload bez wypełnionego emaila — wtedy fallthrough do kroku 4 (orphan log).
```

Niska pilność, ale ułatwia debug pierwszego pre-launch test'u Paddle.

---

## 3. 🟢 Drobne

### 3.1 (CARRY-FORWARD z v9 §2.3) `architecture-base.md` §20 linia 1302 — `window.devicePixelRatio` w prozie

Eskalowane do §2.3 v10 z dokładną proponowaną edycją.

---

### 3.2 (NOWY) `tech-stack.md` §11.1 linia 261 — `commitlint.config.cjs`, faktyczny plik to `commitlint.config.mjs`

**Problem:**

`tech-stack.md` §11.1 (linia 261, sekcja „Wymagane pliki"):

> - `commitlint.config.cjs` (extends `@commitlint/config-conventional`)

Stan faktyczny:

```bash
$ ls /Users/mateuszhadrian/Projects/welder-doc-app/commitlint.config.*
commitlint.config.mjs
```

Plik ma rozszerzenie `.mjs` (ESM), używa `export default`:

```javascript
const config = {
  extends: ['@commitlint/config-conventional']
};

export default config;
```

CJS-vs-ESM dla commitlint configa nie ma praktycznego znaczenia — `@commitlint/cli` rozumie oba. Ale dokumentacja powinna odpowiadać kodowi.

**Rozwiązanie:**

```diff
- - `commitlint.config.cjs` (extends `@commitlint/config-conventional`)
+ - `commitlint.config.mjs` (extends `@commitlint/config-conventional`)
```

---

### 3.3 (NOWY) PRD §1 linia 10 — Konva.js as canonical canvas engine, mimo że architektura ma `canvas-kit` boundary

**Problem:**

PRD §1 linia 10:

> **Frontend:** Next.js (App Router), React, TypeScript, Konva.js (via `react-konva`), Zustand + Immer (zarządzanie stanem), Tailwind CSS, Lucide React (ikony)

PRD §3.3 linia 69:

> Silnik 2D: Konva.js implementowany przez `react-konva`.

Stan faktyczny: architecture-base.md §1 linia 14, §22 (cała sekcja) — Konva ukryta za `src/canvas-kit/` boundary; wymienialna na PixiJS bez modyfikacji domeny. PRD nie wspomina o tej abstrakcji.

**Konsekwencje:**

- 🟢 **PRD jest dokumentem produktowym, nie architektonicznym** — nie musi opisywać szczegółów impl. Ale dla niezgodności technologii (np. „aplikacja używa PixiJS" w przyszłości) PRD wciąż mówiłby Konva. Ten drift jest do zaakceptowania pre-launch; do uaktualnienia post-MVP gdy pojawi się decyzja o silniku PixiJS.
- 🟢 Implementator nowy w projekcie — czyta PRD najpierw, otrzymuje literalnie „Konva to silnik canvas", potem czyta architecture-base.md §22 i widzi „nie, używaj `@/canvas-kit`". Dwa rounds onboardingu.

**Rozwiązanie (opcjonalne, niska pilność):**

W PRD §1 linia 10 i §3.3 linia 69 dodać krótką notkę:

```diff
- **Frontend:** Next.js (App Router), React, TypeScript, Konva.js (via `react-konva`), Zustand + Immer …
+ **Frontend:** Next.js (App Router), React, TypeScript, Konva.js (via `react-konva`; ukryta za `src/canvas-kit/` — patrz `architecture-base.md` §22), Zustand + Immer …
```

```diff
- - Silnik 2D: Konva.js implementowany przez `react-konva`.
+ - Silnik 2D: Konva.js implementowany przez `react-konva`, hermetycznie ukryta za warstwą `@/canvas-kit` (architecture-base.md §22) — kod domeny (shape Rendererzy, eksport, pointer input) nie zna konkretnego silnika; wymiana na PixiJS sprowadza się do nowej impl `src/canvas-kit/impl-pixi/` bez refactoringu domeny.
```

Niska pilność. Ułatwia onboarding post-implementation.

---

### 3.4 (NOWY) `CLAUDE.md` „intentionally deferred" mówi „branding (palette, fonts, logo, favicon)", ale Inter font już zwoolany przez `next/font/google`

**Problem:**

`CLAUDE.md` linia 99:

> Per `.ai/init-project-setup-analysis.md` §4: cloud Vercel/Supabase/Paddle hookup, production domain, branding (palette, fonts, logo, favicon), Sentry, LICENSE, branch protection, Lighthouse CI, and `experimental.reactCompiler`. Don't add these without a corresponding task — they are tracked.

Stan faktyczny `src/app/[locale]/layout.tsx:9-13`:

```typescript
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap'
});
```

Plus `src/app/globals.css:7` zawiera `--font-sans: var(--font-inter), …` i body używa `font-family: var(--font-sans)`. Inter jest już aktywnie używany.

`globals.css:5` ma komentarz:

> /* Branding tokens placeholder — uzupełnione w fazie designu frontendu (analiza §4.7) */

Czyli autor projektu wybrał Inter jako placeholder do późniejszego zastąpienia, ale CLAUDE.md wciąż listuje „fonts" jako deferred — niespójność.

**Konsekwencje:**

- 🟢 Niska. Inter jest typograficznym fallbackiem, akceptowalnym do pre-launch. CLAUDE.md wprowadza w błąd implementatora który chce dodać brand-specific font (np. Manrope) — może zacząć debugować „skąd ten Inter, jeśli fonts są deferred".

**Rozwiązanie:**

Doprecyzować w CLAUDE.md linia 99:

```diff
- Per `.ai/init-project-setup-analysis.md` §4: cloud Vercel/Supabase/Paddle hookup, production domain, branding (palette, fonts, logo, favicon), Sentry, LICENSE, branch protection, Lighthouse CI, and `experimental.reactCompiler`.
+ Per `.ai/init-project-setup-analysis.md` §4: cloud Vercel/Supabase/Paddle hookup, production domain, branding (palette, brand-specific fonts beyond the current `Inter` placeholder, logo, favicon), Sentry, LICENSE, branch protection, Lighthouse CI, and `experimental.reactCompiler`.
```

Niska pilność. Naprawa: 1 linia CLAUDE.md.

---

### 3.5 (USUNIĘTE — false alarm) `i18n/navigation.ts`

Pierwotny szkic v10 sugerował, że plik jest pusty stub. Weryfikacja `src/i18n/navigation.ts:1-4` pokazuje pełną implementację `createNavigation(routing)` z eksportem `Link`, `redirect`, `usePathname`, `useRouter`, `getPathname`. Punkt nieaktualny, **brak akcji**.

---

### 3.6 (CARRY-FORWARD z v8 §3.x, v9 §3.5) Drobne kosmetyki bez akcji

| # | Tytuł | Status |
|---|---|---|
| v8 §3.1 | `e2e/smoke.spec.ts` literał `'WelderDoc'` | Bez zmian; akceptowalne dopóki `App.title` to `'WelderDoc'` |
| v8 §3.2 | `getContext('2d')` w `tests/smoke.test.ts` | Bez zmian |
| v8 §3.3 | `vitest.config.ts` `**/index.ts` w coverage exclude | Bez zmian |
| v8 §3.5 | Brak rozróżnienia auth-level w architecture §3 | Bez zmian; api-plan.md §3 jest source of truth |
| v8 §3.6 | Brak explicitu o `reactStrictMode` rationale | Bez zmian |
| v8 §3.7 | `consent_log.ip_address: unknown` w database.ts | Bez zmian |
| v8 §3.8 | `octet_length(data::text)` perf | Bez zmian |
| v8 §3.9 | `next.config.ts` brak webpack fallback | Bez zmian |
| v9 §3.1 | Migracja 20260507 outdated SQL line comment | Bez zmian; SQL line comment ≠ pg_description, więc nie wycieka |

Wszystkie bez akcji w v10. Łącznie 9 carry-forwardów drobnych, niska pilność.

---

## 4. Rekomendacje priorytetowe (lista działań)

### Pre-merge do `main` / przed kolejną sesją Claude (PILNE):

1. **§1.1 v10** — Naprawić `CLAUDE.md` linia 18 + `db-plan.md` §5.12a (czwarta migracja `20260510000000`). **Mechaniczna edycja, ~3 linie tekstu, naprawia drift wprowadzony naprawą v9 §1.1.**
2. **§1.2 v10** — Usunąć `@eslint/eslintrc` z `package.json` + tech-stack.md §11.1 i §15. **5–10 minut + `pnpm install`.**

### W trakcie hardening API / pre-launch:

3. **§2.1 v10** — Zaktualizować `architecture-base.md` §15 i `db-plan.md` §1.2 (dwa kanały bypass'a `block_protected_columns_update`).
4. **§2.2 v10** — Doprecyzować w `api-plan.md` §2.1 chicken-and-egg `customer.created` vs `subscription.created` + dodać do `architecture-base.md` §16 wymóg `customData.user_id` w Paddle Checkout.
5. **§2.3 v10** — Naprawić `architecture-base.md` §20 linia 1302 (`window.devicePixelRatio` → `devicePixelRatio()`).
6. **§2.4 v10** — Zmienić `consent/route.ts:106` na `.order('id', { ascending: true })` (zgodne z api-plan.md spec).
7. **§2.5 v10** — Doprecyzować w `api-plan.md` §2.1 (Lookup użytkownika krok 3) wymaganie obecności emaila w payload.

### Drobne (niska pilność):

8. **§3.2 v10** — `commitlint.config.cjs` → `.mjs` w tech-stack.md §11.1.
9. **§3.3 v10** — Krótka notka o `canvas-kit` boundary w PRD §1 i §3.3.
10. **§3.4 v10** — Doprecyzować CLAUDE.md o Inter jako placeholder (a nie deferred-completely).
Carry-forwardy drobne (§3.6) — bez akcji. §3.5 — false alarm, bez akcji.

---

## 5. Podsumowanie

**Cykl v9 → v10 to najlepszy wynik tempa naprawiania w historii analizy** (9/13 problemów v9 naprawionych, w tym **wszystkie krytyczne** i większość istotnych). W szczególności:

- v9 §1.1 (`pg_description` mówi service_role) → naprawione przez nową migrację `20260510000000_fix_consent_version_comment.sql`.
- v9 §1.2 (proxy.ts „currently stubbed") → naprawione w CLAUDE.md.
- v9 §2.1 (kody błędów dla malformed JSON) → naprawione (consent route ma teraz `'invalid_payload'`).
- v9 §2.2 (silent fallback w consent route) → naprawione (jawny check `profileError`).
- v9 §2.4 (duplicate `Point` export) → naprawione.
- v9 §2.5 (brak skryptów `supabase:types:local` + `prepare`) → naprawione.
- v9 §2.6 (tech-stack.md nie pokrywa narzędzi) → naprawione.
- v9 §3.2 (silent return w paddle webhook) → naprawione (rich console.warn).
- v9 §3.3 (`block_protected_columns_update` opisany niekompletnie) → naprawione w arch §15.
- v9 §3.4 (`vercel.json` snippet bez `$schema`) → naprawione.
- v9 §3.6 (`lint` script niezgodny) → naprawione.

**Nowe problemy v10** są pomniejszej skali — wynikają głównie z:
- Drift'u wprowadzonego naprawami v9 (§1.1 v10 — czwarta migracja nieudokumentowana).
- Subtelniejszych niespójności konfiguracyjnych (§1.2 v10 — `@eslint/eslintrc` bez użycia).
- Edge case'ów dokumentacyjnych w warstwie webhook/consent (§2.1, §2.2, §2.4, §2.5 v10).

**Trend pozytywny:** projekt zbliża się do stanu, w którym dokumentacja i kod są (prawie) jeden source of truth. Zostało ~5 mechanicznych edycji (w sumie ~30 linii) by zlikwidować ostatnie 🔴/🟡 punkty drift'u przed startem implementacji domeny shape'ów. Drobne kosmetyki (§3.x v10) można puścić jako carry-forward bez utraty jakości.

**Zalecenie strategiczne:** W kolejnym cyklu (v11) skupić się na **post-implementation gap analysis** — co zostało dorzucone w `src/shapes/`, `src/store/slices/`, `src/components/canvas/` i czy dokumenty zostają z nim w synchronie. Cykl v8 → v9 → v10 wyczyścił warstwę API + DB + bootstrap. Następna fala driftów najpewniej pojawi się przy pierwszych implementacjach kształtów (PlateShape, plate handles, PlateRenderer w canvas-kit boundary).
