import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type {
  DeleteAccountApiErrorCode,
  DeleteAccountCommand,
  DeleteAccountResponseDto,
  TypedApiErrorDto
} from '@/types/api';

/**
 * DELETE /api/user/account — RODO art. 17 (right to be forgotten).
 *
 * Three isolated Supabase clients per api-plan.md §2.1:
 *   1. Session client (createClient)        — verify JWT, sign-out cookies after.
 *   2. Temporary anon client (no cookies)   — re-auth via signInWithPassword without
 *                                              overwriting the active session cookies.
 *   3. Admin client (service-role)          — auth.admin.deleteUser; cascades via FK.
 *
 * Cascade: user_profiles / documents / consent_log → DELETE; subscriptions →
 * SET NULL on user_id (audit trail retained); webhook_events → unaffected
 * (cron rotates after 90 days).
 */

function err(code: DeleteAccountApiErrorCode, status: number) {
  return NextResponse.json<TypedApiErrorDto<DeleteAccountApiErrorCode>>(
    { error: code },
    { status }
  );
}

export async function DELETE(request: Request) {
  try {
    // 1. Session — auth.getUser() MUST be the first Supabase contact so
    //    @supabase/ssr revalidates the JWT and refreshes cookies.
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user || !user.email) {
      return err('unauthorized', 401);
    }

    // 2. Body parse + validation.
    let body: Partial<DeleteAccountCommand>;
    try {
      body = (await request.json()) as Partial<DeleteAccountCommand>;
    } catch {
      return err('invalid_payload', 400);
    }

    const { password, confirmation } = body;
    if (typeof password !== 'string' || password.length === 0 || confirmation === undefined) {
      return err('missing_fields', 400);
    }
    if (confirmation !== 'DELETE') {
      return err('invalid_confirmation', 400);
    }

    // 3. Re-auth on a temporary client to avoid overwriting the active
    //    session cookies. Supabase unifies "wrong password" and
    //    "user not found" into the same `Invalid login credentials`
    //    response (anti-enumeration) — we map both to invalid_password.
    const tempClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );
    const { error: signInErr } = await tempClient.auth.signInWithPassword({
      email: user.email,
      password
    });
    if (signInErr) {
      const message = signInErr.message ?? '';
      if (signInErr.status === 429 || /rate limit/i.test(message)) {
        return err('rate_limited', 429);
      }
      // Any other signIn failure is treated as bad credentials. We do
      // NOT leak the underlying message to the client.
      return err('invalid_password', 401);
    }

    // 4. Hard delete — cascades through Postgres FK.
    const admin = createAdminClient();
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error('[delete-account] admin.deleteUser failed', user.id, delErr);
      return err('internal_error', 500);
    }

    // 5. Sign out the session client — clears `sb-*` cookies on the response.
    //    The user already no longer exists; tolerate any error here.
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[delete-account] post-delete signOut failed (non-fatal)', e);
    }

    // 6. Success.
    const responseBody: DeleteAccountResponseDto = {
      deleted: true,
      user_id: user.id,
      deleted_at: new Date().toISOString()
    };
    return NextResponse.json(responseBody, { status: 200 });
  } catch (e) {
    console.error('[delete-account] unhandled', e);
    return err('internal_error', 500);
  }
}
