# API Endpoint Implementation Plan: POST /api/paddle/webhook

## 1. Endpoint Overview

Receives Paddle Billing webhook events (subscription lifecycle, customer changes) and projects them onto the local database. The handler is the only authoritative writer to `subscriptions` and the only path that may mutate `user_profiles.paddle_customer_id`. It must:

- Verify the HMAC-SHA256 signature on the raw request body before parsing JSON (defence against payload poisoning).
- Dispatch business logic per `event_type` (`subscription.*` upsert; `customer.*` profile patch).
- Persist an idempotency marker in `webhook_events` (UNIQUE on `(provider, external_event_id)`), using a "dispatch-before-marker" ordering so a partial failure is safely retried by Paddle.
- Mark events processed via `processed_at = now()`.
- Always respond 200 for unsupported event types and orphan lookups (Paddle treats 5xx as retry).

Endpoint is implemented at `src/app/api/paddle/webhook/route.ts` — this plan documents the contract, invariants and acceptance criteria for review/audit. No user session is involved; DB access goes through `createAdminClient()` (service role) because `webhook_events` has RLS enabled with no policies and the writes touch protected columns blocked from `authenticated`.

Spec references: `.ai/api-plan.md` §2.1, `.ai/api-endpoints-data/paddle-webhook-post-endpoint-data.md`, migration `supabase/migrations/20260509000000_paddle_webhook_hardening.sql`, CLAUDE.md "Route Handlers implemented" + Paddle/Webhook PR checklist.

## 2. Request Details

- **HTTP Method:** `POST`
- **URL Structure:** `/api/paddle/webhook`
- **Runtime:** Node.js (default) — required for `node:crypto` (`createHmac`, `timingSafeEqual`).
- **Auth:** none (no Supabase session). Trust is established by HMAC.
- **Content-Type:** `application/json` (Paddle).
- **Headers:**
  - **Required:** `paddle-signature: ts=<unix-seconds>;h1=<hex-sha256>` — tolerant parser must split on `;` and trim each `k=v` pair (extra params allowed and ignored).
  - **Required:** `Content-Type: application/json`.
- **Body:** raw Paddle event JSON. Read once via `await request.text()` and **then** verify HMAC against the raw text before any `JSON.parse` call (no double-read of the request stream).

### Required body fields (top-level)

- `event_type: string` — e.g. `subscription.activated`, `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.paused`, `subscription.past_due`, `customer.created`, `customer.updated`.
- `event_id: string` — Paddle-globally-unique ID. Powers idempotency.
- `occurred_at: string` (ISO-8601) — informational, persisted in `payload`.
- `data: object` — event-specific payload.

### Conditionally required nested fields

For `subscription.*`:

- `data.id` (`sub_...`) — `paddle_subscription_id`.
- `data.customer.id` (or `data.customer_id`) — written to `paddle_customer_snapshot`.
- `data.status` — must map to the DB enum (`trialing` | `active` | `past_due` | `paused` | `canceled`).
- `data.items[0].price.id` — must equal one of `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY` / `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL`.
- `data.current_billing_period.{starts_at, ends_at}` — optional, written to `current_period_*`.
- `data.scheduled_change.effective_at` — optional, written to `cancel_at`.
- `data.customData.user_id` (or `data.custom_data.user_id`) — preferred lookup key; mandated in PRD/PR checklist for every `Paddle.Checkout.open(...)`.

For `customer.*`:

- `data.id` (`ctm_...`) — used to set `user_profiles.paddle_customer_id`.
- `data.email` (or `data.customer.email`) — used as fallback lookup.

## 3. Used Types

From `src/types/api.ts`:

- `PaddleWebhookResponseDto` — `{ received: true; duplicate?: true }`.
- `PaddleWebhookApiErrorCode` — `'missing_signature' | 'invalid_signature' | 'invalid_payload' | 'internal_error'`.
- `TypedApiErrorDto<PaddleWebhookApiErrorCode>` — typed error body shape.
- `SubscriptionStatus` — `'trialing' | 'active' | 'past_due' | 'paused' | 'canceled'`.
- `SubscriptionPlanTier` — `'pro_monthly' | 'pro_annual'`.

From `src/types/database.ts`:

- `Database` — generic for `createAdminClient()` and `supabase.rpc(...)` typing.
- `Json` — for the `webhook_events.payload` cast (`payload as unknown as Json`).
- `Tables<'subscriptions'>` / `TablesInsert<'subscriptions'>` — referenced when typing `upsertRow` (avoid passing extra fields beyond `Insert`).
- `Tables<'webhook_events'>` / `TablesInsert<'webhook_events'>` — for the idempotency upsert.

