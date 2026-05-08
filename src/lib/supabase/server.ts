import { createServerClient } from '@supabase/ssr';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Wywoływane z Server Component — cookies są read-only.
            // Middleware odświeża sesję, więc można zignorować.
          }
        }
      }
    }
  );
}

/**
 * Klient service_role — omija RLS przez sam token. Używać WYŁĄCZNIE w Route
 * Handlerach po stronie serwera, gdzie potrzebny jest dostęp do operacji
 * niedostępnych dla `authenticated` (np. webhook Paddle, cron jobs).
 *
 * Service role NIE potrzebuje cookies sesji użytkownika — token sam autoryzuje
 * pełen dostęp. Użycie `createClient` z `@supabase/supabase-js` (zamiast
 * `createServerClient` z `@supabase/ssr`) eliminuje niepotrzebny handler
 * cookies + nie wymusza dynamic rendering przy zimnym starcie funkcji.
 *
 * Zgodne z `api-plan.md` §3 i `tech-stack.md` §7.
 */
export function createAdminClient() {
  return createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    }
  );
}
