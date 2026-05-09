import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
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

function makeSupabaseInsert(insertResult: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  return {
    client: { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient<Database>,
    insert
  };
}

describe('migrateGuestAutosave', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('zwraca no_autosave gdy localStorage pusty', async () => {
    const { client, insert } = makeSupabaseInsert({ error: null });
    const result = await migrateGuestAutosave(client, 'user-1', 'Untitled');
    expect(result).toEqual({ migrated: false, reason: 'no_autosave' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('zwraca invalid_payload i czyści klucz przy zepsutym JSON', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, '{not-valid-json');
    const { client, insert } = makeSupabaseInsert({ error: null });
    const result = await migrateGuestAutosave(client, 'user-1', 'Untitled');
    expect(result).toEqual({ migrated: false, reason: 'invalid_payload' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('zwraca invalid_payload gdy brak pola scene', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ schemaVersion: 1 }));
    const { client, insert } = makeSupabaseInsert({ error: null });
    const result = await migrateGuestAutosave(client, 'user-1', 'Untitled');
    expect(result).toEqual({ migrated: false, reason: 'invalid_payload' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it('migruje scenę: INSERT, ustawia sentinel, usuwa autosave', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, validPayload);
    const { client, insert } = makeSupabaseInsert({ error: null });
    const result = await migrateGuestAutosave(client, 'user-1', 'Migrated project');

    expect(result).toEqual({ migrated: true });
    expect(insert).toHaveBeenCalledWith({
      owner_id: 'user-1',
      name: 'Migrated project',
      data: validScene
    });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(window.localStorage.getItem(MIGRATED_AT_KEY)).not.toBeNull();
  });

  it('zachowuje autosave przy PROJECT_LIMIT_EXCEEDED', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, validPayload);
    const { client } = makeSupabaseInsert({
      error: { code: 'P0001', message: 'project_limit_exceeded: free plan' }
    });
    const result = await migrateGuestAutosave(client, 'user-1', 'Untitled');

    expect(result).toEqual({ migrated: false, reason: 'project_limit' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBe(validPayload);
    expect(window.localStorage.getItem(MIGRATED_AT_KEY)).toBeNull();
  });

  it('zwraca db_error przy nieznanym błędzie i nie czyści autosave', async () => {
    window.localStorage.setItem(AUTOSAVE_KEY, validPayload);
    const { client } = makeSupabaseInsert({
      error: { code: '42P01', message: 'relation does not exist' }
    });
    const result = await migrateGuestAutosave(client, 'user-1', 'Untitled');

    expect(result).toEqual({ migrated: false, reason: 'db_error' });
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBe(validPayload);
  });
});
