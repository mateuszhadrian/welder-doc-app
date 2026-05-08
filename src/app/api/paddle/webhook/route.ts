import { createAdminClient } from '@/lib/supabase/server';
import type { Json } from '@/types/database';
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

// Kontrakt: `api-plan.md` §2.1 (`POST /api/paddle/webhook`).
// 1. Weryfikacja `paddle-signature` (HMAC-SHA256 z `PADDLE_WEBHOOK_SECRET`).
// 2. Dispatch po `event_type` PRZED idempotency markerem — tak, by częściowa
//    awaria (idempotency insert padnie po udanym dispatchu) była naprawiana
//    przez Paddle retry zamiast cicho gubić zdarzenia (problems-v6 §2.2).
//    - `subscription.*` → upsert do `subscriptions` (klucz `paddle_subscription_id`)
//    - `customer.*`     → aktualizacja `user_profiles.paddle_customer_id`
//    Trigger DB `subscriptions_after_iu_refresh_plan` przelicza `user_profiles.plan`.
// 3. Idempotencja przez `webhook_events` upsert z `ignoreDuplicates`; pusta
//    tablica wynikowa = duplikat.
// 4. Lookup użytkownika: `customData.user_id` → `paddle_customer_id` → email
//    (RPC `lookup_user_id_by_email`, skaluje się dowolnie — problems-v6 §1.1).

type PaddlePayload = {
  event_type?: string;
  event_id?: string;
  occurred_at?: string;
  data?: PaddleData;
};

type PaddleData = {
  id?: string;
  status?: string;
  customer?: { id?: string; email?: string };
  customer_id?: string;
  custom_data?: { user_id?: string } | null;
  customData?: { user_id?: string } | null;
  items?: Array<{ price?: { id?: string } }>;
  current_billing_period?: { starts_at?: string; ends_at?: string };
  scheduled_change?: { effective_at?: string } | null;
  email?: string;
};

function err(code: string, status: number, message?: string) {
  const body: Record<string, string> = { error: code };
  if (message) body.message = message;
  return NextResponse.json(body, { status });
}

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  // Paddle signature: `ts=1746703200;h1=<hex>` — HMAC-SHA256 z `${ts}:${rawBody}`.
  const parts = Object.fromEntries(
    header.split(';').map((part) => {
      const [k, v] = part.split('=');
      return [k?.trim() ?? '', v?.trim() ?? ''];
    })
  );
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  const computed = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(h1, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function planTierFromPriceId(priceId: string | undefined): 'pro_monthly' | 'pro_annual' | null {
  if (!priceId) return null;
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_MONTHLY) return 'pro_monthly';
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_ID_PRO_ANNUAL) return 'pro_annual';
  return null;
}

