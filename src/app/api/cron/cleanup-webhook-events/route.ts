import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Vercel Cron handler — usuwa rekordy `webhook_events` starsze niż 90 dni.
// Kontrakt: `api-plan.md` §2.1 (`GET /api/cron/cleanup-webhook-events`).
// Wymaga klienta `service_role` — `webhook_events` ma RLS bez polityk
// (zero dostępu dla `authenticated`/`anon`).
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cutoffIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createAdminClient();

  // `count: 'exact'` zwraca liczbę usuniętych wierszy w `count`.
  const { error, count } = await supabase
    .from('webhook_events')
    .delete({ count: 'exact' })
    .lt('received_at', cutoffIso);

  if (error) {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  return NextResponse.json({
    deleted: count ?? 0,
    timestamp: new Date().toISOString()
  });
}
