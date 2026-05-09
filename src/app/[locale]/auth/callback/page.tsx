import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';
import { CallbackClient } from './CallbackClient';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    code?: string;
    next?: string;
    error?: string;
    error_description?: string;
  }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const dynamic = 'force-dynamic';

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

export default async function AuthCallbackPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { code, next, error: providerError } = await searchParams;
  const t = await getTranslations('auth.callback');

  // GoTrue may bounce back with `?error=access_denied` etc. when the user
  // cancels OAuth or the link is invalid — render the failure state directly.
  let exchangeFailed = Boolean(providerError);

  if (!exchangeFailed && code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      exchangeFailed = true;
    }
  } else if (!code) {
    // No code and no error — someone hit /auth/callback directly.
    exchangeFailed = true;
  }

  const loginHref = buildLocalePath(locale, '/login');

  if (exchangeFailed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <header className="mb-6 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">{t('error_title')}</h1>
            <p className="mt-2 text-sm text-neutral-600">{t('error_subtitle')}</p>
          </header>
          <Link
            href={loginHref}
            className="block rounded-md bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            {t('back_to_login')}
          </Link>
        </div>
      </main>
    );
  }

  // Success — exchangeCodeForSession wrote the cookies. Hand off to the client
  // component which flushes the deferred consent bundle and navigates home.
  // Whitelist `next` to internal paths only to avoid open-redirect.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const destination = safeNext ?? buildLocalePath(locale, '/');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <CallbackClient destination={destination} />
      </div>
    </main>
  );
}
