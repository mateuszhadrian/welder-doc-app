import { createClient } from '@/lib/supabase/server';
import { listConsentLog } from '@/lib/supabase/consentLog';
import { NextResponse } from 'next/server';
import type {
  UserExportDto,
  TypedApiErrorDto,
  UserExportApiErrorCode,
  CanvasDocument
} from '@/types/api';

// Kontrakt: `api-plan.md` §2.1 (`GET /api/user/export`).
// RODO art. 20 — prawo do przenoszenia danych. Eksport: profil + dokumenty
// + consent_log dla zalogowanego użytkownika. Wszystko czytane przez sesję
// (`createServerClient`) + RLS, bez service_role.

type ErrorBody = TypedApiErrorDto<UserExportApiErrorCode>;

export async function GET(): Promise<NextResponse<UserExportDto | ErrorBody>> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json<ErrorBody>({ error: 'unauthorized' }, { status: 401 });
  }

  const [profileRes, documentsRes, consentRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('plan, locale, current_consent_version, created_at')
      .eq('id', user.id)
      .single(),
    supabase
      .from('documents')
      .select('id, name, schema_version, created_at, updated_at, data')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true }),
    listConsentLog(supabase)
  ]);

  if (profileRes.error) {
    console.error('[user/export] profile_error', { user_id: user.id, code: profileRes.error.code });
    return NextResponse.json<ErrorBody>({ error: 'internal_error' }, { status: 500 });
  }
  if (documentsRes.error) {
    console.error('[user/export] documents_error', {
      user_id: user.id,
      code: documentsRes.error.code
    });
    return NextResponse.json<ErrorBody>({ error: 'internal_error' }, { status: 500 });
  }
  if (consentRes.error) {
    console.error('[user/export] consent_error', {
      user_id: user.id,
      business: consentRes.error.business,
      code: consentRes.error.rawCode
    });
    return NextResponse.json<ErrorBody>({ error: 'internal_error' }, { status: 500 });
  }

  const exportedAt = new Date().toISOString();
  const filename = `welderdoc-export-${exportedAt.slice(0, 10)}.json`;

  const body: UserExportDto = {
    user_id: user.id,
    exported_at: exportedAt,
    email: user.email ?? '',
    profile: profileRes.data,
    documents: (documentsRes.data ?? []).map((d) => ({
      ...d,
      data: d.data as unknown as CanvasDocument
    })),
    consent_log: consentRes.data
  };

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  }) as NextResponse<UserExportDto>;
}
