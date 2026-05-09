import { createClient } from '@/lib/supabase/server';
import { anonymizeIp, pickForwardedFor } from '@/lib/ipAnonymize';
import { lookupIdempotency, storeIdempotency, hashPayload } from '@/lib/idempotency';
import type {
  ConsentType,
  ConsentApiErrorCode,
  TypedApiErrorDto,
  ConsentInsertedItemDto,
  RecordConsentBundleResponseDto,
  RecordConsentSingleResponseDto
} from '@/types/api';
import { NextResponse } from 'next/server';

// Kontrakt: `api-plan.md` §2.1 (`POST /api/consent`).
// - Bundle (`types: [...]`) atomowo przez RPC `record_consent_bundle()`
//   (`SECURITY DEFINER`, migracja `20260508000000_record_consent_bundle.sql`).
// - Per-type (`consent_type: ...`) — pojedynczy INSERT przez sesję + RLS.
// IP anonimizowane przed zapisem (RODO motyw 30) przez `src/lib/ipAnonymize.ts`.
// Idempotency-Key (UUID v4) — in-memory cache TTL 60 s, klucz `user.id:key`.

const CONSENT_TYPES: readonly ConsentType[] = ['terms_of_service', 'privacy_policy', 'cookies'];

function isConsentType(value: unknown): value is ConsentType {
  return typeof value === 'string' && (CONSENT_TYPES as readonly string[]).includes(value);
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function err(code: ConsentApiErrorCode, status: number) {
  return NextResponse.json<TypedApiErrorDto<ConsentApiErrorCode>>({ error: code }, { status });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return err('invalid_payload', 400);
  }

  if (!payload || typeof payload !== 'object') {
    return err('missing_fields', 400);
  }
  const body = payload as Record<string, unknown>;

  // Validate Idempotency-Key format before auth — cheaper; cache lookup happens after auth.
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey !== null && !UUID_V4.test(idempotencyKey)) {
    return err('invalid_idempotency_key', 400);
  }

  const hasTypes = 'types' in body && body.types !== undefined;
  const hasSingle = 'consent_type' in body && body.consent_type !== undefined;

  if (hasTypes === hasSingle) {
    return err('ambiguous_payload', 400);
  }

  const version = body.version;
  const accepted = body.accepted;
  if (typeof version !== 'string' || version.length === 0) return err('missing_fields', 400);
  if (typeof accepted !== 'boolean') return err('missing_fields', 400);

  // auth.getUser() must be the first Supabase call (refreshes JWT cookies).
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return err('unauthorized', 401);

  // Cache lookup scoped to user.id to prevent cross-user key collisions.
  let cacheKey: string | undefined;
  let payloadHash: string | undefined;
  if (idempotencyKey) {
    payloadHash = await hashPayload(body);
    cacheKey = `${user.id}:${idempotencyKey}`;
    const cached = lookupIdempotency(cacheKey, payloadHash);
    if (cached.kind === 'conflict') return err('idempotency_key_conflict', 409);
    if (cached.kind === 'hit') return NextResponse.json(cached.body, { status: cached.status });
  }

  const forwardedFor = pickForwardedFor(request.headers.get('x-forwarded-for'));
  const realIp = request.headers.get('x-real-ip');
  const ip = anonymizeIp(forwardedFor ?? realIp);
  const userAgent = request.headers.get('user-agent');

  if (hasTypes) {
    const types = body.types;
    if (!Array.isArray(types) || types.length === 0) return err('invalid_bundle', 400);
    if (new Set(types).size !== types.length) return err('invalid_bundle', 400);
    for (const t of types) {
      if (!isConsentType(t)) return err('invalid_consent_type', 400);
    }

    const { error: rpcError } = await supabase.rpc('record_consent_bundle', {
      p_user_id: user.id,
      p_version: version,
      p_accepted: accepted,
      p_ip: ip,
      p_user_agent: userAgent
    });

    if (rpcError) {
      // `record_consent_bundle` rzuca `unauthorized_consent_target` gdy
      // `p_user_id ≠ auth.uid()` dla `authenticated` — defense-in-depth.
      if (rpcError.message?.includes('unauthorized_consent_target')) {
        return err('unauthorized_consent_target', 403);
      }
      console.error('[POST /api/consent] RPC error', { code: rpcError.code, hint: rpcError.hint });
      return err('internal_error', 500);
    }

    const { data: inserted, error: selectError } = await supabase
      .from('consent_log')
      .select('id, consent_type, version, accepted, accepted_at')
      .eq('user_id', user.id)
      .eq('version', version)
      .in('consent_type', types as ConsentType[])
      .order('id', { ascending: true })
      .limit(types.length);

    if (selectError) {
      console.error('[POST /api/consent] consent_log select error', {
        code: selectError.code,
        hint: selectError.hint
      });
      return err('internal_error', 500);
    }

    // `current_consent_version` czytamy z DB (nie passthrough z payloadu).
    // Dla revocation RPC nie modyfikuje kolumny — zwracamy aktualną wartość z DB.
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('current_consent_version')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('[POST /api/consent] user_profiles select error', {
        code: profileError.code,
        hint: profileError.hint
      });
      return err('internal_error', 500);
    }

    const responseBody: RecordConsentBundleResponseDto = {
      inserted: (inserted ?? []) as ConsentInsertedItemDto[],
      current_consent_version: profile?.current_consent_version ?? ''
    };

    if (cacheKey && payloadHash) {
      storeIdempotency(cacheKey, payloadHash, 201, responseBody);
    }
    return NextResponse.json(responseBody, { status: 201 });
  }

  const single = body.consent_type;
  if (!isConsentType(single)) return err('invalid_consent_type', 400);

  const { data: insertedRow, error: insertError } = await supabase
    .from('consent_log')
    .insert({
      user_id: user.id,
      consent_type: single,
      version,
      accepted,
      ip_address: ip,
      user_agent: userAgent
    })
    .select('id, consent_type, version, accepted, accepted_at')
    .single();

  if (insertError) {
    console.error('[POST /api/consent] consent_log insert error', {
      code: insertError.code,
      hint: insertError.hint
    });
    return err('internal_error', 500);
  }

  const responseBody: RecordConsentSingleResponseDto = {
    id: insertedRow.id,
    user_id: user.id,
    consent_type: insertedRow.consent_type,
    version: insertedRow.version,
    accepted: insertedRow.accepted,
    accepted_at: insertedRow.accepted_at
  };

  if (cacheKey && payloadHash) {
    storeIdempotency(cacheKey, payloadHash, 201, responseBody);
  }
  return NextResponse.json(responseBody, { status: 201 });
}
