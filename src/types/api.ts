/**
 * API DTOs and Command Models for WelderDoc.
 * All types are derived from or anchored to src/types/database.ts.
 * Reference: .ai/api-plan.md
 */

import type { Tables, TablesUpdate } from './database';

// ============================================================
// LITERALS
// ============================================================

export type ConsentType = 'terms_of_service' | 'privacy_policy' | 'cookies';
export type UserPlan = 'free' | 'pro';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
export type SubscriptionPlanTier = 'pro_monthly' | 'pro_annual';
export type AppLocale = 'pl' | 'en';

// ============================================================
// CANVAS DOCUMENT
// Typed representation of the documents.data JSONB column.
// ============================================================

export interface CanvasDocument {
  schemaVersion: number;
  canvasWidth: number;
  canvasHeight: number;
  /**
   * Serialised shape geometries — typed in src/shapes/ once shapes are implemented.
   * Kept as unknown[] here to avoid a circular dependency between types and shapes.
   */
  shapes: unknown[];
  weldUnits: unknown[];
}

// ============================================================
// DOCUMENTS
// ============================================================

/** Lightweight list item — data blob excluded (document list view). */
export type DocumentListItemDto = Pick<
  Tables<'documents'>,
  'id' | 'name' | 'created_at' | 'updated_at'
>;

/** Full document with typed canvas payload (canvas editor). */
export type DocumentDto = Pick<
  Tables<'documents'>,
  'id' | 'name' | 'schema_version' | 'created_at' | 'updated_at'
> & { data: CanvasDocument };

/** Command: create a new document (US-008). */
export interface CreateDocumentCommand {
  name: string;
  data: CanvasDocument;
}

/** Command: rename a document (US-013). */
export interface RenameDocumentCommand {
  name: string;
}

/** Command: persist canvas scene (US-009 autosave). */
export interface SaveDocumentDataCommand {
  data: CanvasDocument;
}

/**
 * Command: resize canvas (US-014).
 * Requires a read-modify-write cycle — caller merges into the existing blob
 * before PATCHing, because canvasWidth/canvasHeight live inside JSONB data.
 */
export interface ResizeCanvasCommand {
  canvasWidth: number;
  canvasHeight: number;
}

// ============================================================
// USER PROFILE
// ============================================================

/** Profile returned to the authenticated client. */
export type UserProfileDto = Pick<
  Tables<'user_profiles'>,
  'id' | 'plan' | 'locale' | 'current_consent_version' | 'created_at' | 'updated_at'
>;

/**
 * Safe profile update — excludes protected columns (plan, paddle_customer_id,
 * current_consent_version). Matches the updateProfile() wrapper in
 * src/lib/supabase/profile.ts (api-plan.md §2.2, M3).
 */
export type UpdateProfileCommand = Pick<TablesUpdate<'user_profiles'>, 'locale'>;

// ============================================================
// SUBSCRIPTIONS
// ============================================================

/** Subscription item for billing history (US-044). */
export type SubscriptionDto = Pick<
  Tables<'subscriptions'>,
  | 'id'
  | 'status'
  | 'plan_tier'
  | 'current_period_start'
  | 'current_period_end'
  | 'cancel_at'
  | 'created_at'
>;

// ============================================================
// CONSENT
// ============================================================

/** Single consent_log row returned to the client (ip_address intentionally omitted). */
export type ConsentLogItemDto = Pick<
  Tables<'consent_log'>,
  'consent_type' | 'version' | 'accepted' | 'accepted_at'
>;

/**
 * Command: record consent bundle atomically in one transaction (registration, US-001).
 * Tuple type enforces at least one element.
 */
export interface RecordConsentBundleCommand {
  types: [ConsentType, ...ConsentType[]];
  version: string;
  accepted: boolean;
}

/** Command: record a single consent change (e.g. cookie withdrawal). */
export interface RecordConsentSingleCommand {
  consent_type: ConsentType;
  version: string;
  accepted: boolean;
}

