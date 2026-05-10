-- ============================================================
-- 20260512000000_name_documents_check_constraints
-- ============================================================
-- Assigns stable, self-documenting names to the three anonymous CHECK
-- constraints on `public.documents`. Originally declared without names in
-- 20260507000000_complete_schema.sql, Postgres auto-generated:
--   * documents_name_check   — length(trim(name)) > 0 AND length(name) <= 100
--   * documents_data_check   — jsonb_typeof(data) shape guard
--   * documents_data_check1  — octet_length(data::text) < 5 MB
--
-- The first two names happen to be readable; `documents_data_check1` is
-- order-dependent — if a future migration inserts another CHECK on `data`
-- before the size CHECK, the suffix shifts and `mapPostgrestError` silently
-- starts misclassifying real 23514 violations.
--
-- This migration renames each constraint to a deterministic name:
--   * documents_name_check       (unchanged — already deterministic)
--   * documents_data_shape_check
--   * documents_data_size_check
--
-- `mapPostgrestError` (src/lib/supabase/errors.ts) already matches BOTH the
-- old auto-names and the new explicit names, so this migration is a no-op
-- behaviourally — it just shifts the matcher from a fragile name to a
-- durable one.
-- ============================================================

alter table public.documents
  rename constraint documents_data_check to documents_data_shape_check;

alter table public.documents
  rename constraint documents_data_check1 to documents_data_size_check;

-- `documents_name_check` is left in place — it is the auto-generated name
-- when only one CHECK exists on a column, so it is already deterministic
-- and matches both pg_constraint output and the explicit form.

comment on constraint documents_data_shape_check on public.documents is
  'Structural shape guard: data must be a JSONB object with schemaVersion, shapes[], weldUnits[]. Matched by mapPostgrestError → DOCUMENT_DATA_SHAPE_INVALID.';

comment on constraint documents_data_size_check on public.documents is
  'Hard 5 MB cap on serialised data column (octet_length(data::text)). Matched by mapPostgrestError → DOCUMENT_PAYLOAD_TOO_LARGE.';

comment on constraint documents_name_check on public.documents is
  'Trimmed name must be non-empty and at most 100 characters. Matched by mapPostgrestError → DOCUMENT_NAME_INVALID.';
