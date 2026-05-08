# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v6)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 6.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/db-supabase-migrations.md`, `.ai/code-documentation-problems-v5.md`, kod w `src/`, `supabase/migrations/{20260507000000_complete_schema,20260508000000_record_consent_bundle}.sql`, `supabase/config.toml`, `vercel.json`, `tsconfig.json`, `package.json`, `eslint.config.mjs`, `vitest.config.ts`, `next.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `scripts/verify-routes.sh`, `CLAUDE.md`.
>
> **Stan projektu (2026-05-08):** post-bootstrap, pre-implementation domeny shape'ów. Warstwa API (Route Handlers) **została zaimplementowana** od czasu v5 — wszystkie 5 endpointów (`/api/health`, `/api/consent`, `/api/user/export`, `/api/paddle/webhook`, `/api/cron/{expire-subscriptions,cleanup-webhook-events}`) istnieje. Schemat DB (migracja `20260507000000_complete_schema.sql`) jest gotowy, dodano migrację `20260508000000_record_consent_bundle.sql` (atomowy bundle consent). Logika domeny (shapes, weld-units, store slices, components canvas) wciąż nie istnieje.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, powodujący błąd produkcyjny lub silnie wprowadzający w błąd implementatora.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru.
> - 🟢 **Drobne** — niespójności, kosmetyczne, niska pilność.

---

## 0. Status problemów z v5

| # v5 | Tytuł | Status (v6) | Komentarz |
|---|---|---|---|
| 1.1 | Brak Route Handlerów (cron × 2 + Paddle webhook + consent + user/export) | ✅ **Naprawione (z zastrzeżeniem)** | Wszystkie 5 plików istnieje pod `src/app/api/`; `scripts/verify-routes.sh` dodany. **ALE:** skrypt nie jest wywoływany w `.github/workflows/ci.yml` — patrz nowy §1.3. |
| 1.2 | `/api/health` divergence od kontraktu | ✅ **Naprawione** | `src/app/api/health/route.ts` zwraca `{ status, timestamp }` lub 503 z `checks: { database: 'unreachable' }`. Bez wycieku `error.message`. Zgodne z `api-plan.md` §2.1. |
| 2.1 | `db-supabase-migrations.md` granular vs `FOR ALL` | ✅ **Naprawione** | `db-supabase-migrations.md` linia 38–40 zaktualizowana zgodnie z Opcją A z v5 — granular per-rola, `FOR ALL` dozwolone gdy `USING/WITH CHECK` identyczne. |
| 2.2 | `tech-stack.md` §13 nieaktualny opis `SUPABASE_SERVICE_ROLE_KEY` | ✅ **Naprawione** | `tech-stack.md` §13 (linia 284) wymienia 4 użycia: paddle webhook, oba crony, `/api/consent` (RPC). |
| 2.3 | `pnpm supabase:types` nie auto-ładuje `.env.local` | ✅ **Naprawione** | `package.json:20` używa `dotenv -e .env.local --` wrappera; `dotenv-cli` w `devDependencies`. |
| 2.4 | `proxy.ts` matcher wyklucza `/api`, niespójność architektury | ✅ **Naprawione** | `architecture-base.md` §16 (linia 1235) jawnie dokumentuje wyłączenie `/api/*` z `proxy` i wymóg `auth.getUser()` w handlerze. `proxy.ts` ma analogiczny komentarz (linia 16–19). |
| 2.5 | `proxy.ts` cookie-copy destrukturyzacja | ✅ **Naprawione** | `proxy.ts:29-31` używa `intlResponse.cookies.set(cookie)` z całym obiektem `ResponseCookie`. |
| 2.6 | `AllShapeGeometry = {}` scaffold — brak hard-stopu w CI | ✅ **Naprawione** | `tests/store/shape-update-contract.test.ts` jest contract testem: zielony przy pustym registry; po dodaniu pierwszego kształtu wymaga aktualizacji `AllShapeGeometry`. |
| 2.7 | `/api/consent` bundle insert + `current_consent_version` UPDATE non-atomic | ✅ **Naprawione** | Migracja `20260508000000_record_consent_bundle.sql` zawiera `record_consent_bundle()` (`SECURITY DEFINER`); handler `/api/consent` wywołuje RPC dla bundla. Jedna transakcja DB. |
| 3.1 | `consent_log.ip_address: unknown` w generowanych typach | 🟢 **Wciąż aktywne (workaround udokumentowany)** | `src/types/database.ts:43` ma `ip_address: unknown`. Wrapper `ConsentLogRow` z `db-plan.md` §1.6 nie został utworzony — `/api/consent` write path go nie potrzebuje (TypeScript akceptuje `string` do `unknown`); wrapper będzie potrzebny przy pierwszym SELECT-cie z odczytem IP. |
| 3.2 | E2E smoke heading bez i18n awareness | 🟢 **Wciąż OK** | Bez zmian. |
| 3.3 | `vitest-canvas-mock` weak assertion w smoke teście | 🟢 **Wciąż OK** | Bez zmian. |
| 3.4 | Test co-location vs `tests/` directory | ✅ **Naprawione** | `architecture-base.md` §3 (linia 183–187) zawiera komentarz dopuszczający oba wzorce. Kod stosuje obie konwencje (`src/lib/ipAnonymize.test.ts` co-locowany; `tests/store/shape-update-contract.test.ts`, `tests/smoke.test.ts` w `tests/`). |
| 3.5 | `canvas-kit/index.ts` eksportuje `CanvasPointerHandler` poza spec | ✅ **Naprawione** | `architecture-base.md` §22.1 (linia 1480–1485) wymienia teraz pełną listę typów props + `RasterizeOptions` + `CanvasPointerHandler`. |
| 3.6 | `proxy.ts` `?? NextResponse.next()` dead code | ✅ **Naprawione** | `proxy.ts:35` ma czyste `return supabaseResponse;`. |
| 3.7 | `architecture-base.md` §17 redirect na `user.locale` nieimplementowane | ✅ **Częściowo naprawione (dokumentacja)** | `CLAUDE.md` linia 84–88 dodał wpis „PR checklist for auth implementation (US-002 sign-in)". Implementacja wciąż TODO przy US-002, ale wiarygodnie wyraźna. |
| 3.8 | `tsconfig.json` `compilerOptions.types: ["vitest/jsdom"]` ogranicza auto-load `@types/*` | ✅ **Naprawione** | `tsconfig.json` nie zawiera `compilerOptions.types`. `globals: true` + `import 'vitest-canvas-mock'` w setup wystarczają (Opcja B z v5). `tech-stack.md` §9 (linia 207) ma odpowiednio zaktualizowany komentarz. |

**Wniosek:** **14 z 16 problemów v5 naprawionych** (vs 9/14 w v4 → v5). Pozostałe 2 to świadomy workaround (3.1) i akceptowalne stany pre-implementation (3.2 / 3.3). Najbardziej wartościowy delta: cała warstwa API (5 route handlerów + atomowa migracja consent) zaimplementowana w jednej iteracji zgodnie ze spec'em.

Poniżej: **nowe problemy zidentyfikowane w v6** oraz dwie pozostawione drobne pozycje z v5.

---

## 1. 🔴 Krytyczne

### 1.1 (NOWY) `auth.admin.listUsers({ perPage: 200 })` w Paddle webhook lookupUserId — silent failure dla > 200 użytkowników

**Problem:**

`src/app/api/paddle/webhook/route.ts:223-227` (funkcja `lookupUserId`, fallback po email):

```typescript
const email = data.customer?.email ?? data.email;
if (email) {
  // auth.users nie jest wystawione przez PostgREST; użyć Admin Auth API.
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const match = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (match) return match.id;
}
```

Implementacja wczytuje **tylko pierwszą stronę 200 użytkowników** i przeszukuje ją liniowo. Po przekroczeniu 200 zarejestrowanych użytkowników w bazie:
- Webhook dla nowo zarejestrowanego usera (powyżej 200. pozycji w paginacji) **nie znajdzie go** przez fallback emailowy.
- Funkcja zwróci `null`, `subscription` zostanie zapisany z `user_id = NULL`.
- Trigger `trg_subscriptions_refresh_plan` (`subscriptions_after_iu_refresh_plan`) sprawdza `if new.user_id is not null then perform refresh_user_plan_from_subscriptions(...)` → **nie wywoła refreshu** dla orphan record.
- **Konsekwencja:** US-045 silently fails dla nowych użytkowników po przekroczeniu progu — klient zapłacił, plan nie zaktualizowany. Webhook events trafia do `webhook_events.processed_at = NOW()`, więc nie ma sygnału błędu.

