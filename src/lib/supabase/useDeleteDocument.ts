'use client';

import { useState } from 'react';
import { createClient } from './client';
import { deleteDocument, type DeleteDocumentResult } from './documents';

/**
 * Client-side wrapper around `deleteDocument` (US-011). Exposes a `pending`
 * flag for the calling component to disable the confirmation modal's
 * "Usuń" button while the DELETE is in flight (idempotency-by-UI-guard).
 *
 * Splitting the hook into its own `'use client'` module keeps the underlying
 * `deleteDocument` helper importable from Server Components and Route
 * Handlers without dragging React state into the server bundle — same
 * structural choice as `useCreateDocument` / `useRenameDocument`.
 */
export function useDeleteDocument() {
  const [pending, setPending] = useState(false);

  async function mutate(documentId: string): Promise<DeleteDocumentResult> {
    setPending(true);
    try {
      const supabase = createClient();
      return await deleteDocument(supabase, documentId);
    } finally {
      setPending(false);
    }
  }

  return { mutate, pending };
}
