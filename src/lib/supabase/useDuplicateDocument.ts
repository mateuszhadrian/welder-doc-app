'use client';

import { useState } from 'react';
import { createClient } from './client';
import {
  duplicateDocument,
  type DuplicateDocumentOptions,
  type DuplicateDocumentResult
} from './documents';

/**
 * Client-side wrapper around `duplicateDocument` (US-012). Exposes a `pending`
 * flag for the calling component to disable the "Duplikuj" button while the
 * two-step SELECT+INSERT is in flight (idempotency-by-UI-guard, same pattern
 * as `useCreateDocument` / `useDeleteDocument` / `useRenameDocument`).
 *
 * Splitting the hook into its own `'use client'` module keeps the underlying
 * `duplicateDocument` helper importable from Server Components and Route
 * Handlers without dragging React state into the server bundle.
 *
 * Callers pass the localised suffix via `options.nameSuffix` — typically
 * `' (kopia)'` for `pl` and `' (copy)'` for `en`, resolved through next-intl
 * at the call site. The helper has a PL default for sane fallback.
 */
export function useDuplicateDocument() {
  const [pending, setPending] = useState(false);

  async function mutate(
    sourceDocumentId: string,
    options?: DuplicateDocumentOptions
  ): Promise<DuplicateDocumentResult> {
    setPending(true);
    try {
      const supabase = createClient();
      return await duplicateDocument(supabase, sourceDocumentId, options);
    } finally {
      setPending(false);
    }
  }

  return { mutate, pending };
}
