# REST API Plan — Audit Report

> **Audytowany dokument:** `.ai/api-plan.md` v1.0 (2026-05-08)
> **Źródła referencyjne:** `.ai/db-plan.md` v1.2, `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/tech-stack.md` v1.0
> **Data audytu:** 2026-05-08

---

## 1. Podsumowanie

### Ogólna ocena: **8/10**

Plan jest dojrzały i dobrze przemyślany — szczególnie w obszarach, w których naiwne plany API typowo zawodzą: idempotencja webhooków, atomowość zapisu zgody RODO, rozdzielenie trzech wariantów klienta Supabase (`session` / `admin` / `browser`), świadome użycie PostgREST jako BFF dla CRUD-ów oraz precyzyjne udokumentowanie kolejności webhooków Paddle. Plan jest zsynchronizowany ze schematem DB i z architekturą — brak driftu DDL, nazwy kolumn i constrainty są zgodne. Decyzja o niewprowadzaniu warstwy "REST CRUD przez własne handlery" tam, gdzie wystarczy PostgREST + RLS, jest zasadna i oszczędza ~15 endpointów wraz z ich testami.

Punkty obniżające ocenę: **brak endpointu do usunięcia konta (RODO art. 17)**, **brak rate limitingu** (krytyczne dla `/api/consent` i `/api/user/export`), **brak idempotency-key dla `/api/consent`** (append-only tabela bez ochrony przed duplikatami), **niedoprecyzowane zachowanie cichej blokady protected-columns** (UX risk), brak strategii wersjonowania API.

### Krytyczne problemy wymagające natychmiastowej uwagi

| # | Problem | Krytyczność |
|---|---|---|
| 1 | Brak endpointu `DELETE /api/user/account` lub równoważnego — RODO art. 17 ("right to erasure") jest zadeklarowane w db-plan §5.9 i realizowane przez `ON DELETE CASCADE` na `auth.users`, ale **żaden endpoint nie jest do tego wskazany**. Bez tego compliance jest faktycznie niezrealizowany. | **Critical** |
| 2 | Brak rate limitingu dla `/api/consent`, `/api/user/export`, `/api/health`. Endpoint consent flooduje append-only tabelę; export to potencjalnie kosztowna operacja DB. | **Major** |
| 3 | Brak idempotency-key/dedup-window dla `POST /api/consent`. Wielokrotne wywołanie z `accepted=true` spowoduje duplikaty wierszy w `consent_log` (append-only — nie ma jak posprzątać). | **Major** |
| 4 | `PATCH /rest/v1/user_profiles` z polami `plan`/`paddle_customer_id`/`current_consent_version` zwraca 200 OK, mimo że trigger ciche zerowanie pola — łamie zasadę najmniejszego zaskoczenia. | **Major** |

### Ogólne wnioski

- Pokrycie encji DB: **kompletne** dla wszystkich 5 tabel `public.*`.
- Pokrycie user stories MVP: **~96%** (50 z 51 US adresowane). Niepokryte: **US-003 wylogowanie po stronie konta + delete account flow**.
- Zgodność z architekturą: **bardzo wysoka** — granica między "API skrojonym pod sekret/auth" a "PostgREST+RLS" jest spójna z `architecture-base.md` §16.
- Zgodność ze stackiem: **bezbłędna** — wszystkie reguły z `tech-stack.md` §7 i §13 są respektowane.
- Bezpieczeństwo: **solidne podstawy** (HMAC dla Paddle, CRON_SECRET, RLS, anonimizacja IP), ale brakuje warstwy ochrony przed nadużyciami (rate limit, captcha na sign-up, idempotency).

---

## 2. Pokrycie zasobów i encji

### Lista encji DB i ich pokrycie

| Encja | Tabela | Pokrycie w planie | Ocena | Uwagi |
|---|---|---|---|---|
| Użytkownik | `auth.users` | Auth SDK (`signUp`/`signIn`/`signOut`/`resetPasswordForEmail`/`updateUser`) | ✅ Kompletne | Brak endpointu **delete account** (krytyczne — RODO art. 17). |
| Profil | `public.user_profiles` | `GET`/`PATCH /rest/v1/user_profiles` + RPC `effective_plan` | ✅ Kompletne | Plan dobrze rozróżnia odczyt z cache vs. RPC po checkout. |
| Dokument | `public.documents` | `GET`/`POST`/`PATCH`/`DELETE /rest/v1/documents` | ✅ Kompletne | Paginacja przez `Content-Range` udokumentowana. |
| Subskrypcja | `public.subscriptions` | `GET /rest/v1/subscriptions` (read-only); mutacje przez `POST /api/paddle/webhook` | ✅ Kompletne | Brak endpointu do **anulowania subskrypcji** z poziomu aplikacji (patrz §3). |
| Zgoda | `public.consent_log` | `GET /rest/v1/consent_log` + `POST /api/consent` | ✅ Kompletne | Brak idempotency. |
| Webhook | `public.webhook_events` | `POST /api/paddle/webhook` (write); brak read-API (service_role only) | ✅ Kompletne | Zgodne z db-plan §1.6 i §4.6 — admin only. |

