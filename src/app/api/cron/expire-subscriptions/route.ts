import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Vercel Cron handler — przelicza `user_profiles.plan` dla użytkowników
// z subskrypcjami `canceled` po grace period (`current_period_end <= now()`).
//
// Kontrakt: `api-plan.md` §2.1 (`GET /api/cron/expire-subscriptions`).
// Vercel Cron domyślnie wysyła `GET` z nagłówkiem `Authorization: Bearer ${CRON_SECRET}`.
// Wywołuje funkcję DB `refresh_expired_plans()` (`SECURITY DEFINER`).
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('refresh_expired_plans');

  if (error) {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  return NextResponse.json({
    updated: data ?? 0,
    timestamp: new Date().toISOString()
  });
}
