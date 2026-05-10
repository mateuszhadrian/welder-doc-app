'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { BusinessError } from '@/lib/supabase/errors';
import { useDeleteDocument } from '@/lib/supabase/useDeleteDocument';

type Props = {
  documentId: string;
  name: string;
  formattedUpdatedAt: string;
  href: string;
  loginHref: string;
};

/**
 * Single row in the dashboard project list (US-010 list, US-011 delete).
 *
 * Owns:
 *   - the navigable Link to `/canvas/[id]` (separate `<a>` so the surrounding
 *     "Usuń" button doesn't trigger navigation),
 *   - the confirm-delete dialog (`<dialog>` element for native a11y / focus
 *     trap / ESC-to-close — no third-party modal dep needed),
 *   - mapping mapped-error → toast / login redirect.
 *
 * After a successful DELETE we call `router.refresh()` to invalidate the
 * RSC cache for the list page, which re-runs `listDocuments()` server-side
 * and drops the deleted row from the next render. We intentionally do NOT
 * mutate a Zustand slice — the documents slice doesn't exist yet and the
 * list is fully Server-Component-driven.
 *
 * `loginHref` is precomputed by the Server parent because that's where the
 * `routing.defaultLocale` rule lives; this component avoids importing the
 * routing config to stay single-purpose.
 */
export function DocumentListItem({ documentId, name, formattedUpdatedAt, href, loginHref }: Props) {
  const tDashboard = useTranslations('dashboard');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const { mutate, pending } = useDeleteDocument();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogTitleId = useId();

  // Drive the native <dialog> imperatively. showModal() / close() handle
  // focus trap, scrim, and ESC-to-close for us. Falls back to inert <div>
  // semantics if the runtime ever lacks <dialog> (currently unsupported on
  // < Safari 15.4 / Firefox 98 — out of scope for this MVP).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmOpen && !dialog.open) {
      dialog.showModal();
      // Focus Cancel by default — reduces accidental confirms.
      cancelButtonRef.current?.focus();
    } else if (!confirmOpen && dialog.open) {
      dialog.close();
    }
  }, [confirmOpen]);

  function openConfirm() {
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (pending) return;
    setConfirmOpen(false);
  }

  // <dialog> emits 'close' on ESC and on .close(); keep React state in sync.
  function handleDialogClose() {
    setConfirmOpen(false);
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    // Click on the dialog element itself (the scrim area) closes; clicks
    // on inner content bubble up with currentTarget === inner card.
    if (e.target === dialogRef.current && !pending) {
      closeConfirm();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    // ESC default-handles via <dialog>; the keydown handler is here in case
    // the user pressed ESC while the confirm button has focus during pending.
    if (e.key === 'Escape' && pending) {
      e.preventDefault();
    }
  }

  async function handleConfirmDelete() {
    const result = await mutate(documentId);

    if (result.error) {
      if (result.error.business === BusinessError.UNAUTHORIZED) {
        // Session expired — let the user re-auth instead of dead-ending on a toast.
        router.push(loginHref);
        return;
      }
      const key = result.error.message.replace(/^errors\./, '') as Parameters<typeof tErrors>[0];
      toast.error(safeT(tErrors, key));
      return;
    }

    toast.success(tDashboard('delete.success'));
    setConfirmOpen(false);
    // Invalidate the RSC cache so the row disappears on the next paint.
    router.refresh();
  }

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3 transition hover:bg-neutral-50">
        <Link
          href={href}
          className="flex flex-1 items-center justify-between gap-4"
          data-testid="dashboard-list-item"
        >
          <span className="truncate text-sm font-medium text-neutral-900">{name}</span>
          <span className="shrink-0 text-xs text-neutral-500">
            {tDashboard('last_updated', { date: formattedUpdatedAt })}
          </span>
        </Link>
        <button
          type="button"
          onClick={openConfirm}
          aria-label={tDashboard('delete.action_aria', { name })}
          data-testid="dashboard-delete-trigger"
          className="shrink-0 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-red-700 transition hover:border-red-200 hover:bg-red-50"
        >
          {tDashboard('delete.action')}
        </button>
      </div>

      <dialog
        ref={dialogRef}
        onClose={handleDialogClose}
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
        aria-labelledby={dialogTitleId}
        className="rounded-lg border border-neutral-200 p-0 shadow-lg backdrop:bg-black/40"
      >
        <div className="w-[min(28rem,90vw)] p-6">
          <h2 id={dialogTitleId} className="text-base font-semibold text-neutral-900">
            {tDashboard('delete.title')}
          </h2>
          <p className="mt-2 text-sm text-neutral-700">{tDashboard('delete.body', { name })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={closeConfirm}
              disabled={pending}
              data-testid="dashboard-delete-cancel"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {tDashboard('delete.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={pending}
              data-testid="dashboard-delete-confirm"
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
            >
              {pending ? tDashboard('delete.deleting') : tDashboard('delete.confirm')}
            </button>
          </div>
        </div>
      </dialog>
    </li>
  );
}

/**
 * Defensive translator wrapper — if the mapped error key isn't registered in
 * messages/{pl,en}.json (shouldn't happen, but guards against a future
 * BusinessError addition without a paired i18n entry), fall back to
 * `errors.unknown` instead of throwing in the toast layer.
 */
function safeT(
  t: ReturnType<typeof useTranslations<'errors'>>,
  key: Parameters<ReturnType<typeof useTranslations<'errors'>>>[0]
): string {
  try {
    return t(key);
  } catch {
    return t('unknown');
  }
}