### Brakujące zasoby/endpointy

- **`DELETE /api/user/account` (Critical)** — brak operacji, która usunie `auth.users` i kaskadowo wyczyści `documents`, `consent_log`, anonimizuje `subscriptions.user_id` (ON DELETE SET NULL). Supabase Auth nie eksponuje delete-self z poziomu klienta — wymagane przekierowanie przez Route Handler z `service_role`.
- **`GET /api/paddle/customer-portal` lub `customer-portal-url`** — Paddle Billing oferuje "Customer Portal" do anulowania/zmiany planu. Brak endpointu, który zwróci spersonalizowany URL lub uruchomi Customer Portal SDK. Bez tego użytkownik Pro nie ma ścieżki do **anulowania subskrypcji** poza pisaniem na support — brak realizacji typowej UX-owej oczekiwanej dla SaaS.
- **`POST /api/auth/resend-confirmation`** (opcjonalne, Minor) — Supabase Auth ma to natywnie (`auth.resend()`), ale plan API nie wspomina, kiedy klient ma wywołać resend. Można dopisać krótki rozdział w §2.2 dla spójności.

---

## 3. Pokrycie logiki biznesowej

### Mapa US → endpoint

| US | Tytuł | Pokrycie | Uwagi |
|---|---|---|---|
| US-001 | Rejestracja | `auth.signUp()` + `POST /api/consent` (bundle) | ✅ Wzorcowe — kolejność i atomowość udokumentowane |
| US-002 | Logowanie | `auth.signInWithPassword()` | ✅ |
| US-003 | Wylogowanie | `auth.signOut()` | ✅ Wystarczające |
| US-004 | Reset hasła | `auth.resetPasswordForEmail()` + `auth.updateUser({ password })` | ✅ |
| US-005 | Tryb gościa | localStorage only — poza zakresem API | ✅ Słusznie pominięte |
| US-006 | Persystencja lokalna | localStorage | ✅ Poza API |
| US-007 | Migracja gościa | `POST /rest/v1/documents` | ✅ Logika idempotencji marker'em `welderdoc_migrated_at` w §4 |
| US-008 | Nowy projekt | `POST /rest/v1/documents` | ✅ |
| US-009 | Zapis projektu | `PATCH /rest/v1/documents` | ✅ |
| US-010 | Wczytanie | `GET /rest/v1/documents?id=eq...` | ✅ |
| US-011 | Usunięcie projektu | `DELETE /rest/v1/documents` | ✅ |
| US-012 | Duplikowanie | client-side: GET + INSERT | ✅ Słuszna decyzja (1 RTT extra; brak racy bo limit-trigger zabezpiecza) |
| US-013 | Zmiana nazwy | `PATCH /rest/v1/documents { name }` | ✅ |
| US-014 | Zmiana rozmiaru canvasu | `PATCH /rest/v1/documents { data: { canvasWidth, canvasHeight, ... } }` | ⚠️ **Niedoprecyzowane** — plan nie wspomina, że `canvasWidth/Height` żyją wewnątrz `data` JSONB, a nie jako kolumny. Konsumenci muszą zrekonstruować cały blob `data`. |
| US-015 | Nawigacja desktop | Frontend only | ✅ Poza API |
| US-016 | Touch nav | Frontend only | ✅ Poza API |
| US-017 | Dark/light | localStorage / `user_profiles` | ⚠️ **Niejasne** — PRD US-017 mówi "zapamiętane między sesjami (localStorage **lub** preferencje konta)". Plan API **nie ma** kolumny `theme` w `user_profiles`. Decyzja: localStorage only? Należy doprecyzować. |
| US-018-027b | Operacje canvas | Frontend only | ✅ Poza API |
| US-028-031 | Selekcja, undo/redo, mirror, z-index | Frontend only | ✅ Poza API |
| US-032-040 | Tryb sekwencji spawania | Wewnątrz `data` JSONB | ✅ Spójne z architekturą §7 |
| US-041-043 | Eksport PNG/JPG/legenda | Frontend only (`exportEngine`) | ✅ Poza API |
| US-044 | Plany subskrypcji | Strona statyczna + `GET /rest/v1/subscriptions` | ✅ |
| US-045 | Upgrade do Pro | `Paddle.Checkout.open()` client-side + webhook | ✅ |
| US-046 | Komunikat o limicie elementów | Frontend only (3-element limit client-side) | ✅ Poza API |
| US-047 | Komunikat o limicie projektów | DB error `project_limit_exceeded` | ✅ |
| US-048 | Walidacja parametrów | Frontend + DB CHECK | ✅ |
| US-049 | Eksport pustej sceny | Frontend only | ✅ Poza API |
| US-050 | Wybór języka | `PATCH /rest/v1/user_profiles { locale }` + cookie | ✅ |
| US-051 | Cookie consent + zgody przy rejestracji | `POST /api/consent` | ✅ |
| **n/d** | **Anulowanie subskrypcji (Pro)** | **Brak endpointu** | ❌ **Major** — brak ścieżki "Cancel Pro" → Paddle Customer Portal lub dedykowany endpoint |
| **n/d** | **Usunięcie konta (RODO art. 17)** | **Brak endpointu** | ❌ **Critical** — db-plan §5.9 deklaruje realizację, ale API jej nie wystawia |

