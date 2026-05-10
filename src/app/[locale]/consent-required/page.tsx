import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';

type Props = {
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Stub destination for the LocaleGuard consent-version redirect (architecture-base.md §17).
// Full UI (TOS + PP checkboxes wired to POST /api/consent) is OPEN —
// tracked as US-052 in .ai/prd.md (to be added) with full implementation plan at
// .ai/consent-required-page-implementation-plan.md. P0 for MVP launch (RODO
// art. 7 — without this UI, the consent re-acceptance flow is broken end-to-end:
// users get trapped on this page after fresh signup OR after a TOS version bump).
export default async function ConsentRequiredPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('consent');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t('required_title')}</h1>
        <p className="mt-2 text-sm text-neutral-600">{t('required_subtitle')}</p>
        <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t('stub_notice')}
        </p>
      </div>
    </main>
  );
}
