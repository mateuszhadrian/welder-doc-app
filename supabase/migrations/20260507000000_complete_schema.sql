-- migration: 20260507000000_complete_schema.sql
-- purpose: greenfield initial schema for the welderdoc mvp
-- affected tables: user_profiles, documents, subscriptions, consent_log, webhook_events
-- affected functions: set_updated_at, handle_new_user, effective_plan,
--                     refresh_user_plan_from_subscriptions, trg_subscriptions_refresh_plan,
--                     refresh_expired_plans, check_free_project_limit,
--                     block_protected_columns_update, sync_schema_version_from_data,
--                     sync_paddle_customer
-- special considerations:
--   - atomic (single transaction via supabase cli migration runner)
--   - all functions use security definer + set search_path = '' (cve-2018-1058 mitigation)
--   - rls enabled on every public table; webhook_events has no policies (service_role only)

-- ============================================================
-- step 1: base functions (set_updated_at, handle_new_user)
-- ============================================================

-- generic updated_at maintenance function, reused by all tables that have updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- inserts a default user_profiles row when a new auth.users record is created
-- called exclusively by the on_auth_user_created trigger — never invoked directly
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id)
  values (new.id);
  return new;
end;
$$;

-- ============================================================
-- step 2: tables (parents → children)
-- ============================================================

