import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hashPayload,
  lookupIdempotency,
  storeIdempotency,
  type IdempotencyResult
} from './idempotency';

const KEY = 'idem-key-1';
const KEY_OTHER = 'idem-key-2';
const HASH_A = 'hash-a';
const HASH_B = 'hash-b';

describe('lookupIdempotency / storeIdempotency', () => {
  beforeEach(() => {
    vi.useRealTimers();
    // Map jest module-scoped — usuwamy wpisy testowe na początku każdego testu.
    // Najprostszy sposób: nadpisz wpisy fakeFastTime, lookup zrobi GC TTL.
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('miss: nieznany klucz zwraca { kind: "miss" }', () => {
    const result = lookupIdempotency('never-stored-key', HASH_A);
    expect(result).toEqual<IdempotencyResult>({ kind: 'miss' });
  });

  it('hit: po store zwraca status + body przy pasującym hashu', () => {
    storeIdempotency(KEY, HASH_A, 201, { id: 'x' });
    const result = lookupIdempotency(KEY, HASH_A);
    expect(result).toEqual<IdempotencyResult>({
      kind: 'hit',
      status: 201,
      body: { id: 'x' }
    });
  });

  it('conflict: ten sam klucz z innym hashem → { kind: "conflict" }', () => {
    storeIdempotency(KEY_OTHER, HASH_A, 200, { ok: true });
    const result = lookupIdempotency(KEY_OTHER, HASH_B);
    expect(result).toEqual<IdempotencyResult>({ kind: 'conflict' });
  });

  it('TTL: wpis starszy niż 60s traktowany jako miss', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00Z'));

    storeIdempotency('ttl-key', HASH_A, 201, { id: 'expires' });
    expect(lookupIdempotency('ttl-key', HASH_A)).toMatchObject({ kind: 'hit' });

    // Skacze 61s do przodu — przekroczony TTL.
    vi.setSystemTime(new Date('2026-05-09T12:01:01Z'));
    expect(lookupIdempotency('ttl-key', HASH_A)).toEqual<IdempotencyResult>({ kind: 'miss' });
  });
});

describe('hashPayload', () => {
  it('zwraca deterministyczny SHA-256 hex (64 znaki)', async () => {
    const payload = { user_id: 'u1', amount: 42 };
    const a = await hashPayload(payload);
    const b = await hashPayload(payload);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('różne payloady → różne hashe', async () => {
    const a = await hashPayload({ x: 1 });
    const b = await hashPayload({ x: 2 });
    expect(a).not.toBe(b);
  });

  it('uwzględnia kolejność kluczy w JSON.stringify (różne hashe)', async () => {
    // Pure-spec: hashPayload używa `JSON.stringify` bez canonicalizacji,
    // więc zmiana kolejności kluczy zmienia hash. Test pilnuje, że nikt nie
    // doda canonicalizacji bez świadomości konsekwencji dla porównań.
    const a = await hashPayload({ a: 1, b: 2 });
    const b = await hashPayload({ b: 2, a: 1 });
    expect(a).not.toBe(b);
  });
});
