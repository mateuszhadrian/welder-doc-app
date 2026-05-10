import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';
import { ForgotPasswordForm } from './ForgotPasswordForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // A signed-in user has no business on the forgot-password screen.
  // For password change while authenticated, the future account-settings
  // page will expose `auth.updateUser({ password })` directly.
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect(locale === routing.defaultLocale ? '/' : `/${locale}`);
  }

  const t = await getTranslations('auth.forgotPassword');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-neutral-600">{t('subtitle')}</p>
        </header>
        <ForgotPasswordForm locale={locale} />
      </div>
    </main>
  );
}
