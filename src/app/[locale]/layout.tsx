import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Inter } from 'next/font/google';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Toaster } from 'sonner';
import { routing, type Locale } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';
import { CURRENT_TOS_VERSION } from '@/lib/consent/version';
import { LocaleSwitcher } from '@/components/locale-switcher/LocaleSwitcher';
import '../globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'WelderDoc',
  description: 'Dokumentacja złączy spawalniczych w przeglądarce'
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const PUBLIC_SEGMENTS = [
  '/login',
  '/auth/sign-up',
  '/auth/check-email',
  '/auth/callback',
  '/consent-required',
  '/account-deleted'
];
const LOCALE_PREFIX_RE = new RegExp(`^/(${routing.locales.join('|')})(?=/|$)`);

function stripLocale(pathname: string): string {
  return pathname.replace(LOCALE_PREFIX_RE, '') || '/';
}

function isPublicSegment(segment: string): boolean {
  return PUBLIC_SEGMENTS.some((p) => segment === p || segment.startsWith(p + '/'));
}

function buildLocalePath(targetLocale: string, segment: string): string {
  const normalised = segment === '/' ? '' : segment;
  return targetLocale === routing.defaultLocale
    ? normalised || '/'
    : `/${targetLocale}${normalised}`;
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const headerList = await headers();
  const pathname = headerList.get('x-pathname') ?? '/';
  const segment = stripLocale(pathname);

  // Always resolve the user so the LocaleSwitcher can persist preference for
  // authenticated users on every page (incl. /login post-mount race), AND we
  // can gate the LocaleGuard / consent-version checks on the same fetch.
  // `getUser()` is a no-op in @supabase/ssr when no session cookie exists,
  // so this adds zero cost on guest visits.
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user && !isPublicSegment(segment)) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('locale, current_consent_version')
      .eq('id', user.id)
      .single<{ locale: string; current_consent_version: string | null }>();

    if (profile) {
      if (profile.locale !== locale) {
        redirect(buildLocalePath(profile.locale, segment));
      }
      if (
        !profile.current_consent_version ||
        profile.current_consent_version < CURRENT_TOS_VERSION
      ) {
        redirect(buildLocalePath(locale, '/consent-required'));
      }
    }
  }

  const messages = await getMessages();

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <header className="flex h-12 items-center justify-between border-b border-neutral-200 bg-white px-4">
            <span className="text-sm font-semibold text-neutral-900">WelderDoc</span>
            <LocaleSwitcher currentLocale={locale as Locale} userId={user?.id} />
          </header>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
