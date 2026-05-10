import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { BusinessError } from '@/lib/supabase/errors';

const { createDocumentMock } = vi.hoisted(() => ({ createDocumentMock: vi.fn() }));

vi.mock('@/lib/supabase/documents', () => ({
  createDocument: createDocumentMock
}));

import { migrateGuestAutosave } from './migrateGuestAutosave';

const AUTOSAVE_KEY = 'welderdoc_autosave';
const MIGRATED_AT_KEY = 'welderdoc_migrated_at';

const validScene = {
  schemaVersion: 1,
  canvasWidth: 800,
  canvasHeight: 600,
  shapes: [],
  weldUnits: []
};

const validPayload = JSON.stringify({ schemaVersion: 1, scene: validScene });

const stubClient = {} as unknown as SupabaseClient<Database>;

beforeEach(() => {
  window.localStorage.clear();
  createDocumentMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migrateGuestAutosave', () => {
  it('zwraca no_autosave gdy localStorage pusty', async () => {
    const result = await migrateGuestAutosave(stubClient, 'Untitled');
    expect(result).toEqual({ migrated: false, reason: 'no_autosave' });
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('zwraca invalid_payload i czyści klucz przy zepsutym JSON', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, '{not-valid-json');
    const result = await migrateGuestAutosave(stubClient, 'Untitled');
    expect(result).toEqual({ migrated: false, reason: 'invalid_payload' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('zwraca invalid_payload gdy brak pola scene', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ schemaVersion: 1 }));
    const result = await migrateGuestAutosave(stubClient, 'Untitled');
    expect(result).toEqual({ migrated: false, reason: 'invalid_payload' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('migruje scenę: woła createDocument, ustawia sentinel, usuwa autosave', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, validPayload);
    createDocumentMock.mockResolvedValue({
      data: {
        id: 'doc-1',
        name: 'Migrated project',
        schema_version: 1,
        data: validScene,
        created_at: '2026-05-08T12:00:00Z',
        updated_at: '2026-05-08T12:00:00Z'
      },
      error: null
    });

    const result = await migrateGuestAutosave(stubClient, 'Migrated project');

    expect(result).toEqual({ migrated: true });
    expect(createDocumentMock).toHaveBeenCalledWith(stubClient, {
      name: 'Migrated project',
      data: validScene
    });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(window.localStorage.getItem(MIGRATED_AT_KEY)).not.toBeNull();
  });

  it('zachowuje autosave przy PROJECT_LIMIT_EXCEEDED', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, validPayload);
    createDocumentMock.mockResolvedValue({
      data: null,
      error: {
        business: BusinessError.PROJECT_LIMIT_EXCEEDED,
        message: 'errors.project_limit_exceeded'
      }
    });

    const result = await migrateGuestAutosave(stubClient, 'Untitled');

    expect(result).toEqual({ migrated: false, reason: 'project_limit' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBe(validPayload);
    expect(window.localStorage.getItem(MIGRATED_AT_KEY)).toBeNull();
  });

  it('zwraca db_error przy nieznanym błędzie i nie czyści autosave', async () => {
    // Suppress the helper's diagnostic console.error so the test output stays
    // clean — we verify the surface contract, not the log line.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.localStorage.setItem(AUTOSAVE_KEY, validPayload);
    createDocumentMock.mockResolvedValue({
      data: null,
      error: {
        business: BusinessError.UNKNOWN,
        message: 'errors.unknown',
        rawCode: '42P01',
        rawMessage: 'relation does not exist'
      }
    });

    const result = await migrateGuestAutosave(stubClient, 'Untitled');

    expect(result).toEqual({ migrated: false, reason: 'db_error' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBe(validPayload);
  });

  it('mapuje DOCUMENT_PAYLOAD_TOO_LARGE również jako db_error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.localStorage.setItem(AUTOSAVE_KEY, validPayload);
    createDocumentMock.mockResolvedValue({
      data: null,
      error: {
        business: BusinessError.DOCUMENT_PAYLOAD_TOO_LARGE,
        message: 'errors.document_payload_too_large'
      }
    });

    const result = await migrateGuestAutosave(stubClient, 'Untitled');

    expect(result).toEqual({ migrated: false, reason: 'db_error' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBe(validPayload);
  });
});
