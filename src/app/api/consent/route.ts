import { createClient } from '@/lib/supabase/server';
import { anonymizeIp, pickForwardedFor } from '@/lib/ipAnonymize';
import { NextResponse } from 'next/server';

// Kontrakt: `api-plan.md` §2.1 (`POST /api/consent`).
// - Bundle (`types: [...]`) atomowo przez RPC `record_consent_bundle()`
//   (`SECURITY DEFINER`, migracja `20260508000000_record_consent_bundle.sql`).
// - Per-type (`consent_type: ...`) — pojedynczy INSERT przez sesję + RLS.
// IP anonimizowane przed zapisem (RODO motyw 30) przez `src/lib/ipAnonymize.ts`.

const CONSENT_TYPES = ['terms_of_service', 'privacy_policy', 'cookies'] as const;
type ConsentType = (typeof CONSENT_TYPES)[number];

type BundleBody = {
  types: ConsentType[];
  version: string;
  accepted: boolean;
};

type SingleBody = {
  consent_type: ConsentType;
  version: string;
  accepted: boolean;
};

function isConsentType(value: unknown): value is ConsentType {
  return typeof value === 'string' && (CONSENT_TYPES as readonly string[]).includes(value);
}

function err(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
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

  const hasTypes = 'types' in body && body.types !== undefined;
  const hasSingle = 'consent_type' in body && body.consent_type !== undefined;

  if (hasTypes === hasSingle) {
    return err('ambiguous_payload', 400);
  }

  const version = body.version;
  const accepted = body.accepted;
  if (typeof version !== 'string' || version.length === 0) return err('missing_fields', 400);
  if (typeof accepted !== 'boolean') return err('missing_fields', 400);

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return err('unauthorized', 401);

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

    const bundleBody: BundleBody = { types: types as ConsentType[], version, accepted };

    const { error: rpcError } = await supabase.rpc('record_consent_bundle', {
      p_user_id: user.id,
      p_version: bundleBody.version,
      p_accepted: bundleBody.accepted,
      p_ip: ip,
      p_user_agent: userAgent
    });

    if (rpcError) {
      // `record_consent_bundle` rzuca `unauthorized_consent_target` gdy
      // `p_user_id ≠ auth.uid()` dla `authenticated` (defense-in-depth na
      // wypadek bug'a w handlerze; w obecnej implementacji nieosiągalne,
      // bo handler ustawia `p_user_id = user.id`).
      if (rpcError.message?.includes('unauthorized_consent_target')) {
        return err('unauthorized_consent_target', 403);
      }
      return err('internal_error', 500);
    }

    // RLS pozwala czytać własne wpisy — pobieramy 3 najnowsze dla typów z bundle.
    const { data: inserted, error: selectError } = await supabase
      .from('consent_log')
      .select('id, consent_type, version, accepted, accepted_at')
      .eq('user_id', user.id)
      .eq('version', bundleBody.version)
      .in('consent_type', bundleBody.types)
      .order('id', { ascending: true })
      .limit(bundleBody.types.length);

    if (selectError) {
      return err('internal_error', 500);
    }

    // `current_consent_version` w odpowiedzi = aktualna wartość z DB (nie passthrough
    // z payloadu). Dla revocation (`accepted = false`) RPC nie modyfikuje kolumny —
    // zwrócenie `null` byłoby mylące dla klienta (sugerowałoby brak aktywnej zgody,
    // gdy w bazie wciąż jest poprzednio zaakceptowana wersja).
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('current_consent_version')
      .eq('id', user.id)
      .single();

    if (profileError) {
      return err('internal_error', 500);
    }

    return NextResponse.json(
      {
        inserted: inserted ?? [],
        current_consent_version: profile?.current_consent_version ?? null
      },
      { status: 201 }
    );
  }

  const single = body.consent_type;
  if (!isConsentType(single)) return err('invalid_consent_type', 400);

  const singleBody: SingleBody = { consent_type: single, version, accepted };

  const { data: insertedRow, error: insertError } = await supabase
    .from('consent_log')
    .insert({
      user_id: user.id,
      consent_type: singleBody.consent_type,
      version: singleBody.version,
      accepted: singleBody.accepted,
      ip_address: ip,
      user_agent: userAgent
    })
    .select('id, consent_type, version, accepted, accepted_at')
    .single();

  if (insertError) {
    return err('internal_error', 500);
  }

  return NextResponse.json(
    {
      id: insertedRow.id,
      user_id: user.id,
      consent_type: insertedRow.consent_type,
      version: insertedRow.version,
      accepted: insertedRow.accepted,
      accepted_at: insertedRow.accepted_at
    },
    { status: 201 }
  );
}
