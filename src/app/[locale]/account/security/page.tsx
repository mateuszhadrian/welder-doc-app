import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';
import { SecurityClient } from './SecurityClient';

type Props = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

function buildLocalePath(locale: string, segment: string): string {
  return locale === routing.defaultLocale ? segment : `/${locale}${segment}`;
}

export default async function AccountSecurityPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLocalePath(locale, '/login'));
  }

  const t = await getTranslations('auth.resetPassword');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-neutral-600">{t('subtitle')}</p>
        </header>
        <SecurityClient loginHref={buildLocalePath(locale, '/login')} />
      </div>
    </main>
  );
}
