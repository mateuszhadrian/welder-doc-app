import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('App');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-lg text-neutral-600">{t('tagline')}</p>
      <p className="max-w-md text-sm text-neutral-500">{t('placeholder')}</p>
    </main>
  );
}
