import { type NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  // Supabase session refresh chain (analiza §4 / tech-stack §7) — placeholder.
  // Po podpięciu Supabase: wywołaj updateSession() z @supabase/ssr przed intl.
  const response = intlMiddleware(request);
  return response ?? NextResponse.next();
}

export const config = {
  matcher: [
    // Skip all internal Next.js paths and static files unless found in search params
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)'
  ]
};