### Brakujące lub niepoprawnie zamodelowane endpointy

1. **Brak endpointu `DELETE /api/user/account`** — db-plan §5.9 deklaruje "Art. 17 (right to erasure)" przez kaskadę `ON DELETE`, ale `auth.users.delete()` z poziomu klienta nie działa — `supabase-js` wymaga `service_role`. Bez Route Handlera użytkownik **nie ma technicznej możliwości** zażądać kasowania konta.
2. **Brak ścieżki anulowania subskrypcji** — Paddle ma "Customer Portal", ale plan nie zawiera helper'a do generowania URL ani opisu, jak frontend osiąga anulowanie. Akceptowalne TYLKO jeśli zespół zdecyduje, że anulowanie idzie przez email do support — wtedy wymagana adnotacja w PRD.
3. **`POST /api/auth/resend-confirmation` (opcjonalne)** — Supabase Auth ma `auth.resend()`, plan nie pokazuje konsumenta. Drobne pominięcie UX.

---

## 4. Zgodność z architekturą aplikacji

### Ocena spójności

Plan API **bardzo dobrze respektuje granice modułów** zdefiniowane w `architecture-base.md`:

- **§16 (API)** w architekturze wymienia dokładnie 6 Route Handlerów; plan API §2.1 ma identyczną listę (1:1).
- **§13 (Trwałość danych)** mówi "Cała scena jako JSONB w `documents.data`" → plan nie próbuje rozbijać sceny na osobne tabele/endpointy. Spójne.
- **§14 (Auth)** opisuje przepływ rejestracja → consent w dwóch krokach → plan §2.1 `POST /api/consent` realizuje to dokładnie tak, atomowo przez RPC.
- **§22 (Canvas-kit boundary)** — irrelewantne dla API, ale potwierdza, że scena jako blob nie wymaga inspekcji po stronie serwera.
- **`tech-stack.md` §7** — trzy warianty klienta Supabase (`createClient` browser/server + `createAdminClient`) — plan **wzorcowo** rozdziela ich użycie per endpoint. Brak duplikacji `service_role` tam, gdzie wystarczy klient sesji (kluczowe dla `/api/consent` — opis w §2.2 plan API).

### Rozbieżności

1. **`architecture-base.md` §17 (i18n)** — dokumentuje "po sign-in: redirect na `/<user.locale>/...`, jeśli pathname locale ≠ user.locale". Plan API mówi tylko o `PATCH user_profiles { locale }`, ale **nie wspomina, jak frontend powinien odczytywać `locale` przy logowaniu** ani że `auth.getUser()` w layout root ma fetchować profil. To granica frontend/API — brak uzgodnienia może spowodować, że jeden zespół zaimplementuje to inaczej niż zakłada drugi. **Minor.**
2. **`architecture-base.md` §13 — `LocalStorageSnapshot` zawiera `schemaVersion`** — plan API nie wspomina, kto bumpuje `schemaVersion` przy rename codec'a, ani jak frontend powinien interpretować mismatch w odpowiedzi `GET /rest/v1/documents`. Akceptowalne (to logika frontendowa), ale powinno być explicite, że `schema_version` w response musi być propagowane do `documentCodec.decodeDocument()`. **Minor.**
3. **`tech-stack.md` §12 cron schedule (`0 2 * * 0`)** vs **`api-plan.md` "raz w tygodniu"** — plan zawiera konkretny `vercel.json` snippet z `0 2 * * 0`, ale tekstowo mówi "raz w tygodniu". Spójne, drobny duplikat info — bez problemu.

