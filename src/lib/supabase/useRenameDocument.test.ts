import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BusinessError } from './errors';

const { renameDocumentMock } = vi.hoisted(() => ({
  renameDocumentMock: vi.fn()
}));

vi.mock('./client', () => ({
  createClient: () => ({ __isClient: true })
}));

vi.mock('./documents', async () => {
  const actual = await vi.importActual<typeof import('./documents')>('./documents');
  return {
    ...actual,
    renameDocument: renameDocumentMock
  };
});

import { useRenameDocument } from './useRenameDocument';

const DOC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const okResponse = {
  data: {
    id: DOC_ID,
    name: 'Nowa nazwa',
    schema_version: 1,
    data: { schemaVersion: 1, canvasWidth: 100, canvasHeight: 100, shapes: [], weldUnits: [] },
    created_at: '2026-05-10T12:00:00Z',
    updated_at: '2026-05-10T13:00:00Z'
  },
  error: null
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  renameDocumentMock.mockResolvedValue(okResponse);
});

describe('useRenameDocument', () => {
  it('starts with pending=false', () => {
    const { result } = renderHook(() => useRenameDocument());
    expect(result.current.pending).toBe(false);
  });

  it('forwards documentId and command to renameDocument helper verbatim', async () => {
    const { result } = renderHook(() => useRenameDocument());

    await act(async () => {
      await result.current.mutate(DOC_ID, { name: 'Nowa nazwa' });
    });

    expect(renameDocumentMock).toHaveBeenCalledTimes(1);
    expect(renameDocumentMock).toHaveBeenCalledWith(expect.any(Object), DOC_ID, {
      name: 'Nowa nazwa'
    });
  });

  it('returns the helper response verbatim on success', async () => {
    const { result } = renderHook(() => useRenameDocument());

    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      response = await result.current.mutate(DOC_ID, { name: 'ok' });
    });

    expect(response?.error).toBeNull();
    expect(response?.data?.name).toBe('Nowa nazwa');
  });

  it('toggles pending=true during the await and back to false after', async () => {
    let resolveHelper: ((v: typeof okResponse) => void) | null = null;
    renameDocumentMock.mockImplementationOnce(
      () =>
        new Promise<typeof okResponse>((resolve) => {
          resolveHelper = resolve;
        })
    );

    const { result } = renderHook(() => useRenameDocument());

    // Kick off the mutation inside act() and let the synchronous setPending(true)
    // flush — but don't await the in-flight promise yet (the helper mock holds
    // it open via resolveHelper).
    let mutatePromise: Promise<unknown> | undefined;
    await act(async () => {
      mutatePromise = result.current.mutate(DOC_ID, { name: 'ok' });
    });

    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolveHelper?.(okResponse);
      await mutatePromise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('flips pending back to false even when the helper rejects with a mapped error', async () => {
    renameDocumentMock.mockResolvedValueOnce({
      data: null,
      error: {
        business: BusinessError.DOCUMENT_NAME_INVALID,
        message: 'errors.document_name_invalid'
      }
    });

    const { result } = renderHook(() => useRenameDocument());

    await act(async () => {
      await result.current.mutate(DOC_ID, { name: '' });
    });

    expect(result.current.pending).toBe(false);
  });

  it('flips pending back to false even if the helper throws', async () => {
    renameDocumentMock.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useRenameDocument());

    await act(async () => {
      await expect(result.current.mutate(DOC_ID, { name: 'ok' })).rejects.toThrow('boom');
    });

    expect(result.current.pending).toBe(false);
  });
});