Local module-internal types (kept in the route file; not exported):

- `PaddlePayload` — minimal narrowed shape `{ event_type?, event_id?, occurred_at?, data? }`.
- `PaddleData` — narrowed `data` shape covering all observed sub-fields (`id`, `status`, `customer.{id,email}`, `customer_id`, `customData`/`custom_data`, `items[].price.id`, `current_billing_period`, `scheduled_change`, `email`).
- `AdminClient = ReturnType<typeof createAdminClient>` — passed to handler helpers.

The `customData` / `custom_data` duplication is intentional: Paddle ships the inline-checkout key as `customData` and the API-created subscriptions key as `custom_data`. Reading both keeps the handler robust without an extra normalisation pass.

## 4. Response Details

### Success — 200 (processed, first delivery)

```json
{ "received": true }
```

### Success — 200 (duplicate, idempotency hit)

```json
{ "received": true, "duplicate": true }
```

### Success — 200 (orphan or unsupported event)

Response body is `{ "received": true }` — orphan lookup failures and unhandled `event_type` values must NOT escalate to 5xx. Reasoning: Paddle retries on any non-2xx, and we never want to block a webhook indefinitely while ops triages a missing user. Orphans are diagnosed via Vercel logs (`console.warn` lines).

### Error responses

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "missing_signature" }` | `paddle-signature` header absent. |
| 400 | `{ "error": "invalid_signature" }` | HMAC mismatch (also: malformed header missing `ts` or `h1`). |
| 400 | `{ "error": "invalid_payload", "message": "malformed JSON in payload" }` | `JSON.parse` threw on the raw body. |
| 400 | `{ "error": "invalid_payload", "message": "missing event_id, event_type or data" }` | Required top-level field absent after parse. |
| 500 | `{ "error": "internal_error", "message": "webhook secret not configured" }` | `PADDLE_WEBHOOK_SECRET` env var missing at boot. |
| 500 | `{ "error": "internal_error", "message": "<db error>" }` | `webhook_events` insert failed (DB unreachable, constraint mismatch, etc.). |
| 500 | `{ "error": "internal_error" }` | Dispatch (subscription/customer upsert) threw. Paddle will retry; dispatch is idempotent on `paddle_subscription_id` / `paddle_customer_id`. |

Response headers: default `Content-Type: application/json` from `NextResponse.json`. No `Cache-Control` (Next.js Route Handler defaults are sufficient for a webhook).

## 5. Data Flow

```
Paddle ──POST raw JSON+sig──▶ /api/paddle/webhook (route.ts)
                                │
                                ├─ 1. read raw body (request.text())
                                ├─ 2. verify HMAC over `${ts}:${rawBody}`            (timing-safe)
                                ├─ 3. JSON.parse(rawBody) → narrow to PaddlePayload
                                ├─ 4. validate event_id / event_type / data present
                                ├─ 5. createAdminClient()  ───────────────────────▶ Supabase service_role
                                │                                                  (bypass RLS, bypass
                                │                                                   block_protected_columns_update)
                                ├─ 6. dispatch by event_type  ────────────────────▶
                                │       subscription.*  → upsert subscriptions     (DB triggers refresh
                                │                                                   user_profiles.plan and
                                │                                                   sync paddle_customer_id)
                                │       customer.*      → update user_profiles
                                │                          .paddle_customer_id
                                │       (other)         → no-op (logged)
                                │
                                ├─ 7. upsert webhook_events ON CONFLICT DO NOTHING ▶ idempotency check
                                │      ignoreDuplicates=true; .select('id')
                                │      empty array  → duplicate → 200 {duplicate:true}
                                │      one row      → first delivery
                                │      processed_at = now() in same INSERT
                                │
                                └─ 8. return 200 { received: true }
