import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { CURRENT_TOS_VERSION } from '@/lib/consent/version';
import { createClient } from '@/lib/supabase/server';
import { ConsentRequiredForm } from './ConsentRequiredForm';

// Implements US-052 (.ai/prd.md). Plan: .ai/consent-required-page-implementation-plan.md.

type Props = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

function buildLocalePath(locale: string, segment: string): string {
  const normalised = segment === '/' ? '' : segment;
  return locale === routing.defaultLocale ? normalised || '/' : `/${locale}${normalised}`;
}

export default async function ConsentRequiredPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Defensive: if anonymous user lands here, send them to login. The proxy
  // (src/proxy.ts) should already prevent this, but Server Components must
  // not trust the middleware unconditionally.
  if (!user) {
    redirect(buildLocalePath(locale, '/login'));
  }

  // Re-check guard: if user's consent is already current, don't show the form.
  // Catches the AuthProvider-flush race (Scenario A in plan §1.1) — by the
  // time they hit /consent-required after the bounce, the flush may have
  // completed and made the form unnecessary.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('current_consent_version')
    .eq('id', user.id)
    .single<{ current_consent_version: string | null }>();

  if (profile?.current_consent_version && profile.current_consent_version >= CURRENT_TOS_VERSION) {
    redirect(buildLocalePath(locale, '/'));
  }

  const t = await getTranslations('auth.consent');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t('required_title')}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {t('required_subtitle', { version: CURRENT_TOS_VERSION })}
        </p>
        <ConsentRequiredForm locale={locale} consentVersion={CURRENT_TOS_VERSION} />
      </div>
    </main>
  );
}
