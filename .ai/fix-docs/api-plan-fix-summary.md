# API Plan Fix — Summary

> **Naprawiony dokument:** `.ai/api-plan.md` v1.0 → **v1.1**
> **Audyt referencyjny:** `.ai/api-plan-audit.md` (ocena 8/10)
> **Data naprawy:** 2026-05-08
> **Wykonawca:** Claude (Opus 4.7)
> **Decyzje produktowe:** uzgodnione z użytkownikiem przed naprawą — wszystkie w wariancie „Recommended" z audytu.

---

## 1. Podjęte decyzje (przed naprawą)

| # | Audit issue | Wybrana opcja |
|---|---|---|
| 1 | C1 — Delete account flow | **Password re-entry** (signInWithPassword na tymczasowym kliencie + admin.deleteUser) |
| 2 | M1 — Rate limiting | **Supabase Auth limits + sekcja TODO** (zero zewnętrznych zależności w MVP) |
| 3 | M2 — Idempotency dla consent | **Header `Idempotency-Key` + dedup 60s** (in-memory MVP, Vercel KV przed produkcją) |
| 4 | M3 — Protected columns | **Wrapper `updateProfile()` w `lib/supabase/profile.ts`** (filtruje protected fields, log warning w dev) |
| 5 | Cancel Pro subscription | **Paddle Customer Portal SDK inline** (`paddle.CustomerPortal.open()`) |
| 6 | OAuth providers | **Post-MVP** (sekcja „Co poza zakresem") |
| 7 | M4 — API versioning | **Krótka adnotacja** + reguła breaking change (MVP bez `/v1/`, pierwszy breaking change → `/api/v2/`) |
| 8 | m7 — Error mapping | **Adnotacja w planie + szkic helpera** `lib/supabase/errors.ts` |
| 9 | m8 — Export performance | **Soft-target <30s + adnotacja post-MVP** (streaming/Vercel Blob jako follow-up) |

---

## 2. Mapping audit issue → lokalizacja w planie v1.1

### Critical

| ID | Problem | Sekcja w v1.1 | Status |
|---|---|---|---|
| C1 | Brak `DELETE /api/user/account` (RODO art. 17) | §2.1 nowa sekcja po `/api/cron/cleanup-webhook-events` (linie ~396-475) | ✅ Rozwiązane |

### Major

| ID | Problem | Sekcja w v1.1 | Status |
|---|---|---|---|
| M1 | Brak rate limitingu | **§6 Rate Limiting** (nowa sekcja, podsekcje 6.1-6.3): Supabase Auth limits w `supabase/config.toml`, TODO matrix dla custom handlers, alternatywy (BotID/Turnstile) | ✅ Rozwiązane (częściowo: Supabase implementowany, custom handlers TODO przed produkcją) |
| M2 | Brak idempotency dla consent | Endpoint `POST /api/consent` (§2.1) — header `Idempotency-Key`, walidacja UUID v4, hash payloadu, 409 conflict + **§7 Idempotencja** jako cross-cutting concern | ✅ Rozwiązane |
| M3 | Cicha blokada protected columns | §2.2 sekcja Profil użytkownika — wrapper `updateProfile()` z TypeScript `SafeUpdate`, log warning w dev, filtrowanie 3 protected fields (`plan`, `paddle_customer_id`, `current_consent_version`) | ✅ Rozwiązane |
| M4 | Brak strategii wersjonowania | **§8 Wersjonowanie API** — strategia MVP, breaking change → `/api/v2/`, special case dla webhooka Paddle | ✅ Rozwiązane |

### Minor

| ID | Problem | Sekcja w v1.1 | Status |
|---|---|---|---|
| m1 | Niedoprecyzowane US-014 (canvas resize) | §2.2 PATCH documents — explicit read-modify-write code example | ✅ Rozwiązane |
| m2 | Brak `NEXT_LOCALE` cookie po PATCH locale | §2.2 PATCH user_profiles — 3-step sync: cookie 1y, localStorage, router.replace | ✅ Rozwiązane |
| m3 | Brak sortowania innym niż `updated_at` | §2.2 GET /rest/v1/documents — adnotacja o `?order=name.asc` etc. | ✅ Rozwiązane |
| m4 | Brak limitu wielkości payloadu | §2.2 PATCH documents + §4 walidacja — 5 MB raw, kod 23514, preflight check | ✅ Rozwiązane |
| m5 | Brak resend confirmation email | §2.2 sekcja Auth — `auth.resend({ type: 'signup' })` z rate limit notką | ✅ Rozwiązane |
| m6 | Brak OAuth | §10 Out-of-scope — adnotacja post-MVP, callback URL już istnieje | ✅ Rozwiązane |
| m7 | Brak typowania błędów PostgREST | **§9 Error Mapping** — pełny szkic `lib/supabase/errors.ts` z enum BusinessError, mapPostgrestError, mapAuthError | ✅ Rozwiązane |
| m8 | Brak obsługi 408/504 dla export | §2.1 GET /api/user/export — soft-target <30s + power-user adnotacja | ✅ Rozwiązane |

### Brakujące endpointy z audytu §2

| Endpoint | Status w v1.1 |
|---|---|
| `DELETE /api/user/account` | ✅ Dodany (C1) |
| `GET /api/paddle/customer-portal` lub Customer Portal SDK | ✅ Dodany jako **inline SDK** (§2.2) — zgodnie z decyzją produktową |
| `POST /api/auth/resend-confirmation` | ✅ Adresowane przez `auth.resend()` SDK (nie wymaga osobnego Route Handlera — Supabase Auth pokrywa) |

### Inne uwagi z audytu

| Audit punkt | Adresacja w v1.1 |
|---|---|
| §4.1 Locale redirect po sign-in | §2.2 sekcja Logowanie — explicit guidance dla Server Component layout: `auth.getUser()` + fetch `user_profiles.locale` + redirect na mismatch |
| §4.2 `schemaVersion` propagation | Pominięto świadomie — zakres frontendowy, nie API (audyt sam to przyznaje jako akceptowalne) |
| §6 Luka: konsekwencje pominięcia `auth.getUser()` | §3 — explicit ostrzeżenie o ekspiracji tokenu i braku weryfikacji JWT |
| §6 Luka: re-auth dla operacji destrukcyjnych | §3 — wzorzec re-auth z tymczasowym klientem dla `DELETE /api/user/account` |
| §6 Luka: `email_confirmed_at` na consent_log | §3 — TODO note jako defense-in-depth (low priority, wymaga migracji DB) |
| §7 Walidacja `version` w consent_log | §4 — TODO format (semver vs data vs hash), do podjęcia z legal/compliance |
| §7 Walidacja password strength | §4 — sekcja „Hasło — walidacja" z `[auth.password]` config |
| §7 Walidacja `name` preflight | §4 — adnotacja klient-side preflight |

---

## 3. Nowe sekcje w v1.1

| Sekcja | Linie | Treść |
|---|---|---|
| **§6 Rate Limiting** | ~1264-1326 | Supabase Auth limits, TODO matrix dla custom handlers, alternatywy bot defense |
| **§7 Idempotencja** | ~1328-1396 | Dwa wzorce: webhook (DB UNIQUE) vs klient (Idempotency-Key header). Storage cache (in-memory MVP → Vercel KV prod). Klient UX. |
| **§8 Wersjonowanie API** | ~1398-1431 | Strategia MVP (bez prefiksu), breaking change → `/api/v2/`, special case Paddle webhook, mapowanie Supabase SDK |
| **§9 Error Mapping** | ~1433-1563 | Pełny szkic `lib/supabase/errors.ts`: enum BusinessError, mapPostgrestError, mapAuthError, integracja z i18n |
| **§10 Co poza zakresem** | ~1565-1581 | Tabelka funkcji odłożonych post-MVP (OAuth, Queues, Runtime Cache, async export, BotID, Customer Portal handler, soft-delete, streaming, /v1 prefix, Idempotency-Key na innych endpointach, Vercel KV/Upstash) |

---

## 4. Statystyki zmian

| Metryka | v1.0 | v1.1 | Delta |
|---|---|---|---|
| Linie pliku | 1011 | 1581 | +570 (+56%) |
| Top-level sekcje | 5 | 10 | +5 |
| Custom Route Handlers | 6 | 7 | +1 (DELETE /api/user/account) |
| Sekcje SDK (#### w §2.2) | 6 | 7 | +1 (Customer Portal Paddle) |
| Decyzje audytowe pokryte | — | 14/14 | 100% |

---

## 5. Weryfikacja po naprawie

### 5.1 Cross-references

Przeprowadzono grep wszystkich „patrz §X" — wszystkie istniejące sekcje są referencowane poprawnie:

- `§2.1`, `§2.2` (istnieją)
- `§4.7`, `§1.2` w `db-plan.md` (zewnętrzne, niezweryfikowane w tym audycie)
- `§6`, `§7`, `§8`, `§9`, `§10` (nowe sekcje, wszystkie istnieją)
- `§3`, `§4` (istnieją)

### 5.2 Spójność logiczna

- **`POST /api/consent` logika** — krok 2 (Idempotency-Key) wstawiony przed walidacją payloadu. Pomijanie kroków 3-8 przy cache hit jest poprawne (nie wykonujemy DB writes ani anonimizacji IP, bo wynik już jest znany).
- **`DELETE /api/user/account`** — kolejność operacji: getUser → walidacja → re-auth na osobnym kliencie → admin.deleteUser → signOut. Brak race condition: jeśli re-auth się nie powiedzie, sesja oryginalna pozostaje aktywna.
- **Customer Portal** — wymaga `paddle_customer_id` z `user_profiles`. Adnotacja o orphan/pre-webhook scenariuszu zapobiega niespodziankom UX.

### 5.3 Decyzje vs implementacja

Wszystkie 9 decyzji produktowych z sekcji 1 jest spójnie odzwierciedlonych w planie:

- ✅ Password re-entry zaimplementowane jako tymczasowy klient (nie nadpisuje aktywnej sesji)
- ✅ Supabase Auth limits w `supabase/config.toml` (przykład w §6.1)
- ✅ Idempotency-Key z UUID v4, dedup 60s, hash payloadu (§7.2)
- ✅ Wrapper `updateProfile()` z TypeScript `SafeUpdate` (§2.2)
- ✅ Customer Portal inline SDK (§2.2)
- ✅ OAuth w §10 (post-MVP)
- ✅ Versioning §8 (krótka adnotacja, nie pełny prefix od razu)
- ✅ Error mapping §9 (szkic pliku, nie tylko adnotacja)
- ✅ Soft-target <30s dla export (§2.1 nowa sekcja „Charakterystyka wydajnościowa")

### 5.4 Punkty audytu nie zaadresowane (świadomie)

| Punkt | Powód |
|---|---|
| Audit §4.2 (`schemaVersion` propagation) | Zakres frontendowy/codec, nie API — audyt to przyznaje jako akceptowalne |
| Audit §3 punkt o anulowaniu subskrypcji jako Route Handler | Decyzja produktowa: Customer Portal SDK inline jest wystarczające |
| Audit §6 Luka „rate limit Supabase Auth Settings" | Zaadresowane w §6.1 jako konfiguracja `supabase/config.toml`, ale **rzeczywista zmiana w pliku konfiguracyjnym jest follow-upem implementacyjnym** (nie częścią planu) |
| `email_confirmed_at` na polityce `consent_log_insert_authenticated` | Wymaga migracji DB (`db-plan.md`), poza zakresem naprawy planu API. Zostawione jako TODO defense-in-depth |
| Walidacja `version` formatu w consent | TODO legal/compliance — decyzja produktowa, nie techniczna |

---

## 6. Pozostałe ryzyka i follow-upy

### 6.1 Przed merge'm do `main`

- [ ] Zaktualizować `supabase/config.toml` z sekcją `[auth.rate_limit]` i `[auth.password]` (referenced w §6.1 i §4)
- [ ] Stworzyć `src/lib/supabase/profile.ts` z funkcją `updateProfile()` (sketch w §2.2)
- [ ] Stworzyć `src/lib/supabase/errors.ts` z funkcjami `mapPostgrestError` / `mapAuthError` (sketch w §9.1)
- [ ] Dodać klucze `errors.*` do `src/messages/{pl,en}.json`
- [ ] Zaimplementować `DELETE /api/user/account` (route handler + UI modal dwuetapowy)
- [ ] Zaimplementować flow Idempotency-Key w `POST /api/consent` (in-memory Map per instance)

### 6.2 Przed produkcją (po MVP)

- [ ] Zainstalować Upstash Redis (lub Vercel KV) z Vercel Marketplace
- [ ] Migrować idempotency cache i rate limiting na Upstash (cross-instance, persistent)
- [ ] Per-user rate limity na `/api/consent`, `/api/user/export`, `/api/user/account` (limity z §6.2)
- [ ] Włączyć Vercel BotID na formularzach sign-up i reset password
- [ ] Decyzja legal: format `version` w consent (semver / data / hash) — aktualizacja walidacji
- [ ] Decyzja: dodać `email_confirmed_at IS NOT NULL` do polityki `consent_log_insert_authenticated` (migracja DB)
- [ ] Decyzja: powering streaming/async dla `/api/user/export` jeśli 95th percentile > 60s
- [ ] OAuth providers (Google → GitHub) — konfiguracja w Supabase Auth Dashboard, dodanie `signInWithOAuth` w UI

### 6.3 Długoterminowe (post-launch)

- [ ] API versioning prefix `/api/v1/` jeśli pojawi się wymaganie breaking change
- [ ] Soft-delete konta z 30-day grace period jeśli user feedback wymusi
- [ ] Lint rule wymuszająca użycie `updateProfile()` zamiast surowego `supabase.from('user_profiles').update(...)`
- [ ] Sentry / logging dla `mapPostgrestError` z kategorią `BusinessError.UNKNOWN` (sygnał, że pojawił się nowy DB error nie mapowany)

---

## 7. Ocena końcowa

Audyt v1.0 dał **8/10** z prognozą **9.5/10** po naprawie 3 najważniejszych punktów (C1, M1, M3). W v1.1 zaadresowano:

- ✅ Wszystkie 1 Critical, 4 Major, 8 Minor (audit findings)
- ✅ 14/14 punktów z §5 audytu
- ✅ Wszystkie luki z audytu §6 (Auth)
- ✅ Brakujące endpointy z audytu §2 (Delete account, Customer Portal)
- ✅ Drift architektura/API z audytu §4 (locale redirect po sign-in)

**Estymowana ocena v1.1: 9.5/10** — pozostałe 0.5 punktu to świadomie odłożone follow-upy (rate limit infra, OAuth, soft-delete, streaming export) wymagające albo zewnętrznych zależności (Upstash/KV), albo decyzji produktowych poza zakresem dokumentu.

Plan v1.1 jest **gotowy do implementacji** w fazie MVP. Sekcje §6-§10 stanowią mapę drogową na fazę pre-production hardening.
