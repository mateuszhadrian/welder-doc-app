'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { BusinessError } from '@/lib/supabase/errors';
import { useCreateDocument } from '@/lib/supabase/useCreateDocument';

const DEFAULT_CANVAS_WIDTH = 2970;
const DEFAULT_CANVAS_HEIGHT = 2100;
const CANVAS_SCHEMA_VERSION = 1;

/**
 * "Nowy projekt" button (US-008). Self-contained on purpose — drop it into a
 * navbar, sidebar, or empty-state placeholder later by changing the import
 * site, not the component. The only external surface is the `useCreateDocument`
 * hook, sonner toasts, and next-intl translations — all already mounted in the
 * locale layout.
 *
 * Behaviour:
 *   - Disabled while the request is in flight (idempotency-by-UI guard,
 *     api-plan.md §10).
 *   - On success → router.push to the canvas route. The route doesn't exist
 *     yet (canvas surface is a future iteration); 404 is acceptable for now,
 *     the document row will be visible in Supabase.
 *   - On `PROJECT_LIMIT_EXCEEDED` → dedicated toast (Free-plan upgrade CTA
 *     hook will be wired here once the upgrade modal exists).
 *   - On `UNAUTHORIZED` → toast; consumers shouldn't render this button for
 *     guests yet, but the helper still degrades gracefully if they do.
 */
export function NewProjectButton() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('documents');
  const tErrors = useTranslations('errors');
  const { mutate, pending } = useCreateDocument();

  async function handleClick() {
    const { data, error } = await mutate({
      name: t('default_name'),
      data: {
        schemaVersion: CANVAS_SCHEMA_VERSION,
        canvasWidth: DEFAULT_CANVAS_WIDTH,
        canvasHeight: DEFAULT_CANVAS_HEIGHT,
        shapes: [],
        weldUnits: []
      }
    });

    if (error) {
      if (error.business === BusinessError.PROJECT_LIMIT_EXCEEDED) {
        toast.error(tErrors('project_limit_exceeded'));
        return;
      }
      toast.error(tErrors(error.message.replace(/^errors\./, '')));
      return;
    }

    const localePrefix = locale === 'pl' ? '' : `/${locale}`;
    router.push(`${localePrefix}/canvas/${data.id}`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? t('creating') : t('create_new')}
    </button>
  );
}
