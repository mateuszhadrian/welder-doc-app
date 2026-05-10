import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CanvasDocument } from '@/types/api';
import { BusinessError } from './errors';

const { saveDocumentDataMock } = vi.hoisted(() => ({
  saveDocumentDataMock: vi.fn()
}));

vi.mock('./client', () => ({
  // The createClient identity isn't observed by these tests — the spy on
  // saveDocumentData is what we assert against. Returning a sentinel object
  // is enough to satisfy the hook's call site.
  createClient: () => ({ __isClient: true })
}));

vi.mock('./documents', async () => {
  const actual = await vi.importActual<typeof import('./documents')>('./documents');
  return {
    ...actual,
    saveDocumentData: saveDocumentDataMock
  };
});

import { useAutosaveDocument } from './useAutosaveDocument';

const DOC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const AUTOSAVE_KEY = 'welderdoc_autosave';

const validScene: CanvasDocument = {
  schemaVersion: 1,
  canvasWidth: 2970,
  canvasHeight: 2100,
  shapes: [],
  weldUnits: []
};

const okResponse = {
  data: { id: DOC_ID, name: 'Test', updated_at: '2026-05-10T22:00:00Z' },
  error: null
} as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  window.localStorage.clear();
  saveDocumentDataMock.mockResolvedValue(okResponse);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosaveDocument — debounce', () => {
  it('collapses rapid trigger() calls into a single save after debounceMs', async () => {
    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 1500 })
    );

    act(() => {
      result.current.trigger(validScene);
      result.current.trigger({ ...validScene, canvasWidth: 100 });
      result.current.trigger({ ...validScene, canvasWidth: 200 });
    });

    // Before the debounce window elapses — no SDK call yet.
    expect(saveDocumentDataMock).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    // Only the last trigger should make it through.
    expect(saveDocumentDataMock).toHaveBeenCalledTimes(1);
    expect(saveDocumentDataMock).toHaveBeenCalledWith(expect.any(Object), DOC_ID, {
      data: expect.objectContaining({ canvasWidth: 200 })
    });
  });

  it('does not save before debounceMs elapses', async () => {
    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 1500 })
    );

    act(() => {
      result.current.trigger(validScene);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1499);
    });
    expect(saveDocumentDataMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(saveDocumentDataMock).toHaveBeenCalledTimes(1);
  });
});

describe('useAutosaveDocument — happy path', () => {
  it('updates lastSavedAt and clears dirty on success', async () => {
    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100 })
    );

    act(() => {
      result.current.trigger(validScene);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.lastSavedAt).toBe(okResponse.data.updated_at);
    expect(result.current.lastError).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  it('does not write localStorage on success (only on network error)', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100 })
    );
    act(() => {
      result.current.trigger(validScene);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(setItemSpy.mock.calls.some((call) => call[0] === AUTOSAVE_KEY)).toBe(false);
  });
});

describe('useAutosaveDocument — drain loop', () => {
  it('runs again if trigger() lands while a save is in flight', async () => {
    // Hold the first save promise open so we can land a second trigger() mid-flight.
    let resolveFirst: (() => void) | null = null;
    saveDocumentDataMock.mockImplementationOnce(
      () =>
        new Promise<typeof okResponse>((resolve) => {
          resolveFirst = () => resolve(okResponse);
        })
    );
    saveDocumentDataMock.mockResolvedValueOnce(okResponse);

    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100 })
    );

    act(() => {
      result.current.trigger(validScene);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // First save is now in flight (mockImplementationOnce holds the promise).
    expect(saveDocumentDataMock).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(true);

    // Queue a follow-up trigger while saving.
    act(() => {
      result.current.trigger({ ...validScene, canvasWidth: 999 });
    });

    // Release the first save. The drain loop should pick up the new pending data.
    await act(async () => {
      resolveFirst?.();
      await vi.runAllTimersAsync();
    });

    expect(saveDocumentDataMock).toHaveBeenCalledTimes(2);
    expect(saveDocumentDataMock.mock.calls[1]?.[2]).toEqual({
      data: expect.objectContaining({ canvasWidth: 999 })
    });
  });
});