/** Discriminated union — only one of types/consent_type may be present per request. */
export type RecordConsentCommand = RecordConsentBundleCommand | RecordConsentSingleCommand;

/** Single inserted row echoed back inside the bundle response. */
export type ConsentInsertedItemDto = Pick<
  Tables<'consent_log'>,
  'id' | 'consent_type' | 'version' | 'accepted' | 'accepted_at'
>;

/** Response body for POST /api/consent (bundle, 201). */
export interface RecordConsentBundleResponseDto {
  inserted: ConsentInsertedItemDto[];
  current_consent_version: string;
}

/** Response body for POST /api/consent (per-type, 201). */
export type RecordConsentSingleResponseDto = Pick<
  Tables<'consent_log'>,
  'id' | 'user_id' | 'consent_type' | 'version' | 'accepted' | 'accepted_at'
>;

// ============================================================
// USER EXPORT — RODO art. 20
// ============================================================

/** Profile section embedded in the full data export. */
export type ExportProfileDto = Pick<
  Tables<'user_profiles'>,
  'plan' | 'locale' | 'current_consent_version' | 'created_at'
>;

/** Full RODO data portability response (GET /api/user/export). */
export interface UserExportDto {
  user_id: string;
  exported_at: string;
  email: string;
  profile: ExportProfileDto;
  documents: DocumentDto[];
  consent_log: ConsentLogItemDto[];
}

// ============================================================
// ACCOUNT DELETE — RODO art. 17
// ============================================================

/** Command: hard-delete account with password re-auth (DELETE /api/user/account). */
export interface DeleteAccountCommand {
  password: string;
  /** Literal "DELETE" is required as an extra UX safety guard. */
  confirmation: 'DELETE';
}

/** Success response from DELETE /api/user/account. */
export interface DeleteAccountResponseDto {
  deleted: true;
  user_id: string;
  deleted_at: string;
}

// ============================================================
// PADDLE WEBHOOK
// ============================================================

/** Success response from POST /api/paddle/webhook. */
export interface PaddleWebhookResponseDto {
  received: true;
  duplicate?: true;
}

// ============================================================
// HEALTH CHECK
// ============================================================

/** Response from GET /api/health. */
export interface HealthCheckResponseDto {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks?: {
    database: 'unreachable';
  };
}

// ============================================================
// CRON RESPONSES
// ============================================================

/** Response from GET /api/cron/expire-subscriptions. */
export interface ExpireSubscriptionsResponseDto {
  updated: number;
  timestamp: string;
}

/** Response from GET /api/cron/cleanup-webhook-events. */
export interface CleanupWebhookEventsResponseDto {
  deleted: number;
  timestamp: string;
}

// ============================================================
// ERROR RESPONSES (api-plan.md §9)
// ============================================================

/** Generic API error shape. */
export interface ApiErrorDto {
  error: string;
  message?: string;
}

/** Type-safe API error — narrows error to a known string union for a given endpoint. */
export interface TypedApiErrorDto<T extends string> {
  error: T;
  message?: string;
}

export type ConsentApiErrorCode =
  | 'invalid_consent_type'
  | 'invalid_payload'
  | 'missing_fields'
  | 'ambiguous_payload'
  | 'invalid_bundle'
  | 'invalid_idempotency_key'
  | 'unauthorized'
  | 'unauthorized_consent_target'
  | 'idempotency_key_conflict'
  | 'internal_error';

export type PaddleWebhookApiErrorCode =
  | 'missing_signature'
  | 'invalid_signature'
  | 'invalid_payload'
  | 'internal_error';

export type DeleteAccountApiErrorCode =
  | 'missing_fields'
  | 'invalid_confirmation'
  | 'invalid_payload'
  | 'unauthorized'
  | 'invalid_password'
  | 'rate_limited'
  | 'internal_error';

export type UserExportApiErrorCode = 'unauthorized' | 'internal_error';
export type CronApiErrorCode = 'unauthorized' | 'internal_error';
