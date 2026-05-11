import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BusinessError } from './errors';

const { duplicateDocumentMock } = vi.hoisted(() => ({
  duplicateDocumentMock: vi.fn()
}));

vi.mock('./client', () => ({
  createClient: () => ({ __isClient: true })
}));

vi.mock('./documents', async () => {
  const actual = await vi.importActual<typeof import('./documents')>('./documents');
  return {
    ...actual,
    duplicateDocument: duplicateDocumentMock
  };
});

import { useDuplicateDocument } from './useDuplicateDocument';

const SOURCE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const okResponse = {
  data: {
    id: 'ffffffff-1111-2222-3333-444444444444',
    name: 'Złącze T 1 (kopia)',
    schema_version: 1,
    data: { schemaVersion: 1, canvasWidth: 2970, canvasHeight: 2100, shapes: [], weldUnits: [] },
    created_at: '2026-05-11T12:00:00Z',
    updated_at: '2026-05-11T12:00:00Z'
  },
  error: null
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  duplicateDocumentMock.mockResolvedValue(okResponse);
});

describe('useDuplicateDocument', () => {
  it('starts with pending=false', () => {
    const { result } = renderHook(() => useDuplicateDocument());
    expect(result.current.pending).toBe(false);
  });

  it('forwards sourceDocumentId and options to the helper verbatim', async () => {
    const { result } = renderHook(() => useDuplicateDocument());

    await act(async () => {
      await result.current.mutate(SOURCE_ID, { nameSuffix: ' (copy)' });
    });

    expect(duplicateDocumentMock).toHaveBeenCalledTimes(1);
    expect(duplicateDocumentMock).toHaveBeenCalledWith(expect.any(Object), SOURCE_ID, {
      nameSuffix: ' (copy)'
    });
  });

  it('passes options=undefined when caller omits the second argument', async () => {
    const { result } = renderHook(() => useDuplicateDocument());

    await act(async () => {
      await result.current.mutate(SOURCE_ID);
    });

    // Default-suffix selection is the helper's responsibility, not the hook's.
    // Forwarding `undefined` verbatim keeps that contract testable in isolation.
    expect(duplicateDocumentMock).toHaveBeenCalledWith(expect.any(Object), SOURCE_ID, undefined);
  });

  it('returns the helper response verbatim on success', async () => {
    const { result } = renderHook(() => useDuplicateDocument());

    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      response = await result.current.mutate(SOURCE_ID);
    });

    expect(response?.error).toBeNull();
    expect(response?.data?.name).toBe('Złącze T 1 (kopia)');
  });

  it('toggles pending=true during the await and back to false after', async () => {
    let resolveHelper: ((v: typeof okResponse) => void) | null = null;
    duplicateDocumentMock.mockImplementationOnce(
      () =>
        new Promise<typeof okResponse>((resolve) => {
          resolveHelper = resolve;
        })
    );

    const { result } = renderHook(() => useDuplicateDocument());

    let mutatePromise: Promise<unknown> | undefined;
    await act(async () => {
      mutatePromise = result.current.mutate(SOURCE_ID);
    });

    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolveHelper?.(okResponse);
      await mutatePromise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('flips pending back to false when the helper resolves with a mapped error', async () => {
    duplicateDocumentMock.mockResolvedValueOnce({
      data: null,
      error: {
        business: BusinessError.PROJECT_LIMIT_EXCEEDED,
        message: 'errors.project_limit_exceeded'
      }
    });

    const { result } = renderHook(() => useDuplicateDocument());

    await act(async () => {
      await result.current.mutate(SOURCE_ID);
    });

    expect(result.current.pending).toBe(false);
  });

  it('flips pending back to false even if the helper throws', async () => {
    duplicateDocumentMock.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useDuplicateDocument());

    await act(async () => {
      await expect(result.current.mutate(SOURCE_ID)).rejects.toThrow('boom');
    });

    expect(result.current.pending).toBe(false);
  });
});
