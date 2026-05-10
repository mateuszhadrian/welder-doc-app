import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NewProjectButton } from '@/components/projects/NewProjectButton';
import { routing } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/server';
import { listDocuments, type ListDocumentsSort } from '@/lib/supabase/documents';

const SORT_VALUES: readonly ListDocumentsSort[] = [
  'updated_at_desc',
  'name_asc',
  'created_at_desc'
];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Mirrors `[locale]/layout.tsx` — local copy because the helper there is not
 * exported. Normalises `/` → '' so the default locale renders without prefix.
 */
function buildLocalePath(targetLocale: string, segment: string): string {
  const normalised = segment === '/' ? '' : segment;
  return targetLocale === routing.defaultLocale
    ? normalised || '/'
    : `/${targetLocale}${normalised}`;
}

function parseSort(raw: string | string[] | undefined): ListDocumentsSort {
  if (typeof raw === 'string' && (SORT_VALUES as readonly string[]).includes(raw)) {
    return raw as ListDocumentsSort;
  }
  return 'updated_at_desc';
}

// URL params are always end-user-visible — must clamp to a safe value rather
// than throw the helper's RangeError. The helper's guard exists for *callers*
// to surface their bugs; this page is the boundary that sanitises input.
function parseLimit(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string') return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseOffset(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string') return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

// Fixed timezone so the SSR render matches the client render byte-for-byte.
// Without `timeZone: 'UTC'`, the server (Vercel UTC) and the user's browser
// disagree and React logs hydration mismatches.
function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'pl' ? 'pl-PL' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC'
  }).format(new Date(iso));
}

export default async function HomePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLocalePath(locale, '/login'));
  }

  const sp = await searchParams;
  const limit = parseLimit(sp.limit);
  const offset = parseOffset(sp.offset);
  const sort = parseSort(sp.sort);

  const tDashboard = await getTranslations('dashboard');
  const tErrors = await getTranslations('errors');

  const result = await listDocuments(supabase, { userId: user.id, limit, offset, sort });

  return (
    <main className="min-h-screen p-4">
      <div className="mx-auto max-w-3xl">
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">{tDashboard('title')}</h1>
          <NewProjectButton />
        </div>

        {result.error ? (
          <div
            className="mt-8 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            role="alert"
          >
            {/* Mapper produces an `errors.*` key from the BusinessError enum;
                strip the prefix so getTranslations('errors') can resolve it. */}
            {tErrors(result.error.message.replace(/^errors\./, ''))}
          </div>
        ) : (
          <DocumentList
            items={result.data.items}
            total={result.data.total}
            limit={limit}
            offset={offset}
            sort={sort}
            locale={locale}
            tDashboard={tDashboard}
          />
        )}
      </div>
    </main>
  );
}

type ListProps = {
  items: { id: string; name: string; created_at: string; updated_at: string }[];
  total: number;
  limit: number;
  offset: number;
  sort: ListDocumentsSort;
  locale: string;
  tDashboard: Awaited<ReturnType<typeof getTranslations<'dashboard'>>>;
};

function DocumentList({ items, total, limit, offset, sort, locale, tDashboard }: ListProps) {
  if (items.length === 0) {
    return (
      <div
        className="mt-12 rounded-md border border-dashed border-neutral-300 p-8 text-center"
        data-testid="dashboard-empty"
      >
        <p className="text-sm text-neutral-600">{tDashboard('empty_state')}</p>
      </div>
    );
  }

  const showingFrom = offset + 1;
  const showingTo = offset + items.length;
  const hasPrev = offset > 0;
  const hasNext = offset + items.length < total;

  function pageHref(targetOffset: number): string {
    const qs = new URLSearchParams();
    if (sort !== 'updated_at_desc') qs.set('sort', sort);
    if (limit !== DEFAULT_LIMIT) qs.set('limit', String(limit));
    if (targetOffset > 0) qs.set('offset', String(targetOffset));
    const stringified = qs.toString();
    return stringified ? `?${stringified}` : buildLocalePath(locale, '/');
  }

  return (
    <>
      <ul
        className="mt-6 divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white"
        data-testid="dashboard-list"
      >
        {items.map((doc) => (
          <li key={doc.id}>
            <Link
              href={buildLocalePath(locale, `/canvas/${doc.id}`)}
              className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-neutral-50"
              data-testid="dashboard-list-item"
            >
              <span className="truncate text-sm font-medium text-neutral-900">{doc.name}</span>
              <span className="shrink-0 text-xs text-neutral-500">
                {tDashboard('last_updated', { date: formatDate(doc.updated_at, locale) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {(hasPrev || hasNext) && (
        <nav
          className="mt-4 flex items-center justify-between"
          aria-label={tDashboard('pagination_label')}
        >
          {hasPrev ? (
            <Link href={pageHref(Math.max(0, offset - limit))} className="text-sm hover:underline">
              {tDashboard('previous')}
            </Link>
          ) : (
            <span aria-disabled="true" className="text-sm text-neutral-300">
              {tDashboard('previous')}
            </span>
          )}
          <span className="text-xs text-neutral-500">
            {tDashboard('page_info', { from: showingFrom, to: showingTo, total })}
          </span>
          {hasNext ? (
            <Link href={pageHref(offset + limit)} className="text-sm hover:underline">
              {tDashboard('next')}
            </Link>
          ) : (
            <span aria-disabled="true" className="text-sm text-neutral-300">
              {tDashboard('next')}
            </span>
          )}
        </nav>
      )}
    </>
  );
}
