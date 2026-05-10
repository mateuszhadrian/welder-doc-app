'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRenameDocument } from '@/lib/supabase/useRenameDocument';
import { BusinessError, type MappedError } from '@/lib/supabase/errors';

const NAME_MAX = 100;

type Props = {
  documentId: string;
  initialName: string;
};

/**
 * Inline rename for the document title (US-013).
 *
 * Renders as the document's `<h1>` until the user clicks "Rename"; then swaps
 * to an `<input>` with Save / Cancel. The component owns the optimistic
 * displayed name so the UI updates as soon as the PATCH resolves successfully.
 * `router.refresh()` invalidates the RSC cache for the page so the next
 * navigation (back to the dashboard) sees the new name.
 *
 * Errors flow through `mapPostgrestError`:
 *   - `DOCUMENT_NAME_INVALID` → inline error, stay in edit mode.
 *   - `DOCUMENT_NOT_FOUND` (PGRST116 → row gone / RLS rejected) → exit edit
 *     mode + display the mapped i18n message; caller decides on a redirect.
 *   - `UNAUTHORIZED` / `UNKNOWN` → generic inline error; the user can retry.
 *
 * Trim happens BOTH on the client (preflight) and inside `renameDocument`
 * (defence-in-depth); the value persisted is the trimmed version.
 */
export function RenameDocumentForm({ documentId, initialName }: Props) {
  const tProject = useTranslations('project');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const { mutate, pending } = useRenameDocument();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<MappedError | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the input as soon as we enter edit mode.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function enterEditMode() {
    setError(null);
    setDraft(displayName);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
    setDraft(displayName);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
      // Surface a synthetic mapped error to mirror what the helper would do —
      // single render path for client + server failures.
      setError({
        business: BusinessError.DOCUMENT_NAME_INVALID,
        message: 'errors.document_name_invalid'
      });
      return;
    }

    const result = await mutate(documentId, { name: trimmed });

    if (result.error) {
      setError(result.error);
      return;
    }

    setDisplayName(result.data.name);
    setEditing(false);
    router.refresh();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  const errorMessage = (() => {
    if (!error) return null;
    try {
      return tErrors(error.message.replace(/^errors\./, '') as Parameters<typeof tErrors>[0]);
    } catch {
      return tErrors('unknown');
    }
  })();

  if (!editing) {
    return (
      <div className="mt-4 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900">{displayName}</h1>
        <button
          type="button"
          onClick={enterEditMode}
          className="text-sm font-medium text-neutral-600 underline hover:text-neutral-900"
        >
          {tProject('rename.action')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2" noValidate>
      <label htmlFor="rename-input" className="sr-only">
        {tProject('rename.label')}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="rename-input"
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
          maxLength={NAME_MAX}
          aria-invalid={error !== null}
          aria-describedby={error ? 'rename-error' : undefined}
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-2xl font-semibold focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {pending ? tProject('rename.saving') : tProject('rename.save')}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:cursor-not-allowed"
        >
          {tProject('rename.cancel')}
        </button>
      </div>
      {errorMessage ? (
        <p id="rename-error" role="alert" aria-live="polite" className="text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