### Rekomendacje wynikające z architektury

- **Dodać do §2.2 plan API** explicite "po `signInWithPassword()` Server Component layout root wywołuje `auth.getUser()` + `GET /rest/v1/user_profiles?select=locale` i wykonuje `redirect(/<locale>/...)` jeśli mismatch" — by uniknąć driftu między architekturą a API.
- **Doprecyzować w §2.2 (PATCH documents)**, że zmiana rozmiaru canvasu (US-014) wymaga PATCH'owania całego blob'a `data` (read-modify-write), ponieważ `canvasWidth/Height` żyją w JSONB, a nie jako kolumny. Bez tego konsumenci API mogą próbować PATCH'ować pole, którego nie ma.

---

## 5. Problemy i rekomendacje

### Critical

#### C1. Brak endpointu do usunięcia konta (RODO art. 17)
**Lokalizacja:** `api-plan.md` §2.1 — sekcja Custom Route Handlers
**Opis:** RODO art. 17 wymaga, by użytkownik mógł skutecznie zażądać usunięcia danych. db-plan §5.9 deklaruje realizację przez `ON DELETE CASCADE` na `auth.users`, ale **nie istnieje endpoint, który tę kaskadę wyzwoli** — `auth.users.delete()` z `authenticated` JWT nie działa.
**Rekomendacja:** Dodać do §2.1:
```
DELETE /api/user/account
  Authorization: Bearer <session JWT>
  Logika:
    1. auth.getUser() — weryfikacja sesji
    2. (opcjonalnie) email confirmation step lub re-auth password
    3. createAdminClient().auth.admin.deleteUser(user.id)
       → kaskada CASCADE: documents, consent_log
       → SET NULL: subscriptions.user_id (zachowanie audytu billingu)
    4. response 200 + clear session cookies
```

### Major

#### M1. Brak rate limitingu
**Lokalizacja:** wszystkie endpointy `/api/*` oraz Auth SDK (sign-up/sign-in)
**Opis:** Plan w ogóle nie wspomina o rate limitingu. Realne wektory nadużyć:
- `POST /api/consent` — flood append-only `consent_log` (rośnie bez kontroli; cron tego nie czyści, bo audit log).
- `auth.signUp()` (z poziomu Supabase) — bez captcha/rate limit możliwa enumeracja maili/spam rejestracji.
- `auth.resetPasswordForEmail()` — flood email provider'a, rachunek SMTP.
- `GET /api/user/export` — kosztowna operacja (DB read całego `documents.data`), bez ograniczenia można nią obciążyć DB.
**Rekomendacja:** Dodać sekcję §6 "Rate limiting" w plan API:
- Per-IP/per-user limit dla `/api/consent` (np. 5/min/user) — Upstash Redis lub Vercel Edge Config.
- Per-IP limit dla `/api/user/export` (np. 1/min/user, 5/dzień/user).
- Włączyć Supabase Auth rate limit (Settings → Auth → Rate Limits) — warto skonfigurować w `supabase/config.toml` i zadokumentować w plan API §3.
- (opcjonalnie) Cloudflare Turnstile lub hCaptcha na formularzu sign-up.

#### M2. Brak idempotency dla `POST /api/consent`
**Lokalizacja:** `api-plan.md` §2.1, sekcja `POST /api/consent`
**Opis:** Endpoint jest append-only — ponowne wysłanie tego samego payloadu (np. retry z timeoutu sieci, double-click w UI) doda kolejny komplet wierszy. Nie ma sposobu na "fix" duplikatów po fakcie (RLS blokuje DELETE/UPDATE).
**Rekomendacja:** Dodać header `Idempotency-Key: <uuid>` (klient generuje, wysyła w nagłówku). Handler:
- Hashuje key + user_id; sprawdza Redis/Edge Config przez ostatnie 60s.
- Trafienie → zwraca pierwotną odpowiedź bez ponownego INSERT.
- Brak → wykonuje normalnie i zapisuje wynik pod kluczem.
Alternatywnie: deduplikacja na poziomie DB — `UNIQUE (user_id, consent_type, version, accepted, date_trunc('second', accepted_at))` — kosztowne, zmienia kontrakt append-only.

