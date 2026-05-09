import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { CURRENT_TOS_VERSION } from '@/lib/consent/version';
import { createClient } from '@/lib/supabase/server';
import { SignUpForm } from './SignUpForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function SignUpPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // If a user is already signed in, sign-up is a dead end — bounce them home.
  // The locale layout will then run consent + locale guards as usual.
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect(locale === routing.defaultLocale ? '/' : `/${locale}`);
  }

  const t = await getTranslations('auth.signUp');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-neutral-600">{t('subtitle')}</p>
        </header>
        <SignUpForm locale={locale} consentVersion={CURRENT_TOS_VERSION} />
      </div>
    </main>
  );
}