describe('useAutosaveDocument — DOCUMENT_NOT_FOUND', () => {
  it('fires onDocumentNotFound and does NOT mirror to localStorage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const onDocumentNotFound = vi.fn();

    saveDocumentDataMock.mockResolvedValue({
      data: null,
      error: {
        business: BusinessError.DOCUMENT_NOT_FOUND,
        message: 'errors.document_not_found',
        rawCode: 'PGRST116'
      }
    });

    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100, onDocumentNotFound })
    );
    act(() => {
      result.current.trigger(validScene);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(onDocumentNotFound).toHaveBeenCalledTimes(1);

    // Critical — writing to localStorage would risk a stale future migration
    // into a different document (architecture-base.md §13).
    expect(setItemSpy.mock.calls.some((call) => call[0] === AUTOSAVE_KEY)).toBe(false);

    expect(result.current.lastError?.business).toBe(BusinessError.DOCUMENT_NOT_FOUND);
  });
});

describe('useAutosaveDocument — network error fallback', () => {
  it('mirrors scene to localStorage on UNKNOWN error and keeps dirty=true', async () => {
    saveDocumentDataMock.mockResolvedValue({
      data: null,
      error: {
        business: BusinessError.UNKNOWN,
        message: 'errors.unknown',
        rawCode: 'PGRST500',
        rawMessage: 'gateway timeout'
      }
    });

    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100 })
    );
    act(() => {
      result.current.trigger(validScene);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.scene).toEqual(validScene);
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.savedAt).toBe('string');

    // dirty stays true so the next trigger() will retry.
    expect(result.current.dirty).toBe(true);
    expect(result.current.lastError?.business).toBe(BusinessError.UNKNOWN);
  });

  it('passes through caller-supplied history/historyIndex into the bundle', async () => {
    saveDocumentDataMock.mockResolvedValue({
      data: null,
      error: { business: BusinessError.UNKNOWN, message: 'errors.unknown' }
    });

    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100 })
    );
    act(() => {
      result.current.trigger(validScene, [{ id: 'h1' }, { id: 'h2' }], 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const parsed = JSON.parse(window.localStorage.getItem(AUTOSAVE_KEY) as string);
    expect(parsed.history).toEqual([{ id: 'h1' }, { id: 'h2' }]);
    expect(parsed.historyIndex).toBe(1);
  });
});

describe('useAutosaveDocument — QuotaExceededError', () => {
  it('trims history to 50 entries and retries on QuotaExceededError', async () => {
    saveDocumentDataMock.mockResolvedValue({
      data: null,
      error: { business: BusinessError.UNKNOWN, message: 'errors.unknown' }
    });

    const history = Array.from({ length: 200 }, (_, i) => ({ id: `h${i}` }));

    // Throw QuotaExceededError once, then accept the trimmed retry.
    let callCount = 0;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      callCount++;
      if (callCount === 1) {
        const err = new DOMException('quota', 'QuotaExceededError');
        throw err;
      }
      // jsdom's actual setItem still works on the second call.
      Storage.prototype.setItem.bind(this);
      Object.defineProperty(this, key, { value, configurable: true, enumerable: true });
    });

    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100 })
    );
    act(() => {
      result.current.trigger(validScene, history, 199);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(setItemSpy).toHaveBeenCalledTimes(2);

    // First attempt: full bundle.
    const firstPayload = JSON.parse(setItemSpy.mock.calls[0]?.[1] as string);
    expect(firstPayload.history.length).toBe(200);

    // Retry: trimmed to last 50.
    const retryPayload = JSON.parse(setItemSpy.mock.calls[1]?.[1] as string);
    expect(retryPayload.history.length).toBe(50);
    expect(retryPayload.historyIndex).toBe(49);
    // Most-recent 50 are the tail of the original array.
    expect(retryPayload.history[0]).toEqual({ id: 'h150' });
    expect(retryPayload.history[49]).toEqual({ id: 'h199' });
  });
});

describe('useAutosaveDocument — unmount cleanup', () => {
  it('cancels the pending timer on unmount (no stray network call)', async () => {
    const { result, unmount } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 1500 })
    );

    act(() => {
      result.current.trigger(validScene);
    });

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(saveDocumentDataMock).not.toHaveBeenCalled();
  });
});

describe('useAutosaveDocument — flush()', () => {
  it('runs the save immediately, bypassing the debounce', async () => {
    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 5000 })
    );

    act(() => {
      result.current.trigger(validScene);
    });
    expect(saveDocumentDataMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.flush();
    });

    expect(saveDocumentDataMock).toHaveBeenCalledTimes(1);
    expect(result.current.lastSavedAt).toBe(okResponse.data.updated_at);
  });

  it('is a no-op when there is nothing pending', async () => {
    const { result } = renderHook(() =>
      useAutosaveDocument({ documentId: DOC_ID, debounceMs: 100 })
    );

    const flushed = await act(async () => result.current.flush());
    expect(flushed).toBeNull();
    expect(saveDocumentDataMock).not.toHaveBeenCalled();
  });
});
