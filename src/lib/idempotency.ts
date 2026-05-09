type CacheEntry = { payloadHash: string; status: number; body: unknown; expiresAt: number };

export type IdempotencyResult =
  | { kind: 'hit'; status: number; body: unknown }
  | { kind: 'conflict' }
  | { kind: 'miss' };

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function lookupIdempotency(key: string, payloadHash: string): IdempotencyResult {
  const entry = cache.get(key);
  if (!entry) return { kind: 'miss' };
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return { kind: 'miss' };
  }
  if (entry.payloadHash !== payloadHash) return { kind: 'conflict' };
  return { kind: 'hit', status: entry.status, body: entry.body };
}

export function storeIdempotency(
  key: string,
  payloadHash: string,
  status: number,
  body: unknown
): void {
  cache.set(key, { payloadHash, status, body, expiresAt: Date.now() + TTL_MS });
}

export async function hashPayload(body: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