**Kontekst spec:**

`api-plan.md` §2.1 linia 100–104:
> Lookup użytkownika (kolejność priorytetów):
> 1. `payload.data.customData.user_id` — przekazywane z Paddle Checkout
> 2. Fallback: `user_profiles WHERE paddle_customer_id = payload.data.customer.id`
> 3. Fallback: `auth.users WHERE email = payload.data.customer.email`
> 4. Jeśli user nie znaleziony → zapisz `webhook_event`, zaloguj warning, zwróć 200

Spec mówi **"`auth.users WHERE email = ...`"** — tj. bezpośrednie zapytanie SQL. Implementacja używa Admin Auth API z paginacją, co jest poprawnym pomysłem (PostgREST nie eksponuje `auth.users` domyślnie), ale **bez paginacji** lub z niewystarczającym limitem.

**Konsekwencje:**

- 🔴 **Krytyczne dla produkcji.** Próg 200 użytkowników jest realistyczny w pierwszych miesiącach po launchu. Cisza nie sygnalizuje problemu, dopóki user nie zgłosi „kupiłem Pro a nadal jestem Free".
- Bez warning logu (patrz §3.5) dryf jest niewykrywalny w monitoringu.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** zastąpić `listUsers` bezpośrednim zapytaniem SQL przez admin client. `auth.users` nie jest w schemacie `public`, więc PostgREST go nie wystawia, ale można dodać do funkcji DB (`SECURITY DEFINER`) wrapper, np.:

```sql
-- nowa migracja: 2026XXXX_lookup_user_by_email.sql
create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

grant execute on function public.lookup_user_id_by_email(text) to service_role;
```

Handler:
```typescript
const { data: userId } = await supabase.rpc('lookup_user_id_by_email', { p_email: email });
if (userId) return userId;
```

Skaluje się do dowolnej liczby użytkowników, jednoznaczne SQL semantyki, `security definer` izoluje dostęp.

**Opcja B (krótkoterminowa):** zwiększyć `perPage` do np. `1000` i akceptować limit. Wciąż się złamie, tylko później.

**Opcja C (wymuszenie kontraktu):** wymagać `customData.user_id` na każdym checkoutie i odrzucać webhooki bez niego (HTTP 400). Wymaga audytu kodu klienta Paddle Checkout (`@paddle/paddle-js`) i upewnienia się, że `customData: { user_id }` jest zawsze przekazywane (api-plan.md §2.2 linia 808–810 to opisuje, ale nie egzekwuje).

**Rekomendacja:** **Opcja A + Opcja C jako defense-in-depth.** Funkcja DB rozwiązuje skalowanie, kontrakt na `customData.user_id` redukuje liczbę przypadków, w których fallback emailowy w ogóle jest potrzebny (powinien być rzadkim ratunkiem na rejestrację po checkoucie, nie standardową ścieżką).

---

### 1.2 (NOWY) `subscriptions_after_iu_refresh_plan` nie odpala się dla orphan `user_id = NULL`

**Problem:**

`supabase/migrations/20260507000000_complete_schema.sql:207-219`:

```sql
create or replace function public.trg_subscriptions_refresh_plan()
returns trigger
...
as $$
begin
  if new.user_id is not null then
    perform public.refresh_user_plan_from_subscriptions(new.user_id);
  end if;
  return new;
end;
$$;
```

Logika: wrapper triggera odpala `refresh_user_plan_from_subscriptions(user_id)` tylko gdy `user_id IS NOT NULL`.

W połączeniu z §1.1 (paddle webhook może zapisać subscription z `user_id = NULL` gdy lookup zawodzi), powstaje stan, w którym:
1. Webhook upserts `subscriptions` z `user_id = NULL`, `status = 'active'`, `plan_tier = 'pro_monthly'`.
2. Trigger nie odpala refreshu (bo `user_id IS NULL`).
3. Wpis pozostaje orphan w `subscriptions`.
4. Gdy później (np. ręcznie lub przez kolejny webhook `customer.updated`) `user_id` zostaje uzupełnione przez `UPDATE subscriptions SET user_id = ... WHERE paddle_subscription_id = ...` — **trigger nie odpali się**, bo `subscriptions_after_iu_refresh_plan` jest wywoływane tylko dla `OF status, current_period_end` (linia 412):

```sql
create trigger subscriptions_after_iu_refresh_plan
  after insert or update of status, current_period_end on public.subscriptions
  ...
```

Aktualizacja tylko `user_id` nie odpala refreshu. Konsekwencja: nawet po naprawie orphan recordu, `user_profiles.plan` pozostaje stale `'free'` aż do następnego webhook `subscription.updated` lub manual refresh.

**Konsekwencje:**

- 🔴 Współpraca z §1.1: nawet **odzyskanie** orphan recordu (poprzez ręczny `UPDATE subscriptions SET user_id = ...`) nie naprawi `user_profiles.plan`.
- Nie ma sygnału w logach, że stan jest niespójny — DB pozostaje gotowa na dalsze webhooki, ale `effective_plan(uid)` zwraca `'pro'` (bo subscription istnieje), a `user_profiles.plan` mówi `'free'`.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** rozszerzyć listę kolumn w triggerze o `user_id`:

```sql
create trigger subscriptions_after_iu_refresh_plan
  after insert or update of status, current_period_end, user_id on public.subscriptions
  ...
```

