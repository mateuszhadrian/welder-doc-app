import { type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

const intlMiddleware = createIntlMiddleware(routing);

// Łańcuch wywołań: Supabase `updateSession` → next-intl middleware.
// Kolejność jest obowiązkowa: Supabase musi odświeżyć access token (przez
// odczyt/zapis cookies `sb-*`) zanim next-intl zdecyduje o rewrite/redirect
// dla locale. next-intl praktycznie zawsze zwraca własny `NextResponse`
// (rewrite, redirect lub `next()`); jeśli nie skopiujemy `Set-Cookie` z
// `supabaseResponse` do tej finalnej response, refresh token zostaje zgubiony
// przy każdym locale-redirect i użytkownik jest natychmiast wylogowywany.
//
// `/api/*` jest wyłączone z matchera (negative lookahead `?!api`) — Route
// Handlery same odświeżają sesję w `auth.getUser()` przy pierwszym wywołaniu
// `createServerClient` z `@supabase/ssr` (handler `cookies.setAll` zapisuje
// odświeżone tokeny do `Response`). Architektura §16.
export async function proxy(request: NextRequest) {
  const { supabaseResponse } = await updateSession(request);

  const intlResponse = intlMiddleware(request);

  if (intlResponse) {
    // `cookies.set(cookie)` przyjmuje cały `ResponseCookie` — bezpieczne
    // względem przyszłych pól (np. `partitioned`) dodawanych przez
    // `@supabase/ssr` bez konieczności ręcznej destrukturyzacji opcji.
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      intlResponse.cookies.set(cookie);
    });
    return intlResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Skip all internal Next.js paths and static files unless found in search params
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)'
  ]
};
