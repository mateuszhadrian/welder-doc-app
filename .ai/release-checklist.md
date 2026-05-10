# Release Checklist

Manualne kroki, których kod nie umie wymusić, a które muszą być wykonane **przed pierwszym deployem na produkcję** (i powtórzone, gdy któryś z punktów zmieni się w czasie).

Jeśli dodajesz nowy punkt: zostaw zwięzły opis (1–2 linijki), powiązanie z user story / planem, oraz wyjaśnij **co się stanie, jeśli punkt zostanie pominięty**. To pozwala zdecydować, czy jakiś punkt można odłożyć dla konkretnego deploya.

---

## Supabase Cloud — Auth

Źródło: `.ai/api-endpoints-implementation-plans/registration-post-endpoint-implementation-plan.md` §2.2.

- [ ] **Auth → Settings → `Enable email confirmations = ON`.** Bez tego `auth.users.email_confirmed_at` jest ustawiane od razu, co rozbraja defense-in-depth RLS na `documents` (`email_confirmed_at IS NOT NULL`) i pozwala mass-create niepotwierdzonych kont.
- [ ] **Custom SMTP skonfigurowany** (Resend albo Postmark) z weryfikowaną domeną. Bez tego maile weryfikacyjne nie wychodzą; users utykają na `/auth/check-email` bez wyjścia.
- [ ] **Site URL = prod URL**, np. `https://welderdoc.app`.
- [ ] **Redirect URLs zawiera** `https://<prod-domain>/auth/callback` **i** `https://<prod-domain>/en/auth/callback`. Bez wpisu dla `en` link w mailu ląduje w defaultcie i flush consent się nie odpala. **NB:** te same dwa wpisy obsługują US-004 (password reset, `auth.resetPasswordForEmail`) — `localePrefix: 'as-needed'` oznacza, że domyślne `pl` ma URL bez prefixu (`/auth/callback`), nie `/pl/auth/callback` jak literalnie sugeruje password-reset plan §6.3.
- [ ] **Sprawdź password policy** w Auth → Settings — `Min password length = 8` (zgodnie z `supabase/config.toml`).

## Supabase Cloud — Database

- [ ] **Wszystkie migracje z `supabase/migrations/`** zaaplikowane na prod (`supabase db push` z linkowanym projektem).
- [ ] **RLS policies** — sprawdź `mcp__plugin_supabase_supabase__get_advisors` z lintem na security; brak `policy_exists_rls_disabled` ostrzeżeń.
- [ ] **Service role key NIE jest** w żadnym `NEXT_PUBLIC_*` env var i nie jest commitowany do repo.

## Vercel

- [ ] **Region `fra1`** (już w `vercel.json`) — colocate z Supabase EU-Frankfurt (RODO).
- [ ] **Env vars** (Settings → Environment Variables, scope: Production):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only — nigdy `NEXT_PUBLIC_*`)
  - `NEXT_PUBLIC_APP_URL` (prod domain)
  - `CRON_SECRET` (długi losowy string — używany przez `/api/cron/*` `Authorization: Bearer`)
  - `PADDLE_WEBHOOK_SECRET` (z Paddle dashboard — wymagane dla `/api/paddle/webhook`)
  - `PADDLE_API_KEY`, `PADDLE_VENDOR_ID`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`
- [ ] **Cron jobs** (Settings → Cron) — wpisy z `vercel.json crons[]` widoczne i aktywne.

## Paddle

Źródło: `.ai/architecture-base.md` §16.

- [ ] **Webhook endpoint** w Paddle dashboard wskazuje na `https://<prod-domain>/api/paddle/webhook`.
- [ ] **Webhook secret** w env (`PADDLE_WEBHOOK_SECRET`) zgadza się z tym z Paddle dashboard.
- [ ] **Wszystkie wywołania `Paddle.Checkout.open(...)` w kodzie mają `customData: { user_id }`.** Bez tego pierwszy `subscription.created` może wpaść jako orphan, jeśli `customer.email` nie zgadza się z `auth.users`. **Code review enforcement** — nie ma testu, który to wymusza.

## Domain / DNS

- [ ] **Custom domain** podpięta w Vercel + DNS rekordy (CNAME / A) ustawione.
- [ ] **HTTPS aktywny** (Vercel automatic).
- [ ] **`www` redirect** zdecydowany (apex → www albo odwrotnie) i skonfigurowany.

## Bezpieczeństwo / RODO

- [ ] **TOS i Privacy Policy** opublikowane pod stałymi URL-ami.
- [ ] **`CURRENT_TOS_VERSION`** w `src/lib/consent/version.ts` zaktualizowany na bieżącą datę publikacji TOS (`YYYY-MM-DD`).
- [ ] **US-052 — consent re-acceptance UI** zaimplementowane (`/[locale]/consent-required` form + AuthProvider auto-redirect), Vitest i Playwright zielone. Bez tego flow rejestracji w prod (z `enable_confirmations=true`) skutkuje „uwięzieniem" usera na stronie `/consent-required`, a każdy bump `CURRENT_TOS_VERSION` blokuje istniejących userów (RODO art. 7).
- [ ] **Follow-up: rozważyć refactor `record_consent_bundle` RPC** (`supabase/migrations/20260508000000_record_consent_bundle.sql:52-58`). RPC ma hardcoded INSERT trzech typów (TOS+PP+cookies) i ignoruje listę `types` z payloadu `/api/consent`. Wykryte podczas weryfikacji US-052 (2026-05-10) — re-acceptance wysyła TOS+PP, ale RPC dopisuje też cookies. Brak naruszenia RODO (wszystkie `accepted=true`), ale UX-mismatch z planem US-052 (cookies powinny iść tylko przez banner). Fix: migracja `record_consent_bundle_v2(p_types text[], ...)` z dynamicznym INSERTem `unnest(p_types)` + update endpointu i sygnatury RPC. NIE blokuje pierwszego deploya — debt do MVP+1.
- [ ] **DPA z Supabase** podpisana (Supabase dashboard → Settings → Compliance).
- [ ] **DPA z Paddle** podpisana.
- [ ] **DPA z dostawcą SMTP** (Resend / Postmark) podpisana.

## Monitoring (opcjonalne dla MVP)

- [ ] **Sentry** podpięty (`.ai/init-project-setup-analysis.md` §4 lista deferred — wciąż OK pominąć dla pierwszego deploya).
- [ ] **Vercel Analytics** włączone (Settings → Analytics).
- [ ] **Supabase Cloud Auth logs** — sprawdź, że są dostępne i monitorowane (high signup spike → potencjalny atak).