-- 1:1 profile for every auth.users row
-- created by trigger; direct inserts are not allowed via rls
create table public.user_profiles (
  id                      uuid        primary key references auth.users(id) on delete cascade,
  plan                    text        not null default 'free'
                                        check (plan in ('free', 'pro')),
  paddle_customer_id      text        unique,
  current_consent_version text,
  locale                  text        not null default 'pl'
                                        check (locale in ('pl', 'en')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- one row = one welding project; scene is stored as a single jsonb blob
create table public.documents (
  id                     uuid        primary key default gen_random_uuid(),
  owner_id               uuid        not null references auth.users(id) on delete cascade,
  name                   text        not null
                                       check (length(trim(name)) > 0 and length(name) <= 100),
  -- structural validity: must be an object with schemaVersion, shapes[], and weldUnits[]
  -- size cap: < 5 mb raw (octet_length on the text serialisation)
  data                   jsonb       not null
                                       check (
                                         jsonb_typeof(data) = 'object'
                                         and data ? 'schemaVersion'
                                         and jsonb_typeof(data -> 'shapes') = 'array'
                                         and jsonb_typeof(data -> 'weldUnits') = 'array'
                                       )
                                       check (octet_length(data::text) < 5 * 1024 * 1024),
  schema_version         int         not null default 1,
  share_token            text        unique,
  share_token_expires_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- paddle subscription history — source of truth for the user's effective plan
-- mutated exclusively by the paddle webhook handler (service_role)
create table public.subscriptions (
  id                       uuid        primary key default gen_random_uuid(),
  -- set null on user delete so billing audit survives gdpr erasure
  user_id                  uuid        references auth.users(id) on delete set null,
  paddle_subscription_id   text        not null unique,
  -- in-row snapshot retained after set null for billing audit continuity
  paddle_customer_snapshot text        not null,
  status                   text        not null
                                         check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  plan_tier                text        not null
                                         check (plan_tier in ('pro_monthly', 'pro_annual')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- append-only gdpr consent audit log; revocation = new row with accepted = false
-- no updated_at column by design (immutable rows)
create table public.consent_log (
  id           bigserial   primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  consent_type text        not null
                             check (consent_type in ('terms_of_service', 'privacy_policy', 'cookies')),
  version      text        not null,
  accepted     boolean     not null,
  accepted_at  timestamptz not null default now(),
  -- anonymised by application before insert: /24 for ipv4, /48 for ipv6 (gdpr recital 30)
  ip_address   inet,
  user_agent   text
);

-- idempotent audit log for all incoming webhook events
-- unique (provider, external_event_id) guarantees at-most-once processing
-- no rls policies: accessible only from service_role
-- no updated_at column by design (append-only)
create table public.webhook_events (
  id                bigserial   primary key,
  provider          text        not null,
  external_event_id text        not null,
  event_type        text        not null,
  payload           jsonb       not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, external_event_id)
);

-- ============================================================
-- step 3: indexes
-- ============================================================

-- hot-path: project list sorted by last modified (prd us-008)
create index documents_owner_id_updated_at_idx
  on public.documents (owner_id, updated_at desc);

-- full b-tree on schema_version: detects documents that need codec migration to a newer schemaVersion
-- a partial index `where schema_version < N` was rejected: the literal would need manual maintenance
-- on every codec bump; full b-tree cost is negligible at MVP project counts
create index documents_schema_version_idx
  on public.documents (schema_version);

-- effective_plan() lookup: find active / trialing / grace-period subscriptions per user
create index subscriptions_user_id_status_period_end_idx
  on public.subscriptions (user_id, status, current_period_end desc);

-- most-recent consent decision per user per consent type
create index consent_log_user_id_type_accepted_at_idx
  on public.consent_log (user_id, consent_type, accepted_at desc);

-- cron retention: delete webhook_events older than 90 days
create index webhook_events_received_at_idx
  on public.webhook_events (received_at);

-- ============================================================
-- step 4: business functions (all security definer, empty search_path)
-- ============================================================

-- returns the effective plan for a given user:
--   'pro'  — if any subscription is trialing/active/past_due, or canceled within grace period
--   'free' — otherwise
create or replace function public.effective_plan(uid uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when exists (
      select 1 from public.subscriptions s
      where s.user_id = uid
        and (
          s.status in ('trialing', 'active', 'past_due')
          or (s.status = 'canceled' and s.current_period_end > now())
        )
    ) then 'pro'
    else 'free'
  end;
$$;

-- refreshes the user_profiles.plan cache for a single user from the subscriptions table
-- callable from application code (e.g. after manual reconciliation) and from triggers
create or replace function public.refresh_user_plan_from_subscriptions(uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles
  set plan = public.effective_plan(uid)
  where id = uid;
end;
$$;

-- trigger wrapper for subscriptions_after_iu_refresh_plan
-- trigger functions cannot receive runtime row values as arguments, hence the wrapper
create or replace function public.trg_subscriptions_refresh_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    perform public.refresh_user_plan_from_subscriptions(new.user_id);
  end if;
  return new;
end;
$$;

-- daily cron: downgrades users whose canceled subscription grace period has expired
-- called by vercel cron /api/cron/expire-subscriptions at 03:00 utc
-- returns the number of user_profiles rows that were downgraded
create or replace function public.refresh_expired_plans()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected int;
begin
  with expired_users as (
    -- users whose only subscriptions are canceled and past the grace period
    select distinct s.user_id
    from public.subscriptions s
    where s.user_id is not null
      and s.status = 'canceled'
      and s.current_period_end <= now()
      and not exists (
        select 1 from public.subscriptions s2
        where s2.user_id = s.user_id
          and s2.status in ('trialing', 'active', 'past_due')
      )
  )
  update public.user_profiles up
  set plan = 'free'
  from expired_users eu
  where up.id = eu.user_id
    and up.plan <> 'free';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- trigger: enforces the free plan limit of 1 document per user at the database level
-- fires before insert (new document) and before update of owner_id (ownership transfer)
-- the application enforces the same rule in the ui, but this is the authoritative check:
--   - prevents race conditions (two concurrent tabs)
--   - blocks direct rest api calls that bypass ui logic
-- raises 'project_limit_exceeded' so the application can map it to a localised error key
create or replace function public.check_free_project_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_plan text;
  doc_count  int;
begin
  select plan into owner_plan
  from public.user_profiles
  where id = new.owner_id;

  if owner_plan = 'free' then
    -- count existing documents for the target owner, excluding the current row
    -- for insert: id <> new.id is always true (row doesn't exist yet), counts all
    -- for update of owner_id: excludes the row being transferred
    select count(*) into doc_count
    from public.documents
    where owner_id = new.owner_id
      and id <> new.id;

    if doc_count >= 1 then
      raise exception 'project_limit_exceeded'
        using hint = 'upgrade to pro to create more projects';
    end if;
  end if;

  return new;
end;
$$;

-- trigger: silently resets plan, paddle_customer_id and current_consent_version
-- to their existing values when the requesting jwt role is not service_role
-- silent (no exception) so that a single update statement can safely modify
-- locale alongside the protected columns without failing
-- actual writes to:
--   - plan, paddle_customer_id: security definer functions on subscriptions triggers
--     (refresh_user_plan_from_subscriptions, sync_paddle_customer)
--   - current_consent_version: only the /api/consent route handler (service_role)
--     after a successful bundle insert into consent_log; this prevents the client
--     from forging current_consent_version without a corresponding consent_log entry
--     (gdpr art. 7 ust. 1 audit integrity)
-- coalesce(auth.role(), 'anon'): defensive default for contexts without supabase auth
-- (raw psql, unit tests on a bare postgres container) where auth.role() returns null;
-- without coalesce the postgres 3-valued logic would evaluate `null <> 'service_role'`
-- to null and fall through, silently allowing protected-column updates in tests
create or replace function public.block_protected_columns_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' then
    new.plan                    := old.plan;
    new.paddle_customer_id      := old.paddle_customer_id;
    new.current_consent_version := old.current_consent_version;
  end if;
  return new;
end;
$$;

-- trigger: keeps the documents.schema_version column in sync with data->>'schemaVersion'
-- schema_version as a first-class column enables efficient partial-index queries for codec migration
create or replace function public.sync_schema_version_from_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.schema_version := coalesce(
    (new.data ->> 'schemaVersion')::int,
    new.schema_version,
    1
  );
  return new;
end;
$$;

-- trigger: propagates paddle customer id to user_profiles when it is still null
-- handles the case where paddle sends subscription.created before customer.created,
-- so there is no guaranteed ordering between the two webhook types
create or replace function public.sync_paddle_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    update public.user_profiles
    set paddle_customer_id = new.paddle_customer_snapshot
    where id = new.user_id
      and paddle_customer_id is null;
  end if;
  return new;
end;
$$;

-- ============================================================
-- step 5: triggers
-- ============================================================

-- auth.users → create user_profiles row on registration
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- user_profiles: fires alphabetically before set_updated_at (b < s)
-- resets protected columns for non-service_role callers
create trigger user_profiles_before_update_block_protected
  before update on public.user_profiles
  for each row execute function public.block_protected_columns_update();

-- user_profiles: keep updated_at current on any update
create trigger user_profiles_before_update_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- documents: sync schema_version from jsonb on insert or when data column changes
create trigger documents_before_iu_sync_schema_version
  before insert or update of data on public.documents
  for each row execute function public.sync_schema_version_from_data();

-- documents: enforce free plan project limit on insert and on ownership transfer
create trigger documents_before_iu_check_free_limit
  before insert or update of owner_id on public.documents
  for each row execute function public.check_free_project_limit();

-- documents: keep updated_at current on any update
create trigger documents_before_update_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- subscriptions: keep updated_at current on any update
create trigger subscriptions_before_update_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- subscriptions: propagate paddle_customer_id to user_profiles when null
create trigger subscriptions_after_iu_sync_customer
  after insert or update of paddle_customer_snapshot, user_id on public.subscriptions
  for each row execute function public.sync_paddle_customer();

-- subscriptions: refresh user_profiles.plan cache after status or billing period changes
create trigger subscriptions_after_iu_refresh_plan
  after insert or update of status, current_period_end on public.subscriptions
  for each row execute function public.trg_subscriptions_refresh_plan();

-- ============================================================
-- step 6: row level security
-- ============================================================

-- enable rls on every public table (mandatory even for service_role-only tables)
alter table public.user_profiles  enable row level security;
alter table public.documents       enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.consent_log     enable row level security;
alter table public.webhook_events  enable row level security;

-- ── user_profiles ─────────────────────────────────────────────────────────────

-- authenticated users may read only their own profile row
create policy user_profiles_select_authenticated
  on public.user_profiles
  for select
  to authenticated
  using (id = auth.uid());

-- authenticated users may update their own profile (locale, current_consent_version)
-- plan and paddle_customer_id changes are silently blocked by the block_protected trigger
create policy user_profiles_update_authenticated
  on public.user_profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- no insert policy: inserts are performed only by handle_new_user() (security definer trigger)
-- no delete policy: deletions cascade from auth.users

-- ── documents ─────────────────────────────────────────────────────────────────

-- email verification is required before any document operation;
-- prevents abuse via unconfirmed throwaway accounts (prod only — see db-plan §5.13a)
-- single FOR ALL policy (db-plan §4.2): one source of truth for the membership rule;
-- splitting into 4 per-operation policies would duplicate the body and make the rule
-- prone to desync on future edits (e.g. if we ever add a status check to the predicate)
create policy documents_owner_all
  on public.documents
  for all
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.email_confirmed_at is not null
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.email_confirmed_at is not null
    )
  );

-- ── subscriptions ─────────────────────────────────────────────────────────────

-- authenticated users may read their own subscription history (e.g. billing page)
create policy subscriptions_select_authenticated
  on public.subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

-- no insert / update / delete policies: mutations are performed exclusively
-- by the paddle webhook handler running as service_role

-- ── consent_log ───────────────────────────────────────────────────────────────

-- authenticated users may read their own consent history
create policy consent_log_select_authenticated
  on public.consent_log
  for select
  to authenticated
  using (user_id = auth.uid());

-- authenticated users may append new consent rows for themselves (gdpr art. 7)
create policy consent_log_insert_authenticated
  on public.consent_log
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- no update / delete policies: append-only by design (gdpr art. 7 ust. 1 audit trail)

-- ── webhook_events ────────────────────────────────────────────────────────────

-- no policies created: rls is enabled but no policy = zero access for all roles
-- accessible only from service_role which bypasses rls entirely

-- ============================================================
-- step 7: table and column comments (supabase studio + gen types)
-- ============================================================

comment on table public.user_profiles is
  '1:1 profile per auth.users row; created by trigger on_auth_user_created';

comment on table public.documents is
  'welding project; full scene stored as a single jsonb blob in the data column';

comment on table public.subscriptions is
  'paddle subscription history; effective plan is derived via effective_plan() and cached in user_profiles.plan';

comment on table public.consent_log is
  'append-only gdpr consent audit trail; revocation is a new row with accepted = false';

comment on table public.webhook_events is
  'idempotent audit log for incoming webhook events; accessible only from service_role';

comment on column public.user_profiles.plan is
  'denormalised cache of the effective plan derived from subscriptions; updated by trigger, never written directly by application code';

comment on column public.user_profiles.paddle_customer_id is
  'canonical paddle customer id (1:1 with auth.users); populated by sync_paddle_customer trigger';

comment on column public.user_profiles.current_consent_version is
  'denormalised version of the most recent accepted consent bundle (tos+pp+cookies); read-only for the authenticated role (block_protected_columns_update trigger); written exclusively by the /api/consent route handler running as service_role after a successful bundle insert into consent_log';

comment on column public.documents.schema_version is
  'mirrors data->>schemaVersion as a first-class column for efficient partial-index queries during codec migration; kept in sync by sync_schema_version_from_data trigger';

comment on column public.documents.share_token is
  'reserved for post-mvp public share link feature; format: encode(gen_random_bytes(24), ''base64url'')';

comment on column public.documents.share_token_expires_at is
  'reserved for post-mvp: ttl for the share link identified by share_token';

comment on column public.subscriptions.paddle_customer_snapshot is
  'in-row copy of the paddle customer id retained after on delete set null on user_id; preserves billing audit trail after gdpr erasure';

comment on column public.webhook_events.payload is
  'raw webhook payload from the provider; stored verbatim for audit and idempotent reprocessing';