I usunąć wcześniejszy guard `if new.user_id is not null` — niech `refresh_user_plan_from_subscriptions(NULL)` no-op (lub guard'em na update gdzie `user_id` faktycznie się zmienia).

Lepszy wariant funkcji wrappera:
```sql
create or replace function public.trg_subscriptions_refresh_plan()
returns trigger
...
as $$
begin
  -- Refresh dla nowego user_id, jeśli ustawione
  if new.user_id is not null then
    perform public.refresh_user_plan_from_subscriptions(new.user_id);
  end if;
  -- Refresh dla starego user_id, jeśli zmienił się (recovery z orphan)
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id and old.user_id is not null then
    perform public.refresh_user_plan_from_subscriptions(old.user_id);
  end if;
  return new;
end;
$$;
```

**Opcja B:** dokumentować w `api-plan.md` § "Recovery procedures" instrukcję, że ręczne łatanie orphan recordów wymaga jawnego `SELECT public.refresh_user_plan_from_subscriptions(uid)` po update'cie. Operacyjnie kruche — zapomni się.

**Rekomendacja:** Opcja A. Jednorazowa migracja: `2026XXXX_subscription_trigger_user_id.sql` z `DROP TRIGGER` + `CREATE TRIGGER` + nową funkcją wrappera. Eliminuje cały klas problemów rekoncyliacji.

---

### 1.3 (NOWY) `pnpm verify:routes` istnieje w `package.json`, ale nie jest wywoływany w CI workflow

**Problem:**

V5 §1.1 rekomendowała: „dodać `pnpm verify:routes` jako bramkę CI". Stan po implementacji:
- `package.json:21` ma `"verify:routes": "bash scripts/verify-routes.sh"`.
- `scripts/verify-routes.sh` istnieje i działa: weryfikuje obecność `vercel.json crons[].path` w `src/app/`, obecność paddle webhook, consent, user/export, health.
- **`.github/workflows/ci.yml` nie wywołuje `pnpm verify:routes`** w żadnym jobie.

```yaml
# .github/workflows/ci.yml — relevantny fragment
jobs:
  lint-and-typecheck:
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      # BRAK: - run: pnpm verify:routes
  unit-tests: ...
  e2e-mandatory: ...
  e2e-informational: ...
```

**Konsekwencje:**

- Bramka istnieje fizycznie, ale jest **martwa** — żaden PR nie wymusza obecności wymaganych route handlerów. Dziś wszystkie istnieją (bo dodano je w jednej iteracji), ale przy przyszłych refaktoringach (np. ktoś usunie `/api/cron/cleanup-webhook-events/route.ts` myśląc, że nie jest używany) skrypt ostrzeżenia nie wygeneruje.
- `CLAUDE.md` linia 64–73 zawiera ręczny PR checklist, ale „**checklista jest manualna — nie ma automatycznej bramki w CI**" (cytat z v5 §1.1) — wciąż prawda, bo skrypt nie jest wpięty.
- Manualna ścieżka deploya na Vercel uderzy w 404 dla brakujących cronów; produkcyjny incydent będzie widoczny dopiero po pierwszym scheduled cron run.

**Rozwiązanie:**

Dopisać krok w `lint-and-typecheck` (lub osobny job `verify-routes`):

```yaml
jobs:
  lint-and-typecheck:
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
+     - run: pnpm verify:routes
```

Skrypt jest tani (~50 linii bash + node), nie wymaga sieci, nie zwiększa zauważalnie czasu CI. Hard-stop merge w razie regresji.

**Rekomendacja:** dopiąć w obecnej iteracji. Jednolinijkowa zmiana, zamyka regresję wykrytą jako pochodną v5.

---

## 2. 🟡 Istotne

### 2.1 (NOWY) Paddle webhook handler — `count: 'exact'` na `INSERT` jest no-op + dead code branch

**Problem:**

`src/app/api/paddle/webhook/route.ts:114-139`:

```typescript
const { data: insertedEvents, error: idemError } = await supabase
  .from('webhook_events')
  .insert(
    {
      provider: 'paddle',
      external_event_id: eventId,
      event_type: eventType,
      payload: payload as unknown as Json,
    },
    { count: 'exact' }   // ← bezsensowne dla INSERT
  )
  .select('id');

if (idemError) {
  const message = idemError.message ?? '';
  if (message.includes('duplicate key value') || idemError.code === '23505') {
    return NextResponse.json({ received: true, duplicate: true });
  }
  return err('internal_error', 500, message);
}

if (!insertedEvents || insertedEvents.length === 0) {
  // ← dead code: jeśli idemError === null, INSERT się powiódł i .select('id') zwróci row
  return NextResponse.json({ received: true, duplicate: true });
}
```

**Bugi:**

1. **`count: 'exact'`** — opcja `count` w supabase-js działa wyłącznie dla `SELECT`. Dla `INSERT` jest cicho ignorowana. Nie pomaga w idempotencji ON CONFLICT.

2. **Dead code branch `if (!insertedEvents || insertedEvents.length === 0)`** — INSERT bez `idemError` zawsze zwraca wstawione wiersze przy `.select('id')`. Branch nigdy się nie wykona.

3. **Mechanika idempotencji oparta na `error.code === '23505'`** jest fragile. Idiomatyczny wzorzec supabase-js:

```typescript
const { data, error } = await supabase
  .from('webhook_events')
  .upsert(
    { provider: 'paddle', external_event_id: eventId, event_type: eventType, payload },
    { onConflict: 'provider,external_event_id', ignoreDuplicates: true }
  )
  .select('id');

// data === [] gdy konflikt (row już istniał); data === [{ id: ... }] gdy INSERT
const isDuplicate = !data || data.length === 0;
```

**Konsekwencje:**

- Kod działa, ale ma niewykonywaną gałąź i bezsensowny argument. Czytelnik podejrzewa, że `count: 'exact'` lub null-check robią coś istotnego, podczas gdy są szumem.
- Odporność na zmiany w supabase-js: dziś `error.code === '23505'` jest stabilnym kontraktem PostgREST/Postgres; przy upgrade'ach minor mogą zmienić formatowanie. `upsert(...)` z `ignoreDuplicates` jest abstrakcją wyższego poziomu.

**Rozwiązanie:** zrefaktoryzować do `upsert + ignoreDuplicates`:

```typescript
const { data: insertedEvents, error: insertError } = await supabase
  .from('webhook_events')
  .upsert(
    {
      provider: 'paddle',
      external_event_id: eventId,
      event_type: eventType,
      payload: payload as unknown as Json,
    },
    { onConflict: 'provider,external_event_id', ignoreDuplicates: true }
  )
  .select('id');

if (insertError) {
  return err('internal_error', 500, insertError.message);
}

if (!insertedEvents || insertedEvents.length === 0) {
  // ignoreDuplicates: konflikt → pusta tablica → cichy duplikat
  return NextResponse.json({ received: true, duplicate: true });
}
```

To eliminuje `count: 'exact'`, dead code, i fragile error-code matching jednocześnie.

**Rekomendacja:** refactor w obecnej iteracji. Jednorazowa zmiana ~10 linii, poprawia czytelność i odporność.

---

### 2.2 (NOWY) `processed_at` UPDATE w paddle webhook nie jest transakcyjny z głównym dispatchem

**Problem:**

`src/app/api/paddle/webhook/route.ts:143-158`:

```typescript
try {
  if (eventType.startsWith('subscription.')) {
    await handleSubscriptionEvent(supabase, data);
  } else if (eventType.startsWith('customer.')) {
    await handleCustomerEvent(supabase, data);
  }
} catch {
  return err('internal_error', 500);
}

if (eventRowId !== undefined) {
  await supabase
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', eventRowId);
}
```

Trzy odrębne wywołania PostgREST w sekwencji, **bez transakcji wspólnej**:
1. `INSERT INTO webhook_events ...` (idempotencja).
2. `handleSubscriptionEvent` / `handleCustomerEvent` → `UPSERT INTO subscriptions` lub `UPDATE user_profiles`.
3. `UPDATE webhook_events SET processed_at = NOW() WHERE id = ...`.

**Stan po częściowej awarii:**

- Sukces 1, sukces 2, awaria 3 (timeout sieciowy do PostgREST):
  - `webhook_events` ma row, ale `processed_at IS NULL`.
  - `subscriptions` zawiera upsert ✓.
  - **Paddle retry'uje webhook** (odpowiedź nie wróciła w czasie albo serwer zwrócił niepoprawny status).
  - Drugie wywołanie: krok 1 → 23505 → `ignoreDuplicates` → krok 2 wykonuje się **ponownie** (idempotentny upsert na `paddle_subscription_id` — bezpieczny), `processed_at` znów może paść.
  - Dopóki Paddle nie przestanie retryować, wpis `processed_at IS NULL` pozostaje. Gdy Paddle się podda, mamy „przeprocesowane" event z `processed_at IS NULL` w bazie.

- Sukces 1, awaria 2 (np. `subscriptions.upsert` zwraca błąd przed dispatch'em):
  - `handleSubscriptionEvent` rzuca → `try/catch` → 500.
  - `webhook_events` ma row, `processed_at IS NULL`.
  - **Paddle retry'uje** → krok 1 zwraca duplikat → handler **return 200 `{ duplicate: true }`** (bez retry'owania kroku 2).
  - **Stan: subscription zostaje niezaktualizowane na zawsze.** Plan użytkownika nie aktualizuje się.

**Druga awaria jest poważniejsza** — idempotencja webhook_events działa **przeciwko nam**: gdy faktyczny dispatch padł, Paddle retry'uje, ale my odrzucamy retry jako duplikat.

**Konsekwencje:**

- 🟡 Cicha utrata zdarzeń webhookowych przy częściowych awariach. Skala zależy od stabilności Supabase REST API (rzadko, ale ciche).
- `processed_at IS NULL` jako sygnał „event nie został przeprocesowany" zostaje zaszumiony — niektóre rowy są takie z powodu ostatniej awarii, niektóre z powodu starszych. Brak monitoring/alertu.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** odwrócić kolejność operacji:

```typescript
// 1. Najpierw try/catch wokół dispatchu — zanim wpiszemy webhook_events
try {
  if (eventType.startsWith('subscription.')) {
    await handleSubscriptionEvent(supabase, data);
  } else if (eventType.startsWith('customer.')) {
    await handleCustomerEvent(supabase, data);
  }
} catch (e) {
  // Dispatch padł — NIE wpisuj idempotency markera, pozwól Paddle retryować.
  return err('internal_error', 500);
}

// 2. Sukces dispatchu → wpisz idempotency marker z processed_at = now() w jednym INSERT
const { data: insertedEvents } = await supabase
  .from('webhook_events')
  .upsert(
    {
      provider: 'paddle',
      external_event_id: eventId,
      event_type: eventType,
      payload: payload as unknown as Json,
      processed_at: new Date().toISOString(),
    },
    { onConflict: 'provider,external_event_id', ignoreDuplicates: true }
  )
  .select('id');
```

Konsekwencje:
- Jeśli dispatch zadziała ale wpis idempotency padnie → Paddle retry'uje, dispatch wykona się drugi raz (idempotentny upsert na `subscriptions.paddle_subscription_id` bezpieczny). Eventually wpis idempotency się uda.
- Jeśli dispatch padnie → Paddle retry'uje, prawidłowo.

To rozwiązuje główny problem: utrata webhook'a po częściowej awarii.

**Opcja B:** transakcja DB obejmująca wszystko — wymagałoby `SECURITY DEFINER` funkcji `process_paddle_webhook(p_payload jsonb)` która łączy idempotencję + dispatch w jednej transakcji. Solidne, ale wymaga przeniesienia całej logiki Paddle do PL/pgSQL — duża zmiana.

**Opcja C:** zostawić jak jest, ale dodać monitoring `webhook_events.processed_at IS NULL` po `received_at < now() - interval '1 hour'` jako sygnał alertu. Akceptujemy ryzyko utraty event'ów do momentu detekcji.

**Rekomendacja:** Opcja A. Eliminuje ścieżkę cichej utraty zdarzenia bez radykalnej refaktoryzacji.

---

### 2.3 (NOWY) Architektura §3 vs faktyczny kierunek importu `Point` — `canvas-kit` zależy od `shapes/_base/types`

**Problem:**

`architecture-base.md` §22 (cała sekcja) deklaruje canvas-kit jako warstwę abstrakcji silnika canvasu — niezależną od domeny aplikacji. Ale faktyczny import:

`src/canvas-kit/pointerInput.ts:23-24`:
```typescript
import type { Point } from '@/shapes/_base/types';
export type { Point };
```

`src/canvas-kit/index.ts:26`:
```typescript
export type { PointerGesture, Point } from './pointerInput';
```

`architecture-base.md` §22.1 linia 1468–1469:
```typescript
// Typ geometryczny — kanoniczne źródło: src/shapes/_base/types.ts; re-eksport dla wygody konsumentów canvas-kit
export type { Point } from './pointerInput';
```

Komentarz mówi „kanoniczne źródło: `src/shapes/_base/types.ts`", ale taki kierunek importu (`canvas-kit → shapes/_base`) **łamie zasadę z §22.7**:

> „Co przeżywa wymianę silnika bez modyfikacji: cały `src/store/`, `src/lib/`, `src/weld-units/`, **wszystkie typy w `src/shapes/_base/`** i `src/shapes/[typ]/types.ts`"

Jeśli `src/shapes/_base/types` zależy od `Point` z canvas-kit (lub odwrotnie), zmiana w jednej stronie wymaga zmiany drugiej. W obecnym układzie:
- `canvas-kit/pointerInput.ts` → `shapes/_base/types.ts` (Point) [← runtime: tylko type, więc erased]
- `shapes/[typ]/index.ts` (Renderer) → `canvas-kit` (primitives, components) [← runtime: faktyczne komponenty]

Cykl jest tylko na poziomie typów — TS go nie raportuje (type-only imports nie tworzą runtime cycle), ale architektonicznie jest niepokojący.

**Konsekwencje:**

- Jeśli `Point` w `shapes/_base/types.ts` zmieni shape (np. dodanie `z?: number` dla 3D w przyszłości), `canvas-kit/pointerInput.ts` musi się dostosować. To narusza obietnicę `canvas-kit` jako stable boundary.
- Implementator §22.4 może być zdezorientowany — co tak naprawdę „przeżywa wymianę silnika"?

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** przenieść `Point` (czysto geometryczny typ 2D) do `canvas-kit/primitives.ts` lub `canvas-kit/types.ts`. `shapes/_base/types.ts` re-eksportuje go z `@/canvas-kit`:

```typescript
// src/canvas-kit/types.ts (nowy plik) lub w istniejącym primitives.ts
export interface Point { x: number; y: number }

// src/shapes/_base/types.ts
import type { Point } from '@/canvas-kit'
export type { Point }
```

Logika: `Point` to domena geometryczna 2D, nie domena spawalnicza. `canvas-kit` jako silnik 2D powinien być źródłem prawdy.

**Opcja B:** wyeksportować `Point` z osobnego, „neutralnego" miejsca (np. `src/lib/geometry.ts`), oba `canvas-kit` i `shapes/` go importują.

**Opcja C:** zostawić jak jest, doprecyzować architekturę §22.7, że `shapes/_base/types.ts` jest „shared base" (nie engine-specific) i może być importowane przez `canvas-kit` jako wyjątek.

**Rekomendacja:** Opcja A. Jednorazowa drobna refaktoryzacja (kilka plików), naturalniejszy kierunek zależności (geometria → domena, nie odwrotnie). Eliminuje subtelną pułapkę w cyklicznej zależności typów.

---

### 2.4 (NOWY) `documents.data` JSONB CHECK constraint — `octet_length(data::text)` mierzy serializację, nie storage

**Problem:**

`supabase/migrations/20260507000000_complete_schema.sql:79`:

```sql
data jsonb not null
  check (
    jsonb_typeof(data) = 'object'
    and data ? 'schemaVersion'
    and jsonb_typeof(data -> 'shapes') = 'array'
    and jsonb_typeof(data -> 'weldUnits') = 'array'
  )
  check (octet_length(data::text) < 5 * 1024 * 1024),
```

`db-plan.md` §1.3 i `architecture-base.md` §15 deklarują „≤ 5 MB raw" dla scen. Ograniczenie `octet_length(data::text)` mierzy długość **tekstowej serializacji** JSONB w bajtach UTF-8, nie rozmiar storage'u Postgresa (który używa kompresji TOAST i jest mniejszy).

**Konsekwencje:**

- Limit 5 MB jest dla tekstowej reprezentacji — czyli rozmiar JSONa wysyłanego przez sieć przy SELECT. Storage Postgresa po kompresji TOAST jest typically 30-50% mniejszy. To OK dla intuicji „rozmiar pliku JSON eksportu".
- Ale: `data::text` wymusza materializację kompletnej serializacji **przy każdym INSERT/UPDATE** (oraz ma być wykonana też przy każdym row check'u). Dla scen blisko limitu 5 MB to dodatkowy koszt CPU. Lepsza miara: `pg_column_size(data)` (rozmiar po kompresji w storage'u) — szybsze, ale daje liczbę storage'ową, nie liczbę „raw JSON".
- 🟡 **Subtelny pretrip:** osoba edytująca scenę bezpośrednio przez SQL może ją scompactować (np. usunięcie whitespace) i obejść limit — ponieważ `jsonb` traci formatowanie przy serializacji do `text`, w praktyce nie ma whitespace. Ale różne `to_json` vs `to_jsonb` mogą dać różne długości tekstowe — minor edge case.

Drugi problem: brak limitu na liczbę elementów w `shapes[]` lub `weldUnits[]`. Klient (`ShapesSlice.addShape`) egzekwuje limit 3 dla Guest/Free, ale schema DB nie sprawdza. W razie obejścia frontendu:
- Pro user: bez limitu → dopuszczalne (`bez limitu` per PRD §3.1).
- Free user: client-side limit 3 + DB CHECK 5 MB → potencjalnie tysiące prostych shape'ów mieszczą się w 5 MB. Defense-in-depth na poziomie DB jest słaby.

Limit 3 dla Free/Guest jest egzekwowany **wyłącznie client-side** (api-plan.md §4 linia 951). To akceptowalne dla MVP, ale warto to udokumentować jako known gap.

**Konsekwencje:**

- 🟡 Implementator może oczekiwać, że DB egzekwuje limity per-plan na liczbie shape'ów — i zignorować client-side check. Wówczas Free user obchodzący frontend (DevTools) może utworzyć scenę z setkami shape'ów dopóki nie przekroczy 5 MB JSON.
- Spec PRD §3.1 wymaga „max 3" dla Free/Guest. Brak DB enforcement to świadomy kompromis (limit dotyczy stanu wewnątrz JSONB, nie odrębnych wierszy). Warto to wyrazić wprost.

**Rozwiązanie — wybór:**

**Opcja A (zalecana, dokumentacyjna):** dodać do `db-plan.md` §5.3 (lub nowej sekcji 5.X) jawne wyjaśnienie:

```markdown
### 5.X Limit elementów na scenie — defense in depth

PRD §3.1 wymaga max 3 elementów dla Guest/Free. DB schema nie egzekwuje tego
limitu, ponieważ elementy sceny są stanem wewnątrz `documents.data` JSONB, a nie
odrębnymi wierszami. Egzekwowane w `ShapesSlice.addShape()` (client-side).

Defense in depth: `CHECK (octet_length(data::text) < 5 * 1024 * 1024)`
ogranicza całkowity rozmiar sceny — Free user obchodzący frontend nie zapisze
> ~10 000 prostych shape'ów. Akceptowalne dla MVP. Post-MVP rozważyć
JSONB validator function w trigerze (`BEFORE INSERT OR UPDATE OF data`)
sprawdzającą `jsonb_array_length(data->'shapes') + jsonb_array_length(data->'weldUnits') <= 3`
dla owner'a o `plan = 'free'`.
```

**Opcja B:** dodać trigger DB egzekwujący limit już w MVP. Koszt: dodatkowa migracja + test. Bonus: defense-in-depth zgodne z `architecture-base.md` §14 wzorcem „limit DB + UI duplikat".

**Rekomendacja:** Opcja A teraz, Opcja B w momencie pierwszego incydentu obejścia (jeśli wystąpi). Trigger to wartościowy następny krok, ale nie krytyczny pre-launch.

---

### 2.5 (NOWY) Migracja `record_consent_bundle` — `block_protected_columns_update` ma side effect przy update'cie z RPC

**Problem:**

`supabase/migrations/20260508000000_record_consent_bundle.sql:59-63`:

```sql
if p_accepted then
  update public.user_profiles
  set current_consent_version = p_version
  where id = p_user_id;
end if;
```

Funkcja jest `SECURITY DEFINER`, więc działa jako rola wyboru (postgres owner). Trigger `block_protected_columns_update` (migracja `20260507000000:311-325`) sprawdza `if coalesce(auth.role(), 'anon') <> 'service_role'`.

**Pułapka:** w kontekście `SECURITY DEFINER` funkcji wywoływanej przez `authenticated`, `auth.role()` zwraca `'authenticated'` (nie `'service_role'`), bo Postgres rozróżnia między rolą postgres-level (definer) a rolą JWT (`auth.role()` z claim'ów JWT). Komentarz w migracji `20260508000000:9-10`:

> „bypasses block_protected_columns_update via security definer (auth.role() of the function is the postgres owner role, not authenticated)"

To **nieprawidłowe twierdzenie**. `auth.role()` to GoTrue helper, który czyta z PostgreSQL session settings (`request.jwt.claims`), nie z `current_user`. Niezależnie od `SECURITY DEFINER`, JWT settings są cechą sesji, nie funkcji. Czyli `auth.role()` w `SECURITY DEFINER` funkcji zwraca **rolę JWT wywołującego** (np. `'authenticated'`), nie rolę owner'a funkcji.

**Test mentalny:**
1. User z rolą `authenticated` wywołuje `supabase.rpc('record_consent_bundle', ...)`.
2. Funkcja działa z uprawnieniami owner'a (postgres) ale w sesji z JWT `role: authenticated`.
3. Funkcja wykonuje `UPDATE user_profiles SET current_consent_version = p_version WHERE id = p_user_id`.
4. Trigger `block_protected_columns_update` odpala BEFORE UPDATE.
5. Trigger sprawdza `coalesce(auth.role(), 'anon') <> 'service_role'` → `'authenticated' <> 'service_role'` → TRUE → ZERUJE `new.current_consent_version := old.current_consent_version`.
6. **UPDATE zostaje cicho zignorowany.** `current_consent_version` nie aktualizuje się.

**Czy ten bug istnieje w produkcji?**

Trzeba zweryfikować empirycznie, ale na podstawie dokumentacji Supabase i zachowania PostgreSQL JWT settings — **prawdopodobnie tak**. Komentarz w migracji `20260508` jest mylący / niepoprawny.

**Konsekwencje:**

- 🔴 **Jeśli teza powyżej jest poprawna:** `record_consent_bundle` **nie aktualizuje `user_profiles.current_consent_version`** — bundle insert do `consent_log` działa, ale denormalizacja w user_profiles pozostaje stale `NULL`. Architektura §14 fallback (modal przy każdym logowaniu jeśli `current_consent_version IS NULL`) zawsze się odpala — UX jak gdyby zgoda nie została zapisana.
- 🟡 **Jeśli teza jest niepoprawna** (i `auth.role()` faktycznie zwraca rolę DB):  to działa, ale dokumentacja jest myląca i bardzo łatwa do błędnej interpretacji przy przyszłych modyfikacjach.

**Weryfikacja (do wykonania przed naprawą):**

W lokalnym Supabase z `pnpm supabase start`:

```sql
-- Jako rola authenticated (via PostgREST z JWT)
SELECT public.record_consent_bundle(
  p_user_id := '<test-user-uuid>',
  p_version := 'test-1.0',
  p_accepted := true,
  p_ip := '127.0.0.0'::inet,
  p_user_agent := 'test'
);

-- Sprawdź:
SELECT current_consent_version FROM public.user_profiles WHERE id = '<test-user-uuid>';
-- Oczekiwane: 'test-1.0'
-- Jeśli NULL lub stara wartość → bug potwierdzony.
```

**Rozwiązanie (jeśli bug potwierdzony):**

**Opcja A (zalecana):** w funkcji `record_consent_bundle` jawnie ustawić rolę przed UPDATE:

```sql
-- W ciele funkcji, przed UPDATE:
perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.user_profiles set current_consent_version = p_version where id = p_user_id;
```

Albo lepiej — bypass triggera bezpośrednio przez nowy trigger condition:

```sql
-- Modyfikacja triggera block_protected_columns_update:
create or replace function public.block_protected_columns_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Allow owner role (postgres) — i.e. SECURITY DEFINER functions running as owner
  if current_user = 'postgres' then
    return new;
  end if;
  if coalesce(auth.role(), 'anon') <> 'service_role' then
    new.plan                    := old.plan;
    new.paddle_customer_id      := old.paddle_customer_id;
    new.current_consent_version := old.current_consent_version;
  end if;
  return new;
end;
$$;
```

`current_user` w PL/pgSQL **faktycznie** zwraca rolę owner'a w `SECURITY DEFINER` funkcji (różni się od `auth.role()`). To jest poprawny check.

**Opcja B:** zmienić architekturę — `record_consent_bundle` używa `service_role` zamiast `authenticated`. Wymaga, żeby route handler `/api/consent` używał `createAdminClient()` zamiast `createClient()`. Strata: handler musi sam zweryfikować `auth.uid() = p_user_id` (bo service_role omija RLS i wszystko). Cofnęłoby naprawę v5 §2.7.

**Opcja C:** utrzymać status quo + jawnie przyjąć modal-fallback przy logowaniu jako działający workaround (dokumentacyjnie). Tracimy denormalizację jako optymalizację, ale audyt RODO przez `consent_log` wciąż działa.

**Rekomendacja:** **Najpierw zweryfikować empirycznie (jedna komenda SQL na lokalnym stosie).** Jeśli bug → Opcja A z `current_user = 'postgres'` w trigerze (też wymaga aktualizacji `db-plan.md` §1.2 i `architecture-base.md` §14). Jeśli nie ma bugu — zaktualizować komentarz w migracji `20260508000000:9-10`, by nie wprowadzał w błąd.

---

### 2.6 (NOWY) `architecture-base.md` §15 zawiera szczątkowy schemat DB, który dryfuje od `db-plan.md`

**Problem:**

`architecture-base.md` §15 (linia 1132–1212) zawiera „szczątkową" wersję schematu (typy tabel, RLS overview). Komentarz na początku sekcji:

> „> Pełna specyfikacja — typy, constrainty, triggery, indeksy, RLS, funkcje SECURITY DEFINER — w `.ai/db-plan.md` (jedyne źródło prawdy)."

Ale §15 i tak duplikuje:
- DDL wszystkich 5 tabel (z constraint'ami i CHECK'ami).
- Tabelę overview RLS policies.
- Komentarze trigger'ów (np. `Trigger: check_free_project_limit() → RAISE EXCEPTION`).

**Konsekwencje:**

- Każda zmiana schematu wymaga aktualizacji **dwóch** plików (`db-plan.md` + `architecture-base.md` §15), a tylko jeden jest „source of truth". Procedure `architecture-base.md §15` mówi „pełna specyfikacja w db-plan", ale §15 zawiera 80 linii DDL, które są **łatwo zauważalne** i mogą być traktowane jako autoryzatywne przez czytelnika.
- W praktyce dryf już ma miejsce: §15 nie wspomina o migracji `record_consent_bundle` (dodanej w v5), nie ma w nim wzmianki o trigger'ze `block_protected_columns_update` chroniącym `current_consent_version` (jest w db-plan §1.2). Db-plan §4.7 lista funkcji `SECURITY DEFINER` jest pełna; §15 nie ma listy.

**Rozwiązanie — wybór:**

**Opcja A (zalecana):** zastąpić DDL w §15 **wyłącznie diagramem ER** (już jest jako ASCII w `db-plan.md`) i listą tabel z 1-linijkowymi opisami:

```markdown
## 15. Schemat bazy danych

> **Source of truth:** `.ai/db-plan.md`. Sekcja niniejsza zawiera jedynie
> diagram relacji i lista tabel — pełne typy, constraint'y, triggery, RLS i
> SECURITY DEFINER funkcje są w db-plan.

### Diagram

```
auth.users ──1:1── user_profiles
   │
   ├──1:N── documents (owner_id, CASCADE)
   ├──1:N── subscriptions (user_id, SET NULL)
   └──1:N── consent_log (user_id, CASCADE, append-only)

webhook_events  (samodzielne, dostęp tylko service_role)
```

### Tabele

| Tabela | Cel |
|---|---|
| `user_profiles` | 1:1 z `auth.users`; plan, locale, current_consent_version |
| `documents` | Pojedynczy projekt; cała scena w JSONB ≤ 5 MB |
| `subscriptions` | Aktualny stan subskrypcji Paddle (1 wiersz/sub) |
| `consent_log` | Append-only audyt zgód RODO |
| `webhook_events` | Idempotencja webhooków + audyt techniczny |

Pełne specyfikacje: `db-plan.md` §1.2 – §1.6.
```

**Opcja B:** Zostawić DDL w §15 jako „convenience snapshot", ale dodać automatyczny CI step weryfikujący, że DDL w §15 zgadza się z migracją (porównanie regex'em). Wymaga utrzymania, ale zmniejsza ryzyko dryfu.

**Rekomendacja:** Opcja A. Dokumentacyjny long-term cost duplikacji DDL > convenience czytania jednego pliku. Po refaktoryzacji `architecture-base.md` §15 staje się tym, czym aspires być (cross-reference do db-plan), a nie konkurującym source of truth.

---

### 2.7 (NOWY) `architecture-base.md` §3 nie wymienia `src/types/database.ts` jako wynikowy artefakt

**Problem:**

`architecture-base.md` §3 (linia 60-62):

```
  types/
    database.ts             ← supabase gen types typescript --schema public
                              (regenerowany skryptem `pnpm supabase:types`)
```

Plik istnieje (`src/types/database.ts`), ale komentarz jest **domyślnie niedeskryptywny**: nie mówi, jak generować typy lokalnie (że potrzebny `SUPABASE_PROJECT_ID` w `.env.local` i działa tylko przeciw zdalnej instancji), ani co robić, jeśli się zmieni schemat lokalnie (regenerować po `supabase db reset` na lokalnym).

`tech-stack.md` §14:
```json
"supabase:types": "dotenv -e .env.local -- bash -c 'supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts'"
```

Skrypt `pnpm supabase:types` używa `--project-id $SUPABASE_PROJECT_ID` — **wymaga zdalnej instancji Supabase**. Lokalnie (przez `pnpm supabase start`) skrypt nie działa, bo `SUPABASE_PROJECT_ID` jest pusty (jak w `.env.example`).

**Lokalnie poprawnym wariantem byłoby:**

```bash
supabase gen types typescript --local --schema public > src/types/database.ts
```

Albo:
```bash
supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" --schema public > src/types/database.ts
```

**Konsekwencje:**

- Programista pracujący lokalnie po dodaniu nowej migracji nie zregeneruje typów — `src/types/database.ts` zostanie nieaktualny dopóki ktoś nie pojedzie skryptu przeciw remote. To prowadzi do: typy desync z lokalnym schematem, testy przechodzą lokalnie, ale runtime błędy.
- Brak instrukcji w `CLAUDE.md` „Commands" lub `architecture-base.md` §3 jak regenerować typy z lokalnej DB.

**Rozwiązanie:**

**Opcja A:** dodać drugi skrypt do `package.json`:

```json
{
  "scripts": {
    "supabase:types": "dotenv -e .env.local -- bash -c 'supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts'",
    "supabase:types:local": "supabase gen types typescript --local --schema public > src/types/database.ts"
  }
}
```

I zaktualizować `CLAUDE.md` „Commands":

```markdown
pnpm supabase:types        # regenerate types from REMOTE Supabase project
                           # (requires SUPABASE_PROJECT_ID in .env.local)
pnpm supabase:types:local  # regenerate types from LOCAL stack
                           # (run after `supabase db reset` to sync types)
```

**Opcja B:** automatyczny hook po `supabase db reset` — wymaga override'u CLI, kosztowne.

**Rekomendacja:** Opcja A. 2-linijkowa zmiana w `package.json` + dopisek w docs. Eliminuje typowy footgun przy onboardingu nowych developerów.

---

## 3. 🟢 Drobne

### 3.1 (przeniesione z v5 §3.1) `consent_log.ip_address: unknown` w generowanych typach — wciąż aktywne

**Status:** wciąż aktywne, ale wpływ ograniczony.

`src/types/database.ts:43`:
```typescript
ip_address: unknown
```

Wrapper `ConsentLogRow` z `db-plan.md` §1.6 nie został utworzony — `/api/consent` write path (`route.ts:127`) przekazuje `ip_address: ip` (string) bez problemu (TS akceptuje `string` do `unknown`). Wrapper będzie potrzebny dopiero gdy ktoś będzie czytać `ip_address` z tabeli (np. RODO export endpoint może chcieć pokazać użytkownikowi historię IP — ale `api-plan.md` §2.1 dla `/api/user/export` nie wymaga `ip_address` w odpowiedzi).

**Rekomendacja:** odroczyć do pierwszego SELECT'a z `ip_address` w aplikacji. Workaround udokumentowany.

---

### 3.2 (przeniesione z v5 §3.2) E2E smoke heading bez i18n awareness

**Status:** wciąż OK. Bez zmian.

---

### 3.3 (przeniesione z v5 §3.3) `vitest-canvas-mock` weak assertion w smoke teście

**Status:** wciąż OK. Bez zmian.

---

### 3.4 (NOWY) Paddle webhook handler — brak warning loga przy `lookupUserId === null`

**Problem:**

`api-plan.md` §2.1 (linia 104):
> „4. Jeśli user nie znaleziony → zapisz `webhook_event`, **zaloguj warning**, zwróć 200 (webhook może przyjść przed rejestracją)"

Implementacja w `src/app/api/paddle/webhook/route.ts:170-175`:

```typescript
if (!subId || !customerId || !status || !planTier) {
  // Niepełne dane — log w `webhook_events.payload`; brak update'u stanu.
  return;
}

const userId = await lookupUserId(supabase, data);

const upsertRow = {
  user_id: userId,    // ← może być null bez ostrzeżenia
  ...
};
```

Brak `console.warn(...)`, brak strukturalnego logowania (Sentry, console.error), brak żadnej widoczności, że subskrypcja ląduje w bazie z `user_id = NULL`. Dolny `webhook_events.payload` zawiera surowy event, ale wymaga manualnego SQL'a do detekcji.

**Konsekwencje:**

- 🟢 Diagnostyka problemów z lookup'em wymaga ręcznego query Supabase. W pierwszych dniach po launchu, gdy webhooki vs rejestracja są nowe, brak sygnału alertu.
- W połączeniu z §1.1 (200-user limit) i §1.2 (orphan recovery) — orphan recordy pozostają niewidzialne dla zespołu.

**Rozwiązanie:**

```typescript
const userId = await lookupUserId(supabase, data);
if (!userId) {
  // Spec api-plan.md §2.1: zaloguj warning, zwróć 200 (webhook może przyjść
  // przed rejestracją lub gdy customer ma inny email niż w naszej bazie).
  console.warn('[paddle/webhook] orphan subscription event — user lookup failed', {
    eventId: payload.event_id,
    eventType: payload.event_type,
    customerId: data.customer?.id ?? data.customer_id,
    email: data.customer?.email ?? data.email,
  });
}
```

W produkcji `console.warn` w Vercel Functions ląduje w runtime logs (dostępne przez `vercel logs --since=1h`). Wystarczające na MVP; post-MVP rozważyć Sentry breadcrumbs.

**Rekomendacja:** drobna poprawka w obecnej iteracji, jednolinijkowa.

---

### 3.5 (NOWY) Paddle webhook — `JSON.parse fail` zwraca 400 `'invalid_signature'`, nie `'invalid_payload'`

**Problem:**

`src/app/api/paddle/webhook/route.ts:96-100`:

```typescript
let payload: PaddlePayload;
try {
  payload = JSON.parse(rawBody) as PaddlePayload;
} catch {
  return err('invalid_signature', 400);
}
```

Komentarz/error code `'invalid_signature'` jest mylący — JSON parse fail nie ma związku z weryfikacją sygnatury (która już przeszła w linii 91). Powinno być `'invalid_payload'` lub podobnie.

**Konsekwencje:**

- 🟢 Logi pokazujące `400 invalid_signature` mogą sugerować problem z `PADDLE_WEBHOOK_SECRET`, podczas gdy faktyczny problem to malformed JSON. Diagnostic-time waste.
- `api-plan.md` §2.1 lista kodów błędów (linia 84-88) wymienia tylko `missing_signature` i `invalid_signature`. Implementator dodał reuse `invalid_signature` zamiast nowego kodu.

**Rozwiązanie:**

Dodać do api-plan.md §2.1 nowy kod błędu `invalid_payload` i zmienić handler:

```diff
- return err('invalid_signature', 400);
+ return err('invalid_payload', 400);
```

Albo prostszy fix: zachować `invalid_signature`, ale dodać `message` field z opisem:

```typescript
return err('invalid_signature', 400, 'malformed JSON in payload');
```

Drugi wariant nie wymaga zmiany spec'a.

**Rekomendacja:** Drugi wariant — wykorzystać istniejący opcjonalny `message` w sygnaturze `err()` dla diagnostyki, bez rozszerzania kontraktu API.

---

### 3.6 (NOWY) `architecture-base.md` §22.1 komentarz „kanoniczne źródło: src/shapes/_base/types.ts" wprowadza w błąd

**Problem:**

`architecture-base.md` §22.1 linia 1468–1469:

```typescript
// Typ geometryczny — kanoniczne źródło: src/shapes/_base/types.ts; re-eksport dla wygody konsumentów canvas-kit
export type { Point } from './pointerInput';
```

Patrz §2.3 powyżej — kierunek importu (`canvas-kit → shapes/_base`) jest architektonicznie wątpliwy (canvas-kit ma być engine-independent boundary). Komentarz „kanoniczne źródło: shapes/_base" sugeruje, że ta zależność jest świadoma, ale §22.7 mówi „typy w `src/shapes/_base/` przeżywają wymianę silnika bez modyfikacji" — co implikuje brak zależności w drugą stronę.

**Konsekwencje:**

- 🟢 Czyste komentarze zamieszanie. Implementator wymieniający Konva → PixiJS będzie się zastanawiał, dlaczego `canvas-kit/pointerInput.ts` importuje z `shapes/_base`.

**Rozwiązanie:** zależnie od decyzji w §2.3.

- Jeśli przyjmujemy Opcję A z §2.3 (przenieść `Point` do canvas-kit) → komentarz znika, kierunek się odwraca.
- Jeśli zostaje status quo → uściślić komentarz: „Point dziedziczony z domeny shapes (single source of truth dla geometrii 2D w projekcie); canvas-kit re-eksportuje dla wygody — nie wprowadzamy duplikatu".

**Rekomendacja:** powiązać z decyzją §2.3.

---

### 3.7 (NOWY) `tech-stack.md` §6 Konva przepis `next.config.ts` zakłada `import type { NextConfig }` — kod używa `withNextIntl` wrappera

**Problem:**

`tech-stack.md` §6 (linia 100–112):

```typescript
import type { NextConfig } from 'next'
const config: NextConfig = {
  turbopack: {
    resolveAlias: { canvas: './empty.js' },
  },
}
export default config
```

Faktyczny `next.config.ts`:

```typescript
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: { canvas: './empty.js' }
  }
};

export default withNextIntl(config);
```

Tech-stack §6 pokazuje minimalny przepis, który **brakuje** wrappera `withNextIntl`. Implementator naśladujący spec wprost wyłączyłby integrację `next-intl` z bundlerem.

**Konsekwencje:**

- 🟢 Tech-stack jako "single source of truth" dla wersji jest też miejscem, gdzie patrzy się na konfigurację. Brak `withNextIntl` w przykładzie może prowadzić do konfliktu przy refaktoryzacji.
- `tech-stack.md` §5 (next-intl) nie pokazuje wrappera `next.config.ts`, więc nie ma cross-reference.

**Rozwiązanie:** zaktualizować `tech-stack.md` §6 o pełny przepis lub dopisać uwagę:

```diff
- ```typescript
- import type { NextConfig } from 'next'
- const config: NextConfig = {
-   turbopack: {
-     resolveAlias: { canvas: './empty.js' },
-   },
- }
- export default config
- ```
+ ```typescript
+ import type { NextConfig } from 'next'
+ import createNextIntlPlugin from 'next-intl/plugin'
+
+ const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
+
+ const config: NextConfig = {
+   reactStrictMode: true,
+   turbopack: {
+     resolveAlias: { canvas: './empty.js' },
+   },
+ }
+
+ // next-intl plugin musi opakowywać config — bez tego routing locale nie działa.
+ export default withNextIntl(config)
+ ```
```

**Rekomendacja:** drobna poprawka dokumentacji.

---

### 3.8 (NOWY) `db-plan.md` §1.2 trigger `user_profiles_before_update_block_protected` — order vs `set_updated_at`

**Problem:**

`db-plan.md` §1.2 (linia 32):
> „Trigger ochrony kolumn: `user_profiles_before_update_block_protected` — funkcja `block_protected_columns_update()`"

Migracja `20260507000000:376-383`:

```sql
-- user_profiles: fires alphabetically before set_updated_at (b < s)
-- resets protected columns for non-service_role callers
create trigger user_profiles_before_update_block_protected
  before update on public.user_profiles
  for each row execute function public.block_protected_columns_update();

-- user_profiles: keep updated_at current on any update
create trigger user_profiles_before_update_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();
```

Komentarz w migracji „fires alphabetically before set_updated_at (b < s)" jest poprawny, ale zależy od **PostgreSQL ordering convention** (alfabetyczna kolejność trigger names z tym samym BEFORE/AFTER + tym samym event'em). To behawior implementation-defined w wielu bazach, ale w PostgreSQL jawnie udokumentowany jako alphabetical.

**Konsekwencje:**

- 🟢 Implementator dodający nowy trigger (np. `user_profiles_before_update_validate_locale`) może nie zauważyć alphabetical ordering i nazwać go np. `user_profiles_before_update_a_validate` (zaczynając od 'a'), wstawiając się **przed** `block_protected`. Jeśli trigger waliduje pole, które `block_protected` może resetować, walidacja może zachodzić na `new` przed zerowaniem — niezgodne semantyki.
- Brak test'u sprawdzającego aktualną kolejność (np. PG_TRIGGER_DEPTH() inspection).

**Rozwiązanie:** udokumentować alphabetical ordering jako konwencję projektu w `db-plan.md` §5.7 (Konwencje nazewnictwa):

```diff
+ | Triggery (kolejność) | Triggery na tym samym tabela/event/timing są wykonywane alfabetycznie po nazwie. Przy dodawaniu nowego triggera BEFORE UPDATE upewnij się, że jego nazwa jest leksykograficznie poprawnie umieszczona względem istniejących (np. `block_protected` musi być przed `set_updated_at`, czyli `b... < s...`). |
```

**Rekomendacja:** dokumentacyjna, zapobiegawcza. Bez tego pierwszy nowy trigger może wprowadzić subtelny bug w runtime.

---

### 3.9 (NOWY) `vitest.config.ts` `include` pattern nie obejmuje co-locowanych testów wprost — działa przez glob

**Problem:**

`vitest.config.ts:12-13`:
```typescript
include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
```

Wzorce są poprawne. `src/lib/ipAnonymize.test.ts` jest match'owany. ✓

`architecture-base.md` §3 linia 183–187:
```
tests/                      ← Vitest integration / cross-module suites
                              (testy unit pojedynczego helpera mogą być
                               co-locowane jako src/lib/<x>.test.ts —
                               vitest.config.ts include obejmuje oba
                               wzorce)
```

✓ Spójne.

**Konsekwencje:** brak. Wymieniam jako odhaczenie tezy v5 §3.4 — naprawa jest kompletna.

---

## 4. Rekomendacje priorytetowe (lista działań)

### Przed pierwszym deployem produkcyjnym (ASAP):

1. 🔴 **§1.1** — Paddle webhook `lookupUserId` z paginacją lub funkcją DB `lookup_user_id_by_email` zamiast `auth.admin.listUsers({ perPage: 200 })`. Dodatkowo: egzekwować `customData.user_id` w checkout flow (defense in depth).
2. 🔴 **§1.2** — rozszerzyć trigger `subscriptions_after_iu_refresh_plan` o kolumnę `user_id` w liście `OF` + obsłużyć `OLD.user_id` w wrapper'ze, aby recovery orphan recordów aktualizował `user_profiles.plan`.
3. 🔴 **§1.3** — dodać `pnpm verify:routes` jako step w `.github/workflows/ci.yml` (job `lint-and-typecheck`). Hard-stop merge przy brakujących route handlerach.
4. 🔴 **§2.5 (jeśli potwierdzone)** — zweryfikować empirycznie zachowanie `auth.role()` w `record_consent_bundle` (`SECURITY DEFINER`); jeśli bug — naprawić trigger `block_protected_columns_update` przez `current_user = 'postgres'` check.

### W trakcie hardening API (pre-launch):

5. 🟡 **§2.1** — refaktoryzacja paddle webhook insert na `upsert + ignoreDuplicates`; usunięcie `count: 'exact'` i dead branch.
6. 🟡 **§2.2** — odwrócenie kolejności (dispatch przed idempotency marker) w paddle webhook handler.
7. 🟡 **§2.3** — zdecydować: przenieść `Point` do `canvas-kit` (Opcja A) lub udokumentować obecny kierunek jako wyjątek.
8. 🟡 **§2.4** — udokumentować w `db-plan.md` §5.X świadomy brak DB enforcement limitu 3 elementów dla Free/Guest.
9. 🟡 **§2.6** — uprościć `architecture-base.md` §15 do diagramu + listy tabel; usunąć duplikat DDL.
10. 🟡 **§2.7** — dodać skrypt `pnpm supabase:types:local` do `package.json`.

### Drobne (kosmetyczne, niska pilność):

11. 🟢 **§3.1** — wrapper `ConsentLogRow` przy pierwszym SELECT z `consent_log.ip_address`.
12. 🟢 **§3.2 / §3.3** — wzmocnić smoke testy po pierwszej feature.
13. 🟢 **§3.4** — dodać `console.warn` w paddle webhook `lookupUserId === null` ścieżce.
14. 🟢 **§3.5** — `JSON.parse fail` w paddle webhook → `message: 'malformed JSON'` (zachować kod `'invalid_signature'`).
15. 🟢 **§3.6** — uściślić komentarz przy `Point` re-eksporcie w `architecture-base.md` §22.1 (powiązane z §2.3).
16. 🟢 **§3.7** — `tech-stack.md` §6 dodać `withNextIntl` wrapper do przepisu `next.config.ts`.
17. 🟢 **§3.8** — `db-plan.md` §5.7 dopisek o alphabetical trigger ordering.

---

## 5. Podsumowanie

**Stan dokumentacji vs kod (delta v5 → v6):**

- **14 z 16 problemów v5 naprawionych** (vs 9/14 v4 → v5). Kontynuacja wysokiej dyscypliny synchronizacji `api-plan.md` ↔ `architecture-base.md` ↔ migration ↔ `db-plan.md`. Zespół przeszedł od stanu „dokumentacja wzorcowa, kod zerowy" w v5 do „API w pełni zaimplementowane zgodnie ze spec'em" w v6.
- Naprawione w v5 → v6: route handlers (×5), atomowość consent bundle (RPC SECURITY DEFINER), proxy.ts dead code, `supabase:types` env loading, `tsconfig.types`, `db-supabase-migrations.md` policies rule, `tech-stack.md` SUPABASE_SERVICE_ROLE_KEY, locale redirect doc, contract test dla `AllShapeGeometry`, port verification skrypt + helper.
- 2 problemy v5 carried-forward jako 🟢 (akceptowalne stany pre-implementation).
- **9 nowych problemów zidentyfikowanych w v6:** 3 × 🔴 (paddle webhook lookup scaling, orphan recovery trigger, CI gate niewpięta), 4 × 🟡 (paddle webhook refactor, atomicity, architecture cleanup, types script local), 6 × 🟢 (drobne).

**Główne ryzyka v6:**

1. **Paddle webhook user lookup nie skaluje się** (§1.1) — pierwszy realny problem produkcyjny. Próg 200 użytkowników jest osiągalny w pierwszych miesiącach. Cisza nie sygnalizuje problemu — naprawa wymaga proaktywnego działania przed pierwszym launchem.

2. **Orphan recordy w `subscriptions` są trudne do naprawy** (§1.2) — nawet ręczne uzupełnienie `user_id` w orphan recordzie nie odpala refreshu planu. Wymaga rozszerzenia triggera, inaczej operations team musi pamiętać o `SELECT public.refresh_user_plan_from_subscriptions(uid)` po każdym manual fix'ie.

3. **`record_consent_bundle` może NIE aktualizować `current_consent_version`** (§2.5) — kompozycja `SECURITY DEFINER` + trigger sprawdzający `auth.role()` ma niekonkluzywne semantyki (komentarz w migracji jest błędny). Wymaga empirycznej weryfikacji **przed pierwszą rejestracją produkcyjną**, inaczej audyt RODO art. 7 ma cichą dziurę.

4. **CI bramka `verify:routes` nie odpala się** (§1.3) — istnieje fizycznie, ale nie jest wpięta. Każdy refactor route handlerów może niepostrzeżenie usunąć wymagany handler. Manual checklist w `CLAUDE.md` jest niewystarczający.

5. **Kierunek importu canvas-kit ↔ shapes/_base jest cyklem typowym** (§2.3) — dziś działa (type-only), ale narusza obietnicę §22.7 i jest pułapką dla implementatora wymiany silnika canvasu.

**Filtr „przed implementacją kształtów":** żadne z odkryć v6 nie blokuje startu implementacji domeny shapes. Wszystkie 🔴 dotyczą warstwy API/CI (paddle, cron, idempotency, recovery). Implementacja shape'ów może iść równolegle z naprawami API.

**Filtr „przed pierwszym deployem produkcyjnym":** wymagane są naprawy §1.1 (paddle scaling), §1.2 (orphan recovery trigger), §2.5 (consent bundle weryfikacja + ewentualna naprawa). §1.3 (CI gate) jest tańszą jednolinijkową zmianą — robić niezwłocznie. §2.1 / §2.2 (paddle handler refactor) i §2.4 (limit doc) zaleca się przed launchem ale nie blokują techniczne (są o jakości i odporności).

**Filtr „przed otwarciem Paddle dla pierwszego klienta":** §1.1 (200-user limit) i §2.5 (consent denormalizacja) są blockerami — pierwsze 200 rejestracji + pierwszy klient = realne ryzyko cichego błędu w plan/consent.
