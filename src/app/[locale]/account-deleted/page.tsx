import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';

type Props = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Public landing after a successful DELETE /api/user/account. Listed in
// PUBLIC_SEGMENTS so the LocaleGuard does not try to fetch a user_profiles
// row for a user that no longer exists (post-signOut, post-cascade).
export default async function AccountDeletedPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account_deleted');

  const homePath = locale === routing.defaultLocale ? '/' : `/${locale}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-sm text-neutral-600">{t('subtitle')}</p>
        <Link
          href={homePath}
          className="mt-6 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          {t('back_home')}
        </Link>
      </div>
    </main>
  );
}
