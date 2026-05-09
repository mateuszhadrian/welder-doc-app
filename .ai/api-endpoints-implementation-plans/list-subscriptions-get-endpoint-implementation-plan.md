# API Endpoint Implementation Plan: List Subscriptions (GET)

## 1. Endpoint Overview

Read-only endpoint returning the authenticated user's subscription history (current state + historical rows) ordered by `created_at DESC`. Backs the **Settings → Billing** page (US-044) and the post-checkout polling flow (US-045) that confirms a successful Pro upgrade after Paddle Checkout closes.

**Architectural shape:** there is **no custom Route Handler**. The endpoint is reached directly through the Supabase JS SDK (PostgREST under the hood) from a Server Component or a Client Component. Authorization is delegated to the `subscriptions_select_authenticated` RLS policy (`user_id = auth.uid()`) and writes are forbidden at the policy level — the only mutation path to this table is `POST /api/paddle/webhook` running with `service_role`.

Per `tech-stack.md` §7, the SDK call must use:

- `createClient()` from `src/lib/supabase/server.ts` in Server Components / Route Handlers (cookie-based JWT, RLS active).
- `createClient()` from `src/lib/supabase/client.ts` in Client Components / hooks (browser-side JWT cookie, RLS active).
- **Never** `createAdminClient()` — it bypasses RLS and would leak other users' subscriptions.

A thin service helper `listSubscriptions(supabase)` is added in `src/lib/supabase/subscriptions.ts` to keep the column projection, ordering, and error mapping in one place — both server and client callers use it.

## 2. Request Details

- **HTTP Method:** `GET`
- **URL Structure:** `GET {NEXT_PUBLIC_SUPABASE_URL}/rest/v1/subscriptions`
- **Invocation in app code:** Supabase JS SDK (`supabase.from('subscriptions').select(...).eq(...).order(...)`).
- **Headers (handled by SDK):**
  - `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>`
  - `Authorization: Bearer <user JWT from cookie>`
- **Parameters**

  | Name | Required | Type | Source | Notes |
  |---|---|---|---|---|
  | `user_id=eq.{uid}` | No (recommended) | UUID v4 string | Query string | RLS already restricts rows to `auth.uid()`. Filter is added defensively to keep query plans selective and to make the intent explicit. The value MUST equal `auth.uid()` — sending a different UUID returns an empty array because of the RLS predicate. |
  | `select` | No | string | Query string | Default in code: `id,status,plan_tier,current_period_start,current_period_end,cancel_at,created_at`. Do **not** request `user_id` (after RODO delete it is `NULL`), `paddle_subscription_id`, or `paddle_customer_snapshot` — those are billing-internal. |
  | `order` | No | string | Query string | `created_at.desc` (default). |

- **Request Body:** none (GET).

## 3. Used Types

Defined in `src/types/api.ts` (already present):

- `SubscriptionDto` — `Pick<Tables<'subscriptions'>, 'id' \| 'status' \| 'plan_tier' \| 'current_period_start' \| 'current_period_end' \| 'cancel_at' \| 'created_at'>`.
- `SubscriptionStatus` — `'trialing' | 'active' | 'past_due' | 'paused' | 'canceled'`.
- `SubscriptionPlanTier` — `'pro_monthly' | 'pro_annual'`.

Service helper signature (new file `src/lib/supabase/subscriptions.ts`):

```typescript
type AnySupabaseClient =
  | ReturnType<typeof import('@/lib/supabase/client').createClient>
  | Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

export async function listSubscriptions(
  supabase: AnySupabaseClient
): Promise<{ data: SubscriptionDto[] | null; error: MappedError | null }>;
```

Rationale: returning the SDK row shape narrowed to `SubscriptionDto[]` keeps strict typing while accepting both the browser and the server client. The DB row's `status` and `plan_tier` are typed as raw `string`; the helper returns `SubscriptionDto` which keeps that, while the hook layer (UI) re-casts to the literal unions before rendering UI affordances (Customer Portal CTA gating).