#### M3. Cicha blokada protected columns
**Lokalizacja:** `api-plan.md` §2.2, sekcja Profil użytkownika, blok PATCH user_profiles
**Opis:** Plan dokumentuje (`> Uwaga`), że PATCH na chronionych kolumnach jest cicho ignorowany. Trigger zachowuje `OLD.value` bez błędu, więc klient dostaje `200 OK + PATCH-ed body` z **niezmienionymi wartościami**. To łamie zasadę najmniejszego zaskoczenia — typowy konsument REST oczekuje, że 200 = wartość zmieniona.
**Rekomendacja:** Wybrać jedną z dwóch ścieżek:
1. **Reject w handler:** dodać preflight w hipotetycznym Route Handler `PATCH /api/profile` (jeśli zostanie dodany), który zwraca `400 protected_field` przed odpaleniem PATCH na PostgREST. Wymaga zastąpienia bezpośredniego PostgREST PATCH własnym endpointem.
2. **Lepiej dokumentować + dodać fronton-side guard:** zostawić DB jak jest, ale w `lib/supabase/` udostępnić wrapper `updateProfile(patch)` który filtruje protected fields zanim wyśle PATCH (i loguje warning w dev). Tańsze, mniej restrukturyzacji.
Rekomenduję opcję 2 — minimalna zmiana, bez nowego Route Handlera.

#### M4. Brak strategii wersjonowania API
**Lokalizacja:** całość, brak dedykowanej sekcji
**Opis:** Plan nie wspomina o wersjonowaniu (`/api/v1/...` vs `/api/...`). MVP nie wymaga wersjonowania, ale przyszłe breaking changes (np. zmiana payloadu webhooka, dodanie pola wymaganego w consent) będą trudne — Paddle webhook po roku produkcji nie da się prosto przemigrować.
**Rekomendacja:** Dodać §6 lub w §3 krótką adnotację:
- Nazwy endpointów MVP zostają płaskie (`/api/consent`, `/api/paddle/webhook`).
- Pierwszy breaking change → wprowadzenie `/api/v2/<name>` z migracją klientów.
- `/api/paddle/webhook` jest najmniej elastyczny (Paddle pamięta URL) — przy zmianie schematu wymagana koordynacja z Paddle Dashboard.

### Minor

#### m1. Niedoprecyzowana ścieżka US-014 (zmiana rozmiaru canvasu)
**Lokalizacja:** `api-plan.md` §2.2, PATCH documents
**Opis:** PRD US-014 mówi o zmianie szerokości/wysokości canvasu. Plan nie wspomina, że trzeba zaktualizować zagnieżdżone `data.canvasWidth`/`data.canvasHeight`, a nie kolumnę. Przy naiwnej implementacji frontend mógłby próbować wysłać `PATCH { canvasWidth: 4000 }`.
**Rekomendacja:** Dodać krótki przykład w §2.2:
```typescript
// US-014 — zmiana canvasu wymaga read-modify-write na blob `data`
const { data: doc } = await supabase.from('documents').select('data').eq('id', id).single()
await supabase.from('documents')
  .update({ data: { ...doc.data, canvasWidth: 4000 } })
  .eq('id', id)
```

#### m2. Brak adnotacji o cookie `NEXT_LOCALE` przy `PATCH user_profiles { locale }`
**Lokalizacja:** §2.2, PATCH user_profiles
**Opis:** PRD US-050 i architecture §17 mówią, że locale żyje w trzech miejscach: cookie, localStorage, `user_profiles.locale`. Plan API pokazuje tylko PATCH na DB.
**Rekomendacja:** Dodać "po PATCH locale → klient ustawia `NEXT_LOCALE` cookie + opcjonalnie `localStorage`; layout root wykonuje `redirect()` przy mismatchu pathname → locale".

#### m3. Brak sortowania/filtrowania dla listy dokumentów innym niż `updated_at`
**Lokalizacja:** §2.2, GET /rest/v1/documents
**Opis:** PRD US-008 / US-010 nie wymagają sortowania po nazwie, ale realny UX listy projektów może. Plan pokazuje tylko `order=updated_at.desc`. PostgREST oferuje `order=name.asc`, ale brak adnotacji.
**Rekomendacja:** Dodać krótkie przypomnienie: "PostgREST query param `order` akceptuje dowolne pole z `select` — sortowanie po `name` lub `created_at` jest możliwe bez zmian backend".