function mapStatus(
  s: string | undefined
): 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | null {
  if (
    s === 'trialing' ||
    s === 'active' ||
    s === 'past_due' ||
    s === 'paused' ||
    s === 'canceled'
  ) {
    return s;
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    return err('internal_error', 500, 'webhook secret not configured');
  }

  const signatureHeader = request.headers.get('paddle-signature');
  if (!signatureHeader) {
    return err('missing_signature', 400);
  }

  const rawBody = await request.text();
  if (!verifySignature(rawBody, signatureHeader, secret)) {
    return err('invalid_signature', 400);
  }

  let payload: PaddlePayload;
  try {
    payload = JSON.parse(rawBody) as PaddlePayload;
  } catch {
    return err('invalid_payload', 400, 'malformed JSON in payload');
  }

  const eventId = payload.event_id;
  const eventType = payload.event_type;
  const data = payload.data;

  if (!eventId || !eventType || !data) {
    // Bez identyfikatora zdarzenia idempotencja nie działa. Sygnatura została już
    // zwalidowana wyżej — to nie jest `invalid_signature`, ale malformed payload
    // (np. Paddle zmienił schemat lub testowy webhook bez pełnego body).
    return err('invalid_payload', 400, 'missing event_id, event_type or data');
  }

  const supabase = createAdminClient();

  // KOLEJNOŚĆ: dispatch PRZED idempotency markerem (problems-v6 §2.2).
  // Jeśli dispatch padnie → zwracamy 500, Paddle retry'uje, idempotency
  // jeszcze nie zapisane więc retry wykona dispatch ponownie. Idempotentne
  // upserty na `paddle_subscription_id` / `paddle_customer_id` są bezpieczne
  // przy powtórzeniu.
  try {
    if (eventType.startsWith('subscription.')) {
      await handleSubscriptionEvent(supabase, payload, data);
    } else if (eventType.startsWith('customer.')) {
      await handleCustomerEvent(supabase, payload, data);
    }
  } catch {
    return err('internal_error', 500);
  }

  // Idempotency marker zapisywany po udanym dispatchu, z `processed_at = now()`
  // wpisanym w jednym INSERT. `upsert + ignoreDuplicates` daje pustą tablicę
  // dla duplikatu (problems-v6 §2.1) — bez fragile error-code matchingu.
  const { data: insertedEvents, error: insertError } = await supabase
    .from('webhook_events')
    .upsert(
      {
        provider: 'paddle',
        external_event_id: eventId,
        event_type: eventType,
        payload: payload as unknown as Json,
        processed_at: new Date().toISOString()
      },
      { onConflict: 'provider,external_event_id', ignoreDuplicates: true }
    )
    .select('id');

  if (insertError) {
    return err('internal_error', 500, insertError.message);
  }

  if (!insertedEvents || insertedEvents.length === 0) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  return NextResponse.json({ received: true });
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function handleSubscriptionEvent(
  supabase: AdminClient,
  payload: PaddlePayload,
  data: PaddleData
): Promise<void> {
  const subId = data.id;
  const customerId = data.customer?.id ?? data.customer_id;
  const status = mapStatus(data.status);
  const planTier = planTierFromPriceId(data.items?.[0]?.price?.id);

  if (!subId || !customerId || !status || !planTier) {
    // Niepełne dane — log w `webhook_events.payload`; brak update'u stanu.
    // Warning emitujemy też do Vercel logs (operations dashboard) — ciche pominięcie
    // przy nowym `price_id` (np. testowy plan pre-launch) maskuje upgrade fail
    // dopóki użytkownik nie zgłosi problemu.
    console.warn('[paddle/webhook] subscription event with incomplete data — no state update', {
      eventId: payload.event_id,
      eventType: payload.event_type,
      hasSubId: !!subId,
      hasCustomerId: !!customerId,
      hasStatus: !!status,
      hasPlanTier: !!planTier,
      rawStatus: data.status,
      rawPriceId: data.items?.[0]?.price?.id
    });
    return;
  }

  const userId = await lookupUserId(supabase, data);

  if (!userId) {
    // api-plan.md §2.1: webhook może przyjść przed rejestracją lub gdy customer
    // ma email niedopasowany do żadnego konta. Zaloguj warning, kontynuuj
    // (subscription zapisana z user_id = NULL; recovery przez UPDATE później).
    console.warn('[paddle/webhook] orphan subscription event — user lookup failed', {
      eventId: payload.event_id,
      eventType: payload.event_type,
      customerId,
      email: data.customer?.email ?? data.email
    });
  }

  const upsertRow = {
    user_id: userId,
    paddle_subscription_id: subId,
    paddle_customer_snapshot: customerId,
    status,
    plan_tier: planTier,
    current_period_start: data.current_billing_period?.starts_at ?? null,
    current_period_end: data.current_billing_period?.ends_at ?? null,
    cancel_at: data.scheduled_change?.effective_at ?? null
  };

  await supabase.from('subscriptions').upsert(upsertRow, { onConflict: 'paddle_subscription_id' });
}

async function handleCustomerEvent(
  supabase: AdminClient,
  payload: PaddlePayload,
  data: PaddleData
): Promise<void> {
  const customerId = data.id ?? data.customer_id;
  if (!customerId) return;

  const userId = await lookupUserId(supabase, data);
  if (!userId) {
    console.warn('[paddle/webhook] orphan customer event — user lookup failed', {
      eventId: payload.event_id,
      eventType: payload.event_type,
      customerId,
      email: data.customer?.email ?? data.email
    });
    return;
  }

  await supabase.from('user_profiles').update({ paddle_customer_id: customerId }).eq('id', userId);
}

async function lookupUserId(supabase: AdminClient, data: PaddleData): Promise<string | null> {
  const customDataUserId = data.custom_data?.user_id ?? data.customData?.user_id;
  if (customDataUserId) return customDataUserId;

  const customerId = data.customer?.id ?? data.customer_id ?? data.id;
  if (customerId) {
    const { data: byCustomer } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('paddle_customer_id', customerId)
      .maybeSingle();
    if (byCustomer?.id) return byCustomer.id;
  }

  const email = data.customer?.email ?? data.email;
  if (email) {
    // RPC `lookup_user_id_by_email` (SECURITY DEFINER, service_role only) —
    // skaluje się do dowolnej liczby użytkowników (problems-v6 §1.1). Zastępuje
    // wcześniejsze `auth.admin.listUsers({ perPage: 200 })` które gubiło użytkowników
    // poza pierwszą stroną paginacji.
    const { data: userId } = await supabase.rpc('lookup_user_id_by_email', { p_email: email });
    if (userId) return userId;
  }

  return null;
}