No new Command Models — the endpoint is read-only.

## 4. Response Details

### 200 OK

JSON array (possibly empty) ordered by `created_at` DESC.

```json
[
  {
    "id": "8b1c…",
    "status": "active",
    "plan_tier": "pro_monthly",
    "current_period_start": "2026-05-01T00:00:00Z",
    "current_period_end": "2026-06-01T00:00:00Z",
    "cancel_at": null,
    "created_at": "2026-05-01T00:00:00Z"
  }
]
```

- Empty array `[]` is the **normal** response for free-tier users who never opened Paddle Checkout — UI must treat it as "no subscription yet" (show Upgrade CTA), not as an error.
- The `Customer Portal` CTA is rendered only when `subscriptions[0].status ∈ {active, trialing, past_due}` **and** the loaded `user_profiles.paddle_customer_id` is non-null (gating condition lives in the UI, not in this endpoint).

### Error responses

PostgREST surfaces errors as a JSON object handled by the SDK as the `error` field. The UI / caller maps these to:

| Outcome | HTTP from PostgREST | Action |
|---|---|---|
| Missing/expired session | `401` | Redirect to sign-in. UI surfaces `errors.unauthorized`. |
| RLS denied (theoretically impossible — predicate yields `false` → 0 rows, not 401) | n/a | Returns empty array. |
| DB connection / unknown failure | `500`, `503` | Show generic error toast (`errors.unknown`); telemetry event. |

## 5. Data Flow

```
[Server Component / Client Component]
        │
        ▼
[listSubscriptions(supabase)]   ← src/lib/supabase/subscriptions.ts
        │
        ▼
[supabase.from('subscriptions')
  .select('id, status, plan_tier, current_period_start,
           current_period_end, cancel_at, created_at')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })]
        │
        ▼
[PostgREST]  →  applies RLS policy
                  subscriptions_select_authenticated
                  USING (user_id = auth.uid())
        │
        ▼
[public.subscriptions]
  index: subscriptions_user_id_status_period_end_idx
         (user_id, status, current_period_end DESC)
        │
        ▼
[SubscriptionDto[]]
```

Side-channels referenced by this endpoint but **not** invoked in its read path:

- Mutations come exclusively from `POST /api/paddle/webhook` (service-role, idempotent upsert by `paddle_subscription_id`).
- Trigger `subscriptions_after_iu_refresh_plan` recomputes `user_profiles.plan` whenever a subscription row is touched.
- Cron `GET /api/cron/expire-subscriptions` (daily 03:00 UTC) downgrades `plan = 'free'` once `current_period_end` passes.
- RPC `effective_plan(uid)` is the source of truth for "is the user effectively Pro right now?". UI that needs the live plan should call that RPC; this endpoint is for **history and CTA gating**, not for plan resolution.

## 6. Security Considerations

1. **Authentication.** Implicit through Supabase Auth — the SDK attaches the user JWT from the cookie set by `@supabase/ssr` middleware (`src/proxy.ts` chain). On the server, the call MUST go through `createClient()` from `src/lib/supabase/server.ts` so that the JWT is forwarded; using the browser client on the server has no cookies and would behave as anonymous (RLS denies → empty array, easy to misdiagnose).
2. **Authorization.** Enforced by RLS policy `subscriptions_select_authenticated` — `user_id = auth.uid()`. Even if a malicious client sends `user_id=eq.<other-uid>`, the predicate yields zero rows. There are no INSERT/UPDATE/DELETE policies, so write attempts via PostgREST fail.
3. **Anon-key surface.** The anon key is public (`NEXT_PUBLIC_*`). Confidentiality of subscription data depends on RLS, not on the key. Never use the service-role key for this endpoint — that bypasses RLS and would expose all rows.
4. **Column whitelist.** The default `select` deliberately omits `user_id`, `paddle_subscription_id`, `paddle_customer_snapshot`. After RODO deletion `user_id` is `SET NULL` (audit trail kept) and exposing it in the UI is meaningless. `paddle_*` IDs are billing-internal.
5. **Customer Portal SDK call gating.** The CTA wires `paddle.CustomerPortal.open({ customerId })` using `user_profiles.paddle_customer_id` — that read is a separate query, not part of this endpoint. Document this dependency in the consumer (Settings page) so reviewers know both reads are required.
6. **CORS / origin.** PostgREST is hit through the Supabase domain; CORS for this read is configured at the Supabase project level (default allows the app domain). No additional CORS work in the app.
7. **Logs.** Do not log full subscription rows in client telemetry (PII-adjacent: plan tier and dates). Log counts only.