#### m4. Brak informacji o limitach wielkości payloadu
**Lokalizacja:** całość
**Opis:** db-plan ma `CHECK (octet_length(data::text) < 5 * 1024 * 1024)` — 5 MB. Plan API tego nie powtarza. Klient próbujący PATCH-ować 6 MB blob dostanie "raw" błąd Postgres CHECK constraint.
**Rekomendacja:** W §4 ("Walidacja"): "Maksymalny rozmiar `data` w `POST/PATCH /rest/v1/documents` to **5 MB raw** (octet_length). Naruszenie zwraca PostgREST 400 z `code: '23514'` (check_violation). Aplikacja powinna prewencyjnie sprawdzać `JSON.stringify(data).length` przed requestem."

#### m5. Brak udokumentowanej ścieżki "resend confirmation email"
**Lokalizacja:** §2.2, sekcja Auth
**Opis:** Supabase Auth ma `auth.resend({ type: 'signup', email })`. Plan nie pokazuje tej ścieżki — UI flow "nie dostałem maila" nie ma punktu zaczepienia.
**Rekomendacja:** Krótki przykład w §2.2.

#### m6. Brak wzmianki o OAuth flow
**Lokalizacja:** §2.2, sekcja Auth
**Opis:** PRD §3.2 mówi "rejestracja e-mail + hasło **(oraz opcjonalnie OAuth przez Supabase Auth)**". Plan API w ogóle nie wspomina o OAuth. Akceptowalne tylko jeśli zespół zadecydował, że OAuth jest post-MVP.
**Rekomendacja:** Dopisać w §7 "Co poza zakresem": "OAuth providers (Google/GitHub) — post-MVP. Wymaga konfiguracji w Supabase Auth + callback URL `/[locale]/auth/callback`."

#### m7. Brak typowania błędów PostgREST
**Lokalizacja:** §2.2
**Opis:** Plan pokazuje przykład `error.message.includes('project_limit_exceeded')`. To wzorzec kruchy (string-match). Przyszłe zmiany w funkcji DB (np. dodanie kontekstu do `RAISE EXCEPTION`) złamią check.
**Rekomendacja:** Wprowadzić mapping w `src/lib/supabase/errors.ts` per kod Postgres (`P0001` z `error.code`) lub użyć dedykowanego `error.details`/`error.hint` zamiast `message`.

#### m8. Brak udokumentowanej obsługi 408/504 dla `GET /api/user/export`
**Lokalizacja:** §2.1, GET /api/user/export
**Opis:** Eksport może być wolny (cały `data` JSONB × N projektów + cały `consent_log`). Vercel domyślnie ma 300s timeout (Fluid Compute) — dla bardzo aktywnych użytkowników Pro to ryzyko.
**Rekomendacja:** Dodać w §4: "GET /api/user/export ma soft-target < 30s. Dla użytkowników z > 100 projektami — rozważyć streaming response lub asynchroniczne generowanie do storage'u (Vercel Blob) z linkiem download'em."

---

## 6. Uwierzytelnianie i autoryzacja

### Ocena istniejącego mechanizmu

**Solidnie przemyślane.** Plan rozróżnia 5 poziomów dostępu (Public / Authenticated / Email-confirmed / Service Role / Cron Secret) i konsekwentnie je stosuje. Wzorzec `createServerClient` z `@supabase/ssr` w Route Handlerach jest poprawny — middleware proxy łańcuch (Supabase → next-intl) jest zgodny z dokumentacją Supabase i wymogami next-intl.

**Najlepsze decyzje:**
- Rozdział `auth.role() = 'service_role'` (App-side bypass) vs `current_user = 'postgres'` (DB-side bypass dla SECURITY DEFINER) w `block_protected_columns_update` — wzorcowy defense-in-depth.
- `POST /api/consent` **nie używa** `service_role` — RPC `record_consent_bundle` wykonuje się jako `postgres` przez SECURITY DEFINER. Eliminuje powierzchnię ataku przy bug'u w handler'ze.
- HMAC weryfikacja webhooka Paddle z `paddle-signature` (`ts=...;h1=...`) zgodna z Paddle Billing v2.

### Luki

1. **Brak ścieżki re-auth dla operacji wysokiej wagi** (Major)
   Brakujący `DELETE /api/user/account` (Critical C1) powinien wymagać re-authn (re-entry hasła lub email confirmation step). RFC 6749 / ad-hoc OWASP — operacje destrukcyjne wymagają świeżej autentykacji. Plan po dodaniu C1 musi zawierać tę warstwę.
