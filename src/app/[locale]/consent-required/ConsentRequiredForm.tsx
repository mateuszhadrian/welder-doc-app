'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';

type Props = {
  locale: string;
  consentVersion: string;
};

type ApiErrorEnvelope = { error?: unknown };

// Whitelist of `/api/consent` ConsentApiErrorCode values that have a
// translation under `errors.*` in the message bundles. Anything outside
// this map (incl. unexpected backend errors and code drift) falls back to
// `errors.unknown` rather than leaking a raw error code into the UI.
const API_ERROR_TO_I18N: Record<string, string> = {
  invalid_payload: 'invalid_payload',
  missing_fields: 'missing_fields',
  unauthorized: 'unauthorized',
  internal_error: 'internal_error',
  invalid_consent_type: 'consent_type_invalid',
  unauthorized_consent_target: 'consent_target_unauthorized',
  consent_version_missing: 'consent_version_missing'
};

function buildLocalePath(locale: string, segment: string): string {
  const normalised = segment === '/' ? '' : segment;
  return locale === routing.defaultLocale ? normalised || '/' : `/${locale}${normalised}`;
}

export function ConsentRequiredForm({ locale, consentVersion }: Props) {
  const t = useTranslations('auth.consent');
  const tErrors = useTranslations('errors');

  const [acceptTos, setAcceptTos] = useState(false);
  const [acceptPp, setAcceptPp] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canSubmit = acceptTos && acceptPp && !isPending;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setErrorKey(null);

    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch('/api/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            types: ['terms_of_service', 'privacy_policy'],
            version: consentVersion,
            accepted: true
          })
        });
      } catch {
        setErrorKey('network_error');
        return;
      }

      if (!res.ok) {
        const envelope = (await res.json().catch(() => null)) as ApiErrorEnvelope | null;
        const code = typeof envelope?.error === 'string' ? envelope.error : null;
        const mapped = code ? (API_ERROR_TO_I18N[code] ?? null) : null;
        setErrorKey(mapped ?? 'unknown');
        return;
      }

      // Full-page navigation, NOT router.push — same rationale as
      // SignUpForm.tsx: lets the @supabase/ssr browser client pick up the
      // freshly-set current_consent_version cookie before the next layout
      // SSR re-runs.
      window.location.assign(buildLocalePath(locale, '/'));
    });
  }

  const errorMessage = errorKey ? tErrors(errorKey as Parameters<typeof tErrors>[0]) : null;

  return (
    <form onSubmit={handleSubmit} method="post" noValidate className="mt-6 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            name="consent_tos"
            checked={acceptTos}
            onChange={(e) => setAcceptTos(e.target.checked)}
            disabled={isPending}
            className="mt-0.5"
            required
          />
          <span>{t('tos_label')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-neutral-800">
          <input
            type="checkbox"
            name="consent_pp"
            checked={acceptPp}
            onChange={(e) => setAcceptPp(e.target.checked)}
            disabled={isPending}
            className="mt-0.5"
            required
          />
          <span>{t('pp_label')}</span>
        </label>
      </fieldset>

      {errorMessage ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