```

### Database interactions per branch

`subscription.*`:

1. Lookup `user_id` (3-step priority — see §6 Lookup) using `createAdminClient()`.
2. `supabase.from('subscriptions').upsert(row, { onConflict: 'paddle_subscription_id' })` — `row` includes `user_id` (may be `null` for orphan), `paddle_subscription_id`, `paddle_customer_snapshot`, `status`, `plan_tier`, `current_period_start`, `current_period_end`, `cancel_at`.
3. DB trigger `subscriptions_after_iu_refresh_plan` recomputes `user_profiles.plan` via `refresh_user_plan_from_subscriptions(user_id)` for both `OLD.user_id` and `NEW.user_id`.
4. DB trigger `subscriptions_after_iu_sync_customer` writes `paddle_customer_snapshot` → `user_profiles.paddle_customer_id` if the latter is `NULL` (recovers an out-of-order `subscription.created` arriving before `customer.created`).

`customer.*`:

1. Lookup `user_id`.
2. `supabase.from('user_profiles').update({ paddle_customer_id }).eq('id', userId)` — bypasses `block_protected_columns_update` because the trigger has a `current_user IN ('postgres','service_role')` exemption (migration `20260509000000_paddle_webhook_hardening.sql`).
3. Skip cleanly if `userId` is `null` (warn-and-return — recovery via subsequent `subscription.*` projection).

### `lookup_user_id` priority chain

1. `data.customData.user_id` ?? `data.custom_data.user_id` — preferred, set by `Paddle.Checkout.open({ customData: { user_id } })`. PR checklist enforces this for every checkout call.
2. `select id from user_profiles where paddle_customer_id = <customer_id>` — works after `customer.created` has projected.
3. `supabase.rpc('lookup_user_id_by_email', { p_email })` — `SECURITY DEFINER`, `service_role`-only. Wraps `select id from auth.users where lower(email) = lower(p_email)` because `auth.users` is not exposed via PostgREST (`from('users', { schema: 'auth' })` returns `relation does not exist`). Replaces the older `auth.admin.listUsers({ perPage: 200 })` which silently dropped users beyond page 1.
4. None matched → return `null`. Caller logs `console.warn('[paddle/webhook] orphan ...')` with `eventId`, `eventType`, `customerId`, `email` and continues; Paddle still gets 200.

## 6. Security Considerations

- **HMAC verification BEFORE parsing.** Keep the order `request.text()` → `verifySignature(rawBody, header, secret)` → `JSON.parse(rawBody)`. Parsing untrusted JSON before verifying is a payload-poisoning vector (large/deeply nested input → CPU/memory abuse) and trivially bypassable by attackers who can hit the public URL.
- **Timing-safe comparison.** Use `crypto.timingSafeEqual(Buffer.from(computed,'hex'), Buffer.from(h1,'hex'))`. Length-mismatch must short-circuit to `false` before `timingSafeEqual` (which throws on length mismatch). Never use `===` on the digest.
- **Signature header parser tolerance.** Split on `;`, then on `=`, trim. Handle missing `ts` or `h1` as `invalid_signature` (not 500). Do **not** require a strict ordering of params — Paddle may add fields later.
- **`PADDLE_WEBHOOK_SECRET` must be present.** Treat absence as 500 `internal_error` and log loudly. Never silently 200 in this case (would let unsigned events through after a misconfiguration).
- **Service role usage justification.** `createAdminClient()` is the only correct client here:
  - `webhook_events` has RLS enabled with **zero policies** — only `service_role` can read or write it.
  - `user_profiles.paddle_customer_id` and `user_profiles.plan` are guarded by `block_protected_columns_update`, which exempts `current_user IN ('postgres','service_role')`. The session client (`authenticated` role) would be rejected.
- **Boundary discipline.** This handler is one of only three call-sites allowed to use `createAdminClient()` (alongside `/api/cron/expire-subscriptions` and `/api/cron/cleanup-webhook-events`). Do not reuse it elsewhere; add new admin-context handlers explicitly.
- **No `auth.getUser()` here** — there is no session. Lookup is via DB by `customData`, `paddle_customer_id`, or email.
- **PII in logs.** `console.warn` orphan logs may include the customer email. Acceptable in Vercel logs (server-side, encrypted-at-rest, accessible only to project members) — do not echo it to the response body. Never log full payload bodies (signatures, card metadata).
- **Replay protection** is delegated to the `webhook_events` UNIQUE constraint — a replayed event hits idempotency and gets `duplicate: true`. We do **not** additionally validate `ts` recency — Paddle handles delivery windowing on their side, and clock skew rejections would convert legitimate retries into permanent failures.
- **POST-only.** The route exports `POST` only. Vercel returns 405 for other methods automatically; do not add `GET`/`OPTIONS`/`HEAD` (preflight is irrelevant — Paddle calls server-to-server).

## 7. Error Handling

Mapping table (status → code → trigger → recovery):

| Status | Code | Trigger | Recovery / Notes |
|---|---|---|---|
| 400 | `missing_signature` | `request.headers.get('paddle-signature')` is `null`. | Caller misconfigured. No retry useful. |
| 400 | `invalid_signature` | HMAC mismatch, malformed header (no `ts` or `h1`), or hex-buffer length mismatch. | Paddle should not retry; if they do, the result is the same. |
| 400 | `invalid_payload` (`"malformed JSON in payload"`) | `JSON.parse(rawBody)` threw. | Indicates malicious or test traffic; signature check passed only if attacker had the secret — extremely unlikely, log loudly. |
| 400 | `invalid_payload` (`"missing event_id, event_type or data"`) | Required top-level field absent after parse. | Schema drift on Paddle side — open ticket. |
| 500 | `internal_error` (`"webhook secret not configured"`) | `process.env.PADDLE_WEBHOOK_SECRET` falsy. | Configuration bug. Vercel will alert; Paddle will retry. |
| 500 | `internal_error` (`<db error>`) | `webhook_events` upsert returned `error`. | Paddle retries (5xx). Idempotency unaffected because the row was not committed. |
| 500 | `internal_error` (no message) | Dispatch threw (e.g. transient DB error during subscriptions upsert). | Paddle retries. Marker not yet written — retry will redo dispatch (idempotent on `onConflict: 'paddle_subscription_id'`). |
| 200 | n/a (warn-only) | Unsupported `event_type` (not `subscription.*` / `customer.*`). | Logged, marker written, never retried. Add a handler if a new event becomes relevant. |
| 200 | n/a (warn-only) | Subscription event with incomplete `data` (missing `subId`/`customerId`/unmapped `status` or unknown `price_id`). | Logged with `console.warn` including `rawStatus`, `rawPriceId`. Marker still written so Paddle stops retrying. **Watch for `rawPriceId` warnings** — they indicate a new plan was added in Paddle without updating env vars. |
| 200 | n/a (warn-only) | Lookup chain returned `null`. | `subscription.*` row is upserted with `user_id = NULL`. Recovery: ops `UPDATE subscriptions SET user_id = ... WHERE paddle_subscription_id = ...`; the trigger refreshes `user_profiles.plan` automatically. |

### "Dispatch before marker" ordering rationale

The marker insert happens **after** the business projection, in this exact order:

1. Verify signature.
2. Parse + validate payload.
3. Dispatch (`subscription.*` or `customer.*`).
4. Upsert into `webhook_events` with `processed_at = now()`.
5. If step 4 returns no row (UNIQUE conflict), return `{ duplicate: true }`.

This is deliberate. If we wrote the marker first and dispatch then failed, Paddle would retry, hit the marker, and we would silently drop the projection. With "dispatch first":

- Dispatch fails → 500 → Paddle retries → marker still absent → dispatch runs again. Both upserts (subscriptions and user_profiles) are idempotent on natural keys.
- Dispatch succeeds, marker insert fails → 500 → Paddle retries → idempotent dispatch is a no-op → marker insert succeeds on retry.
- Both succeed → 200, future deliveries duplicate-out.

The only failure mode that loses information is "process crashes between steps 3 and 4" (event projected but never marked). Paddle retries fix it. We accept the duplicate-projection-on-retry cost in exchange for never silently dropping a state change.

### Logging / observability

- `console.warn` with structured fields for every orphan or incomplete-data branch (`eventId`, `eventType`, `customerId`, `rawStatus`, `rawPriceId`, `email`).
- Treat warnings as alertable in production (Vercel log drains → Sentry/Logflare when wired).
- No DB-side error log table is required; `webhook_events.payload` already retains the full raw event for forensic replay.

## 8. Performance Considerations

- **Hot path is short and DB-bound** — three round-trips at most (lookup query, dispatch upsert, marker upsert) plus an optional RPC for email lookup. Latency budget: < 250 ms p95 on `fra1` (Vercel) ↔ Frankfurt (Supabase).
- **Single body read.** `await request.text()` is called exactly once; the parsed JSON is reused for both validation and the `payload` JSONB column. Re-reading the body would throw (`Body is unusable`).
- **Idempotency via UNIQUE + `ignoreDuplicates: true`.** This avoids a fragile error-code-string match on `23505`. The empty result array unambiguously signals duplicate.
- **`maybeSingle` for `paddle_customer_id` lookup** — returns `null` on no-match without throwing. Cheaper than `single()` + try/catch.
- **RPC instead of `auth.admin.listUsers`** — `lookup_user_id_by_email` is a single indexed `SELECT ... FROM auth.users WHERE lower(email) = lower($1)`. Replaces the prior `listUsers({ perPage: 200 })` which (a) loaded up to 200 rows, (b) silently lost users beyond page 1.
- **No request-time fan-out.** All DB writes are awaited serially. Parallelising would not help: dispatch must complete before the marker write to preserve the "dispatch-before-marker" invariant.
- **Cron retention.** `webhook_events` is pruned by `/api/cron/cleanup-webhook-events` (90-day retention). Without it the table grows unbounded and `paddle-signature` HMAC stays cheap but UNIQUE-index bloat slows the marker upsert. Pre-merge to `main` must verify both endpoints exist (CLAUDE.md PR checklist).
- **No edge runtime.** `node:crypto` is not available on Edge; the route runs on the Node runtime. Cold-start in `fra1` is ~150 ms — acceptable for a Paddle webhook (retries swallow first-call latency anyway).

## 9. Implementation Steps

The route handler exists at `src/app/api/paddle/webhook/route.ts` and implements the full plan. The steps below describe the implementation in review order — use them as a checklist for code-review and as the rebuild recipe if the file is regenerated.

1. **Create the file** `src/app/api/paddle/webhook/route.ts` with `'use server'` semantics implicit (Route Handler) and Node runtime (default — do **not** add `export const runtime = 'edge'`).
2. **Imports.** `createAdminClient` from `@/lib/supabase/server`; `Json` from `@/types/database`; `NextResponse` from `next/server`; `crypto` from `node:crypto`.
3. **Define narrow types.** `PaddlePayload` and `PaddleData` (file-local). Do not export.
4. **Define `err(code, status, message?)` helper.** Returns `NextResponse.json({ error, message? }, { status })`. Error codes must come from `PaddleWebhookApiErrorCode` (`missing_signature`, `invalid_signature`, `invalid_payload`, `internal_error`).
5. **Implement `verifySignature(rawBody, header, secret)`.** Parse `ts=<n>;h1=<hex>` tolerantly; compute `HMAC-SHA256(secret).update(`${ts}:${rawBody}`)`; compare with `crypto.timingSafeEqual` after a length pre-check. Return `false` for any malformed header.
6. **Implement `mapStatus(s)`** — pure map from input string to `SubscriptionStatus | null`. Reject anything not in the DB enum.
7. **Implement `planTierFromPriceId(id)`** — pure map using `process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY` / `..._PRO_ANNUAL`. Returns `SubscriptionPlanTier | null`. Treat unknown price IDs as `null` and log via `console.warn` upstream (caller path).
8. **Export `async function POST(request: Request)`:**
   1. Read `process.env.PADDLE_WEBHOOK_SECRET`. Missing → `err('internal_error', 500, 'webhook secret not configured')`.
   2. `request.headers.get('paddle-signature')`. Missing → `err('missing_signature', 400)`.
   3. `const rawBody = await request.text();`
   4. `verifySignature(rawBody, header, secret)` → `false` → `err('invalid_signature', 400)`.
   5. `JSON.parse(rawBody)` inside `try/catch` → catch → `err('invalid_payload', 400, 'malformed JSON in payload')`.
   6. Validate `event_id`, `event_type`, `data` are all present → otherwise `err('invalid_payload', 400, 'missing event_id, event_type or data')`.
   7. `const supabase = createAdminClient();`
   8. Dispatch `try { ... } catch { return err('internal_error', 500); }`:
      - `eventType.startsWith('subscription.')` → `await handleSubscriptionEvent(supabase, payload, data)`.
      - `eventType.startsWith('customer.')` → `await handleCustomerEvent(supabase, payload, data)`.
      - Otherwise: skip silently (still writes the marker so Paddle stops retrying).
   9. Upsert `webhook_events` with `{ provider: 'paddle', external_event_id: eventId, event_type: eventType, payload: payload as unknown as Json, processed_at: new Date().toISOString() }`, `{ onConflict: 'provider,external_event_id', ignoreDuplicates: true }`, `.select('id')`.
   10. `insertError` non-null → `err('internal_error', 500, insertError.message)`.
   11. Empty inserted array → `NextResponse.json({ received: true, duplicate: true })`.
   12. Otherwise → `NextResponse.json({ received: true })`.
9. **Implement `handleSubscriptionEvent(supabase, payload, data)`.**
   - Pull `subId`, `customerId` (`data.customer?.id ?? data.customer_id`), `status` (via `mapStatus`), `planTier` (via `planTierFromPriceId(data.items?.[0]?.price?.id)`).
   - Any missing → `console.warn('[paddle/webhook] subscription event with incomplete data — no state update', {...})` and **return** without DB write. Marker still gets written upstream.
   - Otherwise call `lookupUserId(supabase, data)`. `null` → `console.warn('[paddle/webhook] orphan subscription event — user lookup failed', {...})` and continue with `user_id: null`.
   - `await supabase.from('subscriptions').upsert(row, { onConflict: 'paddle_subscription_id' });` — row must include all six business fields plus `user_id`, `paddle_customer_snapshot`, and the optional period/cancel timestamps.
10. **Implement `handleCustomerEvent(supabase, payload, data)`.**
    - `customerId = data.id ?? data.customer_id`. Missing → return.
    - `userId = await lookupUserId(supabase, data)`. `null` → `console.warn('[paddle/webhook] orphan customer event — user lookup failed', {...})` and return.
    - `await supabase.from('user_profiles').update({ paddle_customer_id: customerId }).eq('id', userId);` — relies on the `service_role` exemption in `block_protected_columns_update`.
11. **Implement `lookupUserId(supabase, data)`.**
    - Step 1: `data.custom_data?.user_id ?? data.customData?.user_id`. Found → return.
    - Step 2: `customer_id = data.customer?.id ?? data.customer_id ?? data.id`. If present, `select id from user_profiles where paddle_customer_id = $1` via `.maybeSingle()`. Found → return.
    - Step 3: `email = data.customer?.email ?? data.email`. If present, `supabase.rpc('lookup_user_id_by_email', { p_email: email })`. Found → return.
    - Else `null`.
12. **Verify env vars are documented.** `PADDLE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY`, `NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL` must be present in `.env.example` with comments. (Already in `tech-stack.md` §13.)
13. **Verify migrations are applied.** Required: `20260507000000_complete_schema.sql` (tables + triggers `subscriptions_after_iu_refresh_plan`, `subscriptions_after_iu_sync_customer`, `block_protected_columns_update`), `20260509000000_paddle_webhook_hardening.sql` (RPC `lookup_user_id_by_email` + `current_user IN ('postgres','service_role')` exemption in the protected-columns trigger).
14. **`pnpm verify:routes`.** Confirms the `route.ts` file exists where `vercel.json` and the spec expect it.
15. **Tests.** Add unit tests in `src/app/api/paddle/webhook/route.test.ts` covering:
    - Missing `paddle-signature` → 400 `missing_signature`.
    - Bad HMAC → 400 `invalid_signature`.
    - Malformed JSON (signature valid) → 400 `invalid_payload`.
    - Missing `event_id` → 400 `invalid_payload`.
    - Valid `subscription.activated` with `customData.user_id` → 200 `received: true` and `subscriptions` upsert called once with the expected row.
    - Same event replayed → 200 `received: true, duplicate: true` and dispatch NOT re-called on first hit (but tolerated if it is — idempotency is the contract, not the implementation order).
    - `subscription.activated` with unknown `price_id` → 200, `console.warn` emitted, no `subscriptions` write.
    - `customer.updated` with email-only lookup → calls `lookup_user_id_by_email` RPC and updates `user_profiles.paddle_customer_id`.
    - Orphan `subscription.created` (no lookup match) → 200, `subscriptions` row upserted with `user_id: null`.
    - Mock `createAdminClient()` and `console.warn`. Use `vitest`'s `vi.mock('@/lib/supabase/server', ...)`.
16. **Manual smoke test (sandbox).** Configure Paddle sandbox webhook to point at the Vercel preview URL, set `PADDLE_WEBHOOK_SECRET` to the sandbox secret, perform a checkout. Verify:
    - `webhook_events` row appears with `processed_at` set.
    - `subscriptions` row appears, `user_id` populated (because `customData.user_id` was sent).
    - `user_profiles.plan` flips to `'pro'` automatically (`subscriptions_after_iu_refresh_plan` trigger).
    - `user_profiles.paddle_customer_id` populated (`subscriptions_after_iu_sync_customer` trigger or `customer.created` projection — whichever arrives first).
17. **PR review checklist (per CLAUDE.md).** Confirm: HMAC verified before parse; `customData: { user_id }` is set in every `Paddle.Checkout.open(...)` call site; `vercel.json` has no cron entries pointing at this route (it's webhook-only, not cron); `lookup_user_id_by_email` RPC + protected-columns exemption migration is applied to the target environment.