2. **`auth.getUser()` w Route Handlerach — brak zaznaczenia że tylko ono refreshuje token** (Minor)
   Architektura §16 wspomina o tym jako warunek konieczny ("każdy Route Handler wymagający sesji musi wywołać `auth.getUser()` przed jakąkolwiek operacją"). Plan API §3 ("Weryfikacja sesji") to demonstruje przykładem, ale **nie wskazuje wprost konsekwencji pominięcia**. Warto dopisać sentencję: "Pominięcie `auth.getUser()` przy obecności matcher'a `?!api` skutkuje operowaniem na tokenie z poprzedniego requestu — możliwa ekspiracja po godzinie i 401 dla legalnego usera."
3. **Brak weryfikacji `email_confirmed_at` przy `POST /api/consent`** (Minor)
   RLS na `documents` chroni nieproduktywnych userów, ale `consent_log` ma RLS `user_id = auth.uid()` bez warunku email. Niepotwierdzony user może zalogować się przez magic link (jeśli skonfigurowane) i floodować consent_log. Defense-in-depth: rozważyć dodanie `email_confirmed_at IS NOT NULL` do polityki `consent_log_insert_authenticated`.

### Rekomendacje

- **Dodać re-auth wymóg** do hipotetycznego `DELETE /api/user/account` (po dodaniu C1).
- **Dopisać w §3 plan API** zdanie o konsekwencji pominięcia `auth.getUser()`.
- **Rozważyć** `email_confirmed_at IS NOT NULL` w polityce `consent_log_insert_authenticated` (zmiana w db-plan §4.5).

---

## 7. Walidacja i logika biznesowa

### Ocena pokrycia warunków walidacji ze schematu DB

Plan API §4 ("Walidacja i logika biznesowa") **bardzo dobrze odzwierciedla constrainty DB**:

| Constraint DB | Pokrycie w API |
|---|---|
| `documents.name` length 1-100 | ✅ §4 |
| `documents.data` JSONB structure | ✅ §4 |
| `documents.data` ≤ 5 MB | ⚠️ Wymienione w schemacie tabelarycznym, ale **nie ma adnotacji o wielkości payloadu w POST/PATCH** — patrz m4 |
| `subscriptions.status` CHECK | ✅ §4 |
| `subscriptions.plan_tier` CHECK | ✅ §4 |
| `consent_log.consent_type` CHECK | ✅ §2.1 + §4 |
| `user_profiles.locale` CHECK (`pl`/`en`) | ✅ §4 |
| `user_profiles.plan` CHECK (`free`/`pro`) | ✅ §4 |
| `user_profiles.paddle_customer_id` UNIQUE | ✅ §4 |
| Trigger `check_free_project_limit` | ✅ §4 — z mappingiem `project_limit_exceeded` |
| Trigger `block_protected_columns_update` | ⚠️ §4 wspomina, ale plan **nie definiuje strategii klienta** dla tego silent-no-op (patrz M3) |
| `webhook_events UNIQUE (provider, external_event_id)` | ✅ §4 — wzorcowo zaimplementowana idempotencja |
| `paddle_subscription_id UNIQUE` | ✅ §4 |
| Anonimizacja IP `/24` (IPv4) `/48` (IPv6) | ✅ §4 — RODO motyw 30 |

### Brakujące lub niespójne reguły walidacji

1. **Brak walidacji `version` w `consent_log`** (Minor)
   db-plan §1.5 mówi: "Format wersji zgody — TBD legalnie (semver / data / hash)". Plan API przyjmuje arbitralny string. Decyzja jest świadomie odłożona — db-plan §5.14 punkt 5. Rekomendacja: dodać krótki TODO w §4 plan API i ścieżkę walidacji po podjęciu decyzji.
2. **Brak walidacji `password` strength server-side** (Minor)
   PRD US-001 wymaga "min. 8 znaków". Plan API mówi `auth.signUp({ password: 'MinimalneHaslo123' })` przez Supabase SDK. Supabase Auth ma własną minimalną długość — należy ją skonfigurować (`supabase/config.toml` `[auth.password]`) i wzmiankować w plan API §4 jako "egzekwowane przez GoTrue, konfiguracja w `config.toml`".
3. **Brak walidacji `document.name` po stronie API explicitly** (Minor)
   DB CHECK egzekwuje, ale plan API §4 wspomina to tylko tabelarycznie. Brak rekomendacji "klient powinien preflight-trim'ować i sprawdzać 1-100 przed PATCH-em" — bez tego błąd przyjdzie jako PostgREST 400 z generic check_violation.

