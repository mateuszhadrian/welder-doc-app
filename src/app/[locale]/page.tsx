import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NewProjectButton } from '@/components/projects/NewProjectButton';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('App');

  return (
    <main className="relative min-h-screen p-4">
      {/* Provisional placement — move to navbar / sidebar once the chrome lands. */}
      <div className="absolute top-4 left-4">
        <NewProjectButton />
      </div>
      <div className="flex min-h-[calc(100vh-2rem)] flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-lg text-neutral-600">{t('tagline')}</p>
        <p className="max-w-md text-sm text-neutral-500">{t('placeholder')}</p>
      </div>
    </main>
  );
}
