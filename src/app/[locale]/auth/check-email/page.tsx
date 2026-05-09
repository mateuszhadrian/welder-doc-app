import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { isValidEmail } from '@/lib/auth/validation';
import { CheckEmailClient } from './CheckEmailClient';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function CheckEmailPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { email } = await searchParams;
  // Sanitise: never trust the query string — only display if it's a
  // syntactically-valid email. Any junk falls through to the generic copy.
  const safeEmail = email && isValidEmail(email) ? email.trim() : null;

  const t = await getTranslations('auth.checkEmail');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        </header>
        <CheckEmailClient email={safeEmail} locale={locale} />
      </div>
    </main>
  );
}
