'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasDocument } from '@/types/api';
import { createClient } from './client';
import { saveDocumentData } from './documents';
import { BusinessError, type MappedError } from './errors';

const AUTOSAVE_KEY = 'welderdoc_autosave';
const AUTOSAVE_SCHEMA_VERSION = 1;
const HISTORY_TRIM_TO = 50;
const DEFAULT_DEBOUNCE_MS = 1500;

interface AutosavePayload {
  schemaVersion: number;
  scene: CanvasDocument;
  history: unknown[];
  historyIndex: number;
  savedAt: string;
}

export interface UseAutosaveDocumentOptions {
  documentId: string;
  /** Debounce window in ms (architecture-base.md autosave debounce 1–2 s). */
  debounceMs?: number;
  /**
   * Fired when `DOCUMENT_NOT_FOUND` surfaces — caller decides UX (toast,
   * redirect to /login, project list, etc.). The hook does NOT navigate
   * because it cannot import `next/navigation` without forcing every caller
   * onto the App Router.
   */
  onDocumentNotFound?: () => void;
}

export interface UseAutosaveDocumentResult {
  /**
   * Queue a save. Debounced — subsequent calls within `debounceMs` reset the
   * timer and supersede the pending data. Safe to call on every store update.
   */
  trigger: (data: CanvasDocument, history?: unknown[], historyIndex?: number) => void;
  /**
   * Cancel any pending debounced save and run it immediately. Use on unmount
   * or before navigation so the latest scene reaches the server.
   */
  flush: () => Promise<MappedError | null>;
  saving: boolean;
  dirty: boolean;
  lastSavedAt: string | null;
  lastError: MappedError | null;
}

/**
 * Autosave hook (US-009). Owns the debounce, the localStorage fallback, and
 * the "saved at HH:MM" state — keeps the consuming component free of timer
 * lifecycle code.
 *
 * Debounce is owned via `setTimeout` + ref (CLAUDE.md "do not import lodash
 * for this"). The latest payload is held in a ref so the timer callback sees
 * fresh data even if React state hasn't flushed yet.
 *
 * On network error (PGRST5xx, fetch failure, mapped UNKNOWN) the latest
 * scene is mirrored into `localStorage.welderdoc_autosave` so a tab reload
 * doesn't lose work. `QuotaExceededError` triggers one retry after trimming
 * `history` to the most recent 50 entries (architecture-base.md §13).
 *
 * `DOCUMENT_NOT_FOUND` is NOT mirrored to localStorage — the row is gone
 * server-side and writing a stale scene to disk would risk a future
 * re-migration into a different document. The caller's `onDocumentNotFound`
 * handles that branch.
 */
export function useAutosaveDocument({
  documentId,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onDocumentNotFound
}: UseAutosaveDocumentOptions): UseAutosaveDocumentResult {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<MappedError | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{
    data: CanvasDocument;
    history: unknown[];
    historyIndex: number;
  } | null>(null);
  const inFlightRef = useRef(false);
  const onDocumentNotFoundRef = useRef(onDocumentNotFound);

  useEffect(() => {
    onDocumentNotFoundRef.current = onDocumentNotFound;
  }, [onDocumentNotFound]);

  const runSave = useCallback(async (): Promise<MappedError | null> => {
    if (inFlightRef.current) return null;
    if (!pendingRef.current) return null;

    inFlightRef.current = true;
    setSaving(true);

    let lastError: MappedError | null = null;

    // Drain loop — if trigger() lands more data during the await, the next
    // iteration picks it up. Avoids recursive useCallback self-reference
    // (which trips react-hooks/immutability) and keeps the convergence
    // guarantee: when this returns, pendingRef is empty unless we hit an
    // error that warrants bailing out.
    while (pendingRef.current) {
      const pending = pendingRef.current;
      pendingRef.current = null;

      const supabase = createClient();
      const result = await saveDocumentData(supabase, documentId, { data: pending.data });

      if (result.error) {
        setLastError(result.error);
        lastError = result.error;

        if (result.error.business === BusinessError.DOCUMENT_NOT_FOUND) {
          // Row gone server-side; localStorage mirror would risk a stale
          // re-migration. Hand off to the caller's UX.
          onDocumentNotFoundRef.current?.();
          break;
        }

        // Anything else — including UNAUTHORIZED, UNKNOWN, network failure —
        // gets mirrored locally so a reload doesn't drop the user's work.
        // dirty stays true so the next trigger() will retry.
        writeLocalFallback({
          schemaVersion: AUTOSAVE_SCHEMA_VERSION,
          scene: pending.data,
          history: pending.history,
          historyIndex: pending.historyIndex,
          savedAt: new Date().toISOString()
        });
        break;
      }

      setLastSavedAt(result.data.updated_at);
      setLastError(null);
      setDirty(false);
      lastError = null;
    }

    inFlightRef.current = false;
    setSaving(false);
    return lastError;
  }, [documentId]);

  const trigger = useCallback(
    (data: CanvasDocument, history: unknown[] = [], historyIndex = -1) => {
      pendingRef.current = { data, history, historyIndex };
      setDirty(true);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runSave();
      }, debounceMs);
    },
    [debounceMs, runSave]
  );

  const flush = useCallback(async (): Promise<MappedError | null> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return runSave();
  }, [runSave]);

  // Unmount cleanup — cancel the pending timer. Intentionally do NOT auto-flush
  // on unmount: that would issue a network call from a strict-mode double-mount
  // in dev. Callers that need a final save before navigation should call
  // flush() explicitly (e.g. in a route-change handler or beforeunload).
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { trigger, flush, saving, dirty, lastSavedAt, lastError };
}

/**
 * Writes the autosave bundle to `localStorage.welderdoc_autosave`. On
 * `QuotaExceededError` retries once after trimming `history` to the most
 * recent 50 entries — covers the "long undo trail on a near-full quota"
 * case (architecture-base.md §13).
 *
 * `localStorage.setItem` throws synchronously, so this stays sync. SSR
 * (no `window`) is a silent no-op — autosave only runs on the client.
 */
function writeLocalFallback(payload: AutosavePayload): { ok: boolean; quotaExceeded: boolean } {
  if (typeof window === 'undefined') return { ok: false, quotaExceeded: false };

  try {
    window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    return { ok: true, quotaExceeded: false };
  } catch (err) {
    if (!isQuotaExceededError(err)) {
      return { ok: false, quotaExceeded: false };
    }

    // Trim history (keep the most recent N) and retry once.
    const trimmed: AutosavePayload = {
      ...payload,
      history: payload.history.slice(-HISTORY_TRIM_TO),
      historyIndex: Math.min(payload.historyIndex, HISTORY_TRIM_TO - 1)
    };
    try {
      window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(trimmed));
      return { ok: true, quotaExceeded: true };
    } catch {
      return { ok: false, quotaExceeded: true };
    }
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014
    );
  }
  return false;
}
