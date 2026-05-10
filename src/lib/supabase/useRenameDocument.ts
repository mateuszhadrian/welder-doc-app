'use client';

import { useState } from 'react';
import type { RenameDocumentCommand } from '@/types/api';
import { createClient } from './client';
import { renameDocument, type UpdateDocumentResult } from './documents';

/**
 * Client-side wrapper around `renameDocument` (US-013). Exposes a `pending`
 * flag for the calling component to disable the rename input/button while the
 * PATCH is in flight (idempotency-by-UI-guard, api-plan.md §10).
 *
 * Splitting the hook into its own `'use client'` module keeps the underlying
 * `renameDocument` helper importable from Server Components and Route
 * Handlers without dragging React state into the server bundle — same
 * structural choice as `useCreateDocument`.
 */
export function useRenameDocument() {
  const [pending, setPending] = useState(false);

  async function mutate(
    documentId: string,
    command: RenameDocumentCommand
  ): Promise<UpdateDocumentResult> {
    setPending(true);
    try {
      const supabase = createClient();
      return await renameDocument(supabase, documentId, command);
    } finally {
      setPending(false);
    }
  }

  return { mutate, pending };
}