---

## 8. Zgodność ze stackiem technologicznym

### Ocena

**Bezbłędna.** Plan respektuje wszystkie reguły z `tech-stack.md`:

- §7 — trzy warianty klienta Supabase (`createBrowserClient` / `createServerClient` / `createAdminClient`) **konsekwentnie rozdzielone** per endpoint.
- §13 — wszystkie zmienne środowiskowe wymienione w §5 plan API (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PADDLE_WEBHOOK_SECRET`, `CRON_SECRET`, etc.) są zgodne ze stackiem.
- §12 (Vercel `fra1` + Cron) — `vercel.json crons[]` wymieniony wraz z dwoma cron schedulami.
- §1 (Node 22.x) — irrelewantne dla API designu, ale fluid compute / 300s timeout (default Vercel) jest implicite uwzględnione.

### Czy stack stwarza lepsze alternatywy dla obecnych rozwiązań?

1. **Vercel Queues (beta) dla `POST /api/paddle/webhook`** — można rozważyć dla niesynchronicznego przetwarzania payloadów. **Nie zalecam dla MVP** — webhook jest już idempotentny przez UNIQUE constraint, processing jest szybki (1-2 SQL roundtrips). Queue dodaje opóźnienie i komplikację. Post-MVP, jeśli volumetria wzrośnie, warto rozważyć.
2. **Vercel BotID dla `auth.signUp`/`auth.resetPasswordForEmail`** — lekka alternatywa dla reCAPTCHA. **Zalecam rozważyć** dla rate limit / abuse prevention (M1). Integracja: 1 hook w komponencie sign-up.
3. **Vercel AI Gateway** — irrelewantne (brak AI w MVP).
4. **`vercel.ts` zamiast `vercel.json`** — informacja z session-start hook'a o `vercel.ts` jako "recommended way". Plan API używa `vercel.json` zgodnie z `tech-stack.md` §12. Decyzja może być rozważona w przyszłości — dla MVP `vercel.json` jest wystarczający i prostszy w PR-checklistach.
5. **Vercel Runtime Cache dla `GET /rest/v1/documents` listy projektów** — można rozważyć dla cache'owania listy projektów per-user (10-30s TTL). **Nie zalecam dla MVP** — komplikuje invalidation przy `POST/PATCH/DELETE`, a workload jest niski.

### Rekomendacje specyficzne dla stacku

- **Wykorzystać Supabase Auth rate limits** — konfiguracja w `supabase/config.toml`:
  ```toml
  [auth.rate_limit]
  email_sent = 4               # 4 emaile / godzinę / IP (signup, reset)
  sign_in_sign_ups = 30        # 30 attempts / 5 min / IP
  token_refresh = 150          # 150 / 5 min / IP
  ```
- **Wykorzystać Vercel Functions Active CPU pricing** świadomie — `GET /api/user/export` może być długi (DB read), ale to nie wpływa na koszt znacząco (Active CPU = czas CPU, nie wall-clock). To korzystnie dla planu.
- **Fluid Compute reuse instances** — brak akcji wymaganych, ale warto wiedzieć: connection pooling do Postgres (przez Supabase) korzysta na tym automatycznie.

---

## Podsumowanie końcowe

Plan API jest **dojrzały, spójny i implementowalny** — odzwierciedla głębokie zrozumienie nie tylko produktu (PRD), ale też kontekstu compliance (RODO), wymagań platformy (Vercel/Supabase) i charakterystyki webhooków Paddle. Decyzje architektoniczne są dobrze umotywowane (kiedy PostgREST, kiedy Route Handler, kiedy SECURITY DEFINER vs service_role). Dokumentacja edge case'ów (kolejność webhooków, recovery flow, atomowość consent) wykracza ponad standard MVP.

**Trzy najważniejsze działania przed merge'm do `main`:**

1. **Dodać `DELETE /api/user/account`** (Critical) — bez tego compliance RODO art. 17 jest fikcyjny.
2. **Dodać sekcję Rate Limiting** w plan API (Major) — minimum: konfiguracja Supabase Auth rate limits + adnotacja "TODO: rate limit `/api/consent` przed produkcją".
3. **Doprecyzować zachowanie cichej blokady protected columns** (Major) — wybór ścieżki "wrapper w `lib/supabase/`" jest najtańszy.

Po wprowadzeniu powyższych: plan zasłuży na **9.5/10**.
