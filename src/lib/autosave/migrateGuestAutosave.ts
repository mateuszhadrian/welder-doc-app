import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { CanvasDocument } from '@/types/api';
import { BusinessError } from '@/lib/supabase/errors';
import { createDocument } from '@/lib/supabase/documents';

const AUTOSAVE_KEY = 'welderdoc_autosave';
const MIGRATED_AT_KEY = 'welderdoc_migrated_at';

export type GuestMigrationReason = 'no_autosave' | 'invalid_payload' | 'project_limit' | 'db_error';

export interface GuestMigrationResult {
  migrated: boolean;
  reason?: GuestMigrationReason;
}

interface AutosavePayload {
  schemaVersion?: number;
  scene?: CanvasDocument;
}

function readAutosave(): AutosavePayload | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AutosavePayload;
    if (!parsed || typeof parsed !== 'object' || !parsed.scene) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Migrate a guest user's `localStorage.welderdoc_autosave` scene to the
 * authenticated user's `documents` table — best-effort. Failure must NOT
 * block the login flow; the form proceeds regardless of the result.
 *
 * Routed through `createDocument()` so the preflight (name/payload/shape) and
 * `mapPostgrestError()` mapping live in exactly one place. The owner_id is
 * resolved server-side from the active session by the helper itself, so the
 * caller no longer needs to pass `userId` — eliminating a class of bugs where
 * the caller's `data.user.id` could drift from `auth.uid()` between calls.
 *
 * Order is critical (architecture-base.md §13): set `welderdoc_migrated_at`
 * BEFORE removing `welderdoc_autosave`, so a tab-close mid-cleanup leaves a
 * sentinel that prevents a duplicate migration on the next login.
 */
export async function migrateGuestAutosave(
  supabase: SupabaseClient<Database>,
  documentName: string
): Promise<GuestMigrationResult> {
  if (typeof window === 'undefined') {
    return { migrated: false, reason: 'no_autosave' };
  }

  const raw = window.localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) {
    return { migrated: false, reason: 'no_autosave' };
  }

  const autosave = readAutosave();
  if (!autosave?.scene) {
    window.localStorage.removeItem(AUTOSAVE_KEY);
    return { migrated: false, reason: 'invalid_payload' };
  }

  const { error } = await createDocument(supabase, {
    name: documentName,
    data: autosave.scene
  });

  if (error) {
    if (error.business === BusinessError.PROJECT_LIMIT_EXCEEDED) {
      // Keep `welderdoc_autosave` intact — user can retry after upgrade or
      // after deleting an existing project.
      return { migrated: false, reason: 'project_limit' };
    }
    // Surface the underlying error for telemetry / dev debugging. Sentry will
    // pick this up post-MVP; for now it lands in the browser console where
    // Playwright can capture it.
    console.error('[migrateGuestAutosave] createDocument failed', {
      business: error.business,
      message: error.message,
      rawCode: error.rawCode,
      rawMessage: error.rawMessage
    });
    return { migrated: false, reason: 'db_error' };
  }

  window.localStorage.setItem(MIGRATED_AT_KEY, new Date().toISOString());
  window.localStorage.removeItem(AUTOSAVE_KEY);

  return { migrated: true };
}