## 7. Error Handling

All errors flow through `mapPostgrestError(err)` (TODO — `src/lib/supabase/errors.ts`, scaffold in `api-plan.md` §9). Callers consume `MappedError` and render i18n keys:

| Source | Detection | `BusinessError` | UI behaviour |
|---|---|---|---|
| Missing session (`auth.getUser()` returns null) | Pre-flight check before SDK call | `UNAUTHORIZED` | Redirect to `/[locale]/auth/sign-in`. |
| PostgREST `401` (token expired between middleware refresh and call) | `error.code === 'PGRST301'` or HTTP 401 | `UNAUTHORIZED` | Force `supabase.auth.refreshSession()` once; on second 401 redirect. |
| Network / DNS / 5xx | `error` non-null without a known code, or `fetch` throws | `UNKNOWN` (or `NETWORK_ERROR`) | Toast `errors.subscription_load_failed` (new i18n key); offer "Retry". |
| Empty array | Not an error | — | Render "Free plan" state with Upgrade CTA. |

The endpoint does **not** raise business-rule errors — there is no INSERT path here. Add no rows to `webhook_events` or any audit table.

**Non-error paths** to test explicitly:

- User just signed up — zero rows.
- User upgraded then canceled — multiple rows; first row is `canceled` (because of `created_at.desc`) until trigger creates a fresh upsert; UI must use **the most recent** row's `status` for CTA gating.
- User RODO-deleted their account — irrelevant from this endpoint's perspective (no session left to call it), but `user_id` is `NULL` in the row for audit consistency.

## 8. Performance Considerations

- **Index:** `subscriptions_user_id_status_period_end_idx (user_id, status, current_period_end DESC)` covers the predicate `user_id = auth.uid()` and the natural ordering. The current `order=created_at.desc` does **not** match the trailing `current_period_end DESC` column of that index — for the typical case (≤ a handful of rows per user) this is irrelevant, but if billing history grows substantially in the future and a sort spill is observed, consider one of:
  - Add a small index `subscriptions_user_id_created_at_idx (user_id, created_at DESC)` — cheap, exact match.
  - Switch the UI ordering to `current_period_end DESC` (semantically equivalent for the "current plan first" use case) and re-use the existing index.
  - Keep the default `order` only for pagination and serve the **first** row through `effective_plan()` RPC.
- **Cardinality:** ≤ a few rows per user in practice. No pagination needed for MVP. Do **not** add `.range()` defensively — measure first.
- **Network:** single request, single round-trip; no joins. Payload < 1 KB even with multiple rows.
- **Caching:** none for the SDK call (data freshness wins). Settings page may use React Server Component caching (`'force-cache'` is not appropriate — use `cache: 'no-store'` or call from a Client Component with manual refetch on `paddle.Checkout` close).
- **Polling after Paddle Checkout (US-045):** call `effective_plan()` RPC and `listSubscriptions()` together with backoff (e.g. 1s / 2s / 4s up to 4 attempts) until a row with `status='active'` appears or timeout — show a toast advising "Płatność jest przetwarzana" if the timeout is hit.

## 9. Implementation Steps

