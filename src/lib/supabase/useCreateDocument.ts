'use client';

import { useState } from 'react';
import type { CreateDocumentCommand } from '@/types/api';
import { createClient } from './client';
import { createDocument, type CreateDocumentResult } from './documents';

/**
 * Client-side wrapper around `createDocument` that exposes a `pending` flag
 * for the calling component (used to disable the "Nowy projekt" button while
 * the request is in flight — idempotency-by-UI-guard, api-plan.md §10).
 *
 * Splitting the hook into its own `'use client'` module keeps the underlying
 * `createDocument` helper importable from Server Components and Route
 * Handlers without dragging React state into the server bundle.
 */
export function useCreateDocument() {
  const [pending, setPending] = useState(false);

  async function mutate(command: CreateDocumentCommand): Promise<CreateDocumentResult> {
    setPending(true);
    try {
      const supabase = createClient();
      return await createDocument(supabase, command);
    } finally {
      setPending(false);
    }
  }

  return { mutate, pending };
}
