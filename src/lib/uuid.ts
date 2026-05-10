/**
 * RFC 4122 UUID validator.
 *
 * Used as a client-side preflight before any PostgREST query that filters by a
 * UUID column (e.g. `documents.id`). Without this guard, PostgREST returns
 * Postgres error 22P02 (`invalid_text_representation`) → mapped to UNKNOWN,
 * costing a network round-trip and surfacing a generic error to the user.
 *
 * The pattern accepts any UUID variant (v1–v5 + nil). Supabase generates v4
 * for primary keys via `gen_random_uuid()`, but staying lax here means the
 * helper is reusable for any UUID column without per-version branching.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
