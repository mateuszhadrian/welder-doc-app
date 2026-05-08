import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Kontrakt zgodny z `api-plan.md` §2.1 (`GET /api/health`):
// - 200 `{ status: "ok", timestamp }` gdy DB osiągalna,
// - 503 `{ status: "degraded", timestamp, checks: { database: "unreachable" } }` w razie błędu.
// Świadomie NIE zwracamy `error.message` — to mogłoby wyciec topologię/PII do logów monitoringu.
// `head: true` + `count: 'exact'` weryfikuje round-trip do PostgREST bez transferu wierszy
// i działa nawet bez sesji (RLS odfiltruje wszystko, ale samo zapytanie nie błędzi).
export async function GET() {
  const timestamp = new Date().toISOString();
  const supabase = await createClient();

  const { error } = await supabase.from('documents').select('id', { count: 'exact', head: true });

  if (error) {
    return NextResponse.json(
      { status: 'degraded', timestamp, checks: { database: 'unreachable' } },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: 'ok', timestamp });
}
