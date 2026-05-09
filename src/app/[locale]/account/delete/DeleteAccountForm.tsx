'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { routing } from '@/i18n/routing';
import type { DeleteAccountApiErrorCode, TypedApiErrorDto } from '@/types/api';

const CONFIRMATION_LITERAL = 'DELETE';

type Props = {
  email: string;
  locale: string;
};

/**
 * Hard-delete account form (US-052, RODO art. 17).
 *
 * On 200, navigates via `window.location.assign` rather than `router.push`:
 * the API response sets `Set-Cookie: sb-*=...; Max-Age=0` to clear the
 * session, but a soft RSC navigation can race the cookie write. A full
 * reload guarantees the next request reaches the LocaleGuard with the
 * cookies already gone, so the public `/account-deleted` segment renders
 * cleanly. Mirrors the post-signin pattern in LoginForm.
 */
export function DeleteAccountForm({ email, locale }: Props) {
  const t = useTranslations('account.delete');
  const tErrors = useTranslations('errors');

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isPending, startTransition] = useTransition();

  const confirmationOk = confirmation === CONFIRMATION_LITERAL;
  const submitDisabled = isPending || password.length === 0 || !confirmationOk;

  function showError(code: DeleteAccountApiErrorCode | 'network_error') {
    const key = code as Parameters<typeof tErrors>[0];
    try {
      toast.error(tErrors(key));
    } catch {
      toast.error(tErrors('internal_error'));
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitDisabled) return;

    let res: Response;
    try {
      res = await fetch('/api/user/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmation })
      });
    } catch {
      showError('network_error');
      return;
    }

    if (res.ok) {
      const target =
        locale === routing.defaultLocale ? '/account-deleted' : `/${locale}/account-deleted`;
      startTransition(() => {
        window.location.assign(target);
      });
      return;
    }

    let json: TypedApiErrorDto<DeleteAccountApiErrorCode>;
    try {
      json = (await res.json()) as TypedApiErrorDto<DeleteAccountApiErrorCode>;
    } catch {
      showError('network_error');
      return;
    }
    showError(json.error ?? 'internal_error');
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-red-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="delete-email" className="text-sm font-medium text-neutral-800">
          {t('email_label')}
        </label>
        <input
          id="delete-email"
          type="email"
          value={email}
          readOnly
          disabled
          className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="delete-password" className="text-sm font-medium text-neutral-800">
          {t('password_label')}
        </label>
        <input
          id="delete-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('password_placeholder')}
          disabled={isPending}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none disabled:bg-neutral-50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="delete-confirmation" className="text-sm font-medium text-neutral-800">
          {t('confirmation_label')}
        </label>
        <input
          id="delete-confirmation"
          name="confirmation"
          type="text"
          autoComplete="off"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={t('confirmation_placeholder')}
          disabled={isPending}
          aria-invalid={confirmation.length > 0 && !confirmationOk}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none disabled:bg-neutral-50"
        />
      </div>

      <button
        type="submit"
        disabled={submitDisabled}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
