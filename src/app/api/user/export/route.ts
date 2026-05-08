import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Kontrakt: `api-plan.md` §2.1 (`GET /api/user/export`).
// RODO art. 20 — prawo do przenoszenia danych. Eksport: profil + dokumenty
// + consent_log dla zalogowanego użytkownika. Wszystko czytane przez sesję
// (`createServerClient`) + RLS, bez service_role.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const [profileRes, documentsRes, consentRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('plan, locale, current_consent_version, created_at')
      .eq('id', user.id)
      .single(),
    supabase
      .from('documents')
      .select('id, name, created_at, updated_at, data')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('consent_log')
      .select('consent_type, version, accepted, accepted_at')
      .eq('user_id', user.id)
      .order('accepted_at', { ascending: false })
  ]);

  if (profileRes.error || documentsRes.error || consentRes.error) {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  const exportedAt = new Date().toISOString();
  const filename = `welderdoc-export-${exportedAt.slice(0, 10)}.json`;

  const body = {
    user_id: user.id,
    exported_at: exportedAt,
    email: user.email,
    profile: profileRes.data,
    documents: documentsRes.data ?? [],
    consent_log: consentRes.data ?? []
  };

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