1. **Create the service helper** `src/lib/supabase/subscriptions.ts`:
   - Export `listSubscriptions(supabase)` returning `{ data: SubscriptionDto[] | null; error: MappedError | null }`.
   - Use the column whitelist `id, status, plan_tier, current_period_start, current_period_end, cancel_at, created_at`.
   - Resolve `userId` from `(await supabase.auth.getUser()).data.user?.id`; if missing, short-circuit with `{ data: null, error: { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' } }`.
   - Call `.from('subscriptions').select(<whitelist>).eq('user_id', userId).order('created_at', { ascending: false })`.
   - Pass any returned `error` through `mapPostgrestError(err)` (when `errors.ts` lands; until then return `{ business: 'unknown', message: 'errors.unknown', rawCode, rawMessage }` inline and refactor in the same PR that creates `errors.ts`).
2. **Co-locate the unit test** `src/lib/supabase/subscriptions.test.ts`:
   - Mock the SDK; assert that the chain `from → select → eq → order` is called with the exact arguments.
   - Assert that the `select` projection does NOT include `user_id`, `paddle_subscription_id`, or `paddle_customer_snapshot`.
   - Assert empty-array path returns `{ data: [], error: null }`.
   - Assert that a missing session yields `BusinessError.UNAUTHORIZED` without calling `from()`.
   - Assert that a PostgREST error is mapped (mock `mapPostgrestError` once it exists).
   - Coverage thresholds for `src/lib/**` (lines 80, branches 70) apply — see `vitest.config.ts`.
3. **Wire the consumer (Settings → Billing page)** under `src/app/[locale]/settings/billing/page.tsx`:
   - Server Component: `setRequestLocale(locale)` first, then `const supabase = await createClient()` (server helper), then `const { data, error } = await listSubscriptions(supabase)`.
   - In parallel, fetch `user_profiles.paddle_customer_id` (single-row select) — needed to gate the Customer Portal CTA.
   - Render: if `error` → error state; if `data?.length === 0` → "Free plan" + Upgrade CTA; else render the latest row + history list.
4. **Wire the post-checkout polling (US-045)** in the Pro upgrade Client Component:
   - On `paddle.Checkout.open` `successCallback`, call `listSubscriptions(createClient())` from the browser helper with the backoff schedule above.
   - Stop on first row with `status='active'` matching the `plan_tier` purchased; otherwise show "processing" toast on timeout.
5. **Add i18n keys** in `src/messages/{pl,en}.json`:
   - `errors.subscription_load_failed`
   - `billing.free_plan_title`, `billing.free_plan_subtitle`, `billing.upgrade_cta`
   - `billing.manage_subscription_cta`
   - `billing.processing_payment_toast`
   - Anything user-visible must come through `useTranslations(...)` per `architecture-base.md` §17 — zero hardcoded strings.
6. **Document in CLAUDE.md** under "Currently implemented in `src/lib/`" once shipped: add `subscriptions.ts (listSubscriptions wrapper for US-044 / US-045)` so the next session picks up the right state.
7. **Verification:**
   - `pnpm typecheck` — strict mode + `noUncheckedIndexedAccess` must be clean (note: `data?.[0]` is `SubscriptionDto | undefined`).
   - `pnpm test:run src/lib/supabase/subscriptions.test.ts` — green.
   - `pnpm test:e2e -g "billing"` — at least one Playwright spec exercising the empty state and the active state with a seeded row.
   - Manual: open Settings → Billing as a fresh user (empty) and as a seeded Pro user; verify the Customer Portal CTA only appears when `paddle_customer_id` is set AND the latest status is `active|trialing|past_due`.
8. **PR review checklist (specific to this endpoint):**
   - No INSERT/UPDATE/DELETE call against `subscriptions` is added anywhere outside `src/app/api/paddle/webhook/route.ts`.
   - The `select` projection in the helper is the exact whitelist (no `user_id`, no `paddle_*`).
   - Server callers use `createClient()` from `src/lib/supabase/server.ts`; client callers use `src/lib/supabase/client.ts`. `createAdminClient()` is **not** used.
   - Errors go through `mapPostgrestError` (or its temporary stub) — no `error.message.includes(...)` string matching.
