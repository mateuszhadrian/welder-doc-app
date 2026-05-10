import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';
import { getDocument } from '@/lib/supabase/documents';
import { BusinessError } from '@/lib/supabase/errors';
import { isUuid } from '@/lib/uuid';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export function generateStaticParams() {
  // Only the locale segment is statically generated — `[id]` is dynamic per-user.
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Mirrors the canonical helper in `[locale]/layout.tsx` — kept local because
 * the layout copy is not exported (and form components in this codebase do
 * the same). Normalises `/` → '' so the default locale renders without prefix.
 */
function buildLocalePath(targetLocale: string, segment: string): string {
  const normalised = segment === '/' ? '' : segment;
  return targetLocale === routing.defaultLocale
    ? normalised || '/'
    : `/${targetLocale}${normalised}`;
}

/**
 * GET /[locale]/canvas/[id] — document load entry point (US-009).
 *
 * Flow:
 *   1. UUID preflight (`isUuid`) — short-circuits a 22P02 round-trip.
 *   2. `auth.getUser()` — auth gate; sends anons to /login with ?next= for return.
 *      LocaleGuard + consent re-check already ran in [locale]/layout.tsx.
 *   3. `getDocument(supabase, id)` — RLS-bound fetch; PGRST116 → DOCUMENT_NOT_FOUND
 *      (covers both non-existent UUIDs and cross-tenant rows — RLS-safe wording).
 *   4. Branch on result.error.business:
 *        - DOCUMENT_NOT_FOUND → notFound() (no leak about row existence).
 *        - UNAUTHORIZED → redirect to /login (token expired between layout & here).
 *        - DOCUMENT_DATA_SHAPE_INVALID / UNKNOWN → render an error state with retry.
 *
 * The render path is intentionally a placeholder shell: `<CanvasApp>` is not
 * yet implemented (`src/components/canvas/` is empty per CLAUDE.md "post-bootstrap"
 * state). This page proves the data flow end-to-end so the canvas integration
 * is a localised swap when it lands.
 */
export default async function CanvasPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  if (!isUuid(id)) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    const next = buildLocalePath(locale, `/canvas/${id}`);
    redirect(`${buildLocalePath(locale, '/login')}?next=${encodeURIComponent(next)}`);
  }

  const result = await getDocument(supabase, id);

  if (result.error) {
    if (result.error.business === BusinessError.DOCUMENT_NOT_FOUND) {
      notFound();
    }
    if (result.error.business === BusinessError.UNAUTHORIZED) {
      redirect(buildLocalePath(locale, '/login'));
    }
    return <ProjectLoadError messageKey={result.error.message} locale={locale} />;
  }

  // Integration seam: when CanvasSlice / ShapesSlice / DocumentSlice land,
  // replace `<ProjectLoadedShell>` with `<CanvasApp document={result.data} />`.
  // The slice action `loadDocument(dto)` (architecture-base.md §8) hydrates
  // shapes, weldUnits, canvas dimensions, and resets history before render.
  return <ProjectLoadedShell document={result.data} locale={locale} />;
}

async function ProjectLoadError({ messageKey, locale }: { messageKey: string; locale: string }) {
  const t = await getTranslations('project');
  // The message key is one of the `errors.*` strings in pl.json/en.json.
  // Read it from the root namespace so we don't have to duplicate copy.
  const tErrors = await getTranslations();
  const backHref = buildLocalePath(locale, '/');

  return (
    <main className="flex min-h-[calc(100vh-3rem)] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">{t('load_error_title')}</h1>
        <p className="mt-3 text-sm text-neutral-600">{tErrors(messageKey)}</p>
        <a
          href={backHref}
          className="mt-6 inline-block rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
        >
          {t('back_to_projects')}
        </a>
      </div>
    </main>
  );
}

async function ProjectLoadedShell({
  document,
  locale
}: {
  document: import('@/types/api').DocumentDto;
  locale: string;
}) {
  const t = await getTranslations('project');
  const backHref = buildLocalePath(locale, '/');

  return (
    <main className="min-h-[calc(100vh-3rem)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <a href={backHref} className="text-sm text-neutral-600 hover:text-neutral-900">
          ← {t('back_to_projects')}
        </a>
        <h1 className="mt-4 text-2xl font-semibold text-neutral-900">{document.name}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-neutral-600">
          <dt className="font-medium text-neutral-700">ID</dt>
          <dd className="font-mono">{document.id}</dd>
          <dt className="font-medium text-neutral-700">Schema version</dt>
          <dd>{document.schema_version}</dd>
          <dt className="font-medium text-neutral-700">Canvas size</dt>
          <dd>
            {document.data.canvasWidth} × {document.data.canvasHeight}
          </dd>
          <dt className="font-medium text-neutral-700">Updated</dt>
          <dd>{document.updated_at}</dd>
        </dl>

        <section className="mt-8 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
          <h2 className="text-lg font-semibold text-neutral-900">{t('editor_pending_title')}</h2>
          <p className="mt-2 text-sm text-neutral-600">{t('editor_pending_message')}</p>
        </section>
      </div>
    </main>
  );
}
