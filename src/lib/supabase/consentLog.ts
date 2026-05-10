import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { ConsentLogItemDto } from '@/types/api';
import { BusinessError, mapPostgrestError, type MappedError } from './errors';

/**
 * Column whitelist for the Privacy settings page and `GET /api/user/export`.
 * Deliberately omits `id`, `user_id`, `ip_address`, and `user_agent`:
 *   - `ip_address` is a privacy-sensitive INET stored only for audit
 *     traceability (column-level minimisation; RLS is row-level only).
 *   - `user_agent` is audit-only.
 *   - `id` / `user_id` are not part of the user-visible payload.
 * Reference: api-plan.md §6 + list-consent-log-get endpoint plan §6.
 */
const SELECT_COLUMNS = 'consent_type, version, accepted, accepted_at' as const;

export type ListConsentLogResult =
  | { data: ConsentLogItemDto[]; error: null }
  | { data: null; error: MappedError };

/**
 * List the authenticated user's RODO consent history (append-only audit trail).
 *
 * Authorisation lives in the database, not here:
 *   - RLS policy `consent_log_select_authenticated` enforces
 *     `user_id = auth.uid()`. The table has no UPDATE/DELETE policies — it is
 *     structurally append-only. The only mutation path is `POST /api/consent`.
 *
 * The `auth.getUser()` preflight is NOT a duplicate of RLS — it guards the
 * anon-role-with-no-cookies case (logout in another tab, manual cookie clear).
 * Without it, a session-less call would hit PostgREST as `anon` and silently
 * return `[]`, which UI would render as "no consent history" instead of
 * surfacing the auth problem.
 *
 * `.eq('user_id', user.id)` is redundant given RLS but kept for query-plan
 * determinism — it makes Postgres choose the
 * `consent_log_user_id_type_accepted_at_idx (user_id, consent_type,
 * accepted_at DESC)` index for the WHERE + ORDER BY combination.
 *
 * Empty array `[]` is a normal successful response (e.g. pathological
 * migration state — registration guarantees at least three rows in practice).
 * Callers must treat it as "no history yet", not as an error.
 *
 * The helper accepts the generic `SupabaseClient<Database>` so it works with
 * both the browser client (`src/lib/supabase/client.ts`) and the server
 * client (`src/lib/supabase/server.ts`). Do NOT pass an admin client —
 * service-role bypasses RLS and would leak other users' consent rows.
 */
export async function listConsentLog(
  supabase: SupabaseClient<Database>
): Promise<ListConsentLogResult> {
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      data: null,
      error: { business: BusinessError.UNAUTHORIZED, message: 'errors.unauthorized' }
    };
  }

  const { data, error } = await supabase
    .from('consent_log')
    .select(SELECT_COLUMNS)
    .eq('user_id', user.id)
    .order('accepted_at', { ascending: false });

  if (error) {
    const mapped = mapPostgrestError(error) ?? {
      business: BusinessError.UNKNOWN,
      message: 'errors.unknown',
      rawCode: error.code,
      rawMessage: error.message
    };
    return { data: null, error: mapped };
  }

  return {
    data: (data ?? []) as ConsentLogItemDto[],
    error: null
  };
}
