import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';

// Route Handler instead of a Server Component page: Next 16 forbids cookie
// writes from Server Components, and the swallow in src/lib/supabase/server.ts
// would silently drop the session set by exchangeCodeForSession. Route
// Handlers can write cookies, which is the canonical Supabase pattern.

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  const providerError = url.searchParams.get('error');

  // Whitelist `next` to internal paths only (blocks open-redirect via `//host`).
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const home = buildLocalePath(locale, '/');
  const errorPath = buildLocalePath(locale, '/login?callback_error=1');

  if (providerError || !code) {
    return NextResponse.redirect(new URL(errorPath, url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(errorPath, url.origin));
  }

  // Cookies set during exchangeCodeForSession (via the cookieStore.setAll
  // handler in src/lib/supabase/server.ts) are merged automatically into
  // the redirect response by Next.js — no manual cookie copying needed.
  return NextResponse.redirect(new URL(safeNext ?? home, url.origin));
}
