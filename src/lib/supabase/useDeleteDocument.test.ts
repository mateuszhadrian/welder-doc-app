import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BusinessError } from './errors';

const { deleteDocumentMock } = vi.hoisted(() => ({
  deleteDocumentMock: vi.fn()
}));

vi.mock('./client', () => ({
  createClient: () => ({ __isClient: true })
}));

vi.mock('./documents', async () => {
  const actual = await vi.importActual<typeof import('./documents')>('./documents');
  return {
    ...actual,
    deleteDocument: deleteDocumentMock
  };
});

import { useDeleteDocument } from './useDeleteDocument';

const DOC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const okResponse = { data: null, error: null } as const;

beforeEach(() => {
  vi.clearAllMocks();
  deleteDocumentMock.mockResolvedValue(okResponse);
});

describe('useDeleteDocument', () => {
  it('starts with pending=false', () => {
    const { result } = renderHook(() => useDeleteDocument());
    expect(result.current.pending).toBe(false);
  });

  it('forwards documentId to deleteDocument helper verbatim', async () => {
    const { result } = renderHook(() => useDeleteDocument());

    await act(async () => {
      await result.current.mutate(DOC_ID);
    });

    expect(deleteDocumentMock).toHaveBeenCalledTimes(1);
    expect(deleteDocumentMock).toHaveBeenCalledWith(expect.any(Object), DOC_ID);
  });

  it('returns the helper response verbatim on success', async () => {
    const { result } = renderHook(() => useDeleteDocument());

    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      response = await result.current.mutate(DOC_ID);
    });

    expect(response?.error).toBeNull();
    expect(response?.data).toBeNull();
  });

  it('toggles pending=true during the await and back to false after', async () => {
    let resolveHelper: ((v: typeof okResponse) => void) | null = null;
    deleteDocumentMock.mockImplementationOnce(
      () =>
        new Promise<typeof okResponse>((resolve) => {
          resolveHelper = resolve;
        })
    );

    const { result } = renderHook(() => useDeleteDocument());

    let mutatePromise: Promise<unknown> | undefined;
    await act(async () => {
      mutatePromise = result.current.mutate(DOC_ID);
    });

    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolveHelper?.(okResponse);
      await mutatePromise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('flips pending back to false even when the helper resolves with a mapped error', async () => {
    deleteDocumentMock.mockResolvedValueOnce({
      data: null,
      error: {
        business: BusinessError.UNAUTHORIZED,
        message: 'errors.unauthorized'
      }
    });

    const { result } = renderHook(() => useDeleteDocument());

    await act(async () => {
      await result.current.mutate(DOC_ID);
    });

    expect(result.current.pending).toBe(false);
  });

  it('flips pending back to false even if the helper throws', async () => {
    deleteDocumentMock.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useDeleteDocument());

    await act(async () => {
      await expect(result.current.mutate(DOC_ID)).rejects.toThrow('boom');
    });

    expect(result.current.pending).toBe(false);
  });
});
