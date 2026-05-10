import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

const PASSWORD = 'Test123456!';
const EXPORT_USER_ID = '66666666-6666-6666-6666-666666666666';
const EXPORT_USER_EMAIL = 'e2e-export@test.local';
const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Ordered newest-first; the helper sorts `accepted_at DESC`, so the export
// payload should land in this exact order. Three distinct timestamps make the
// ordering assertion meaningful (vs. a tie-break race on identical now()).
const CONSENT_TIMESTAMPS = {
  terms_of_service: '2026-05-10T12:00:00+00:00',
  privacy_policy: '2026-05-10T11:00:00+00:00',
  cookies: '2026-05-10T10:00:00+00:00'
} as const;
const CONSENT_VERSION = '2026-05-01';

function runSql(sql: string): string {
  const path = join(tmpdir(), `user-export-${Date.now()}-${Math.random()}.sql`);
  writeFileSync(path, sql);
  try {
    return execSync(`psql "${LOCAL_DB_URL}" -tA -f "${path}"`, { encoding: 'utf8' }).trim();
  } finally {
    unlinkSync(path);
  }
}

function recreateExportTargetUser() {
  // Cascade-drop via auth.users FK, then re-insert deterministically. Runs as
  // `postgres` superuser, so it bypasses the protected-columns trigger and can
  // backdate consent_log rows with our chosen `accepted_at` values.
  runSql(`
    delete from auth.users where id = '${EXPORT_USER_ID}';
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '${EXPORT_USER_ID}',
      'authenticated', 'authenticated',
      '${EXPORT_USER_EMAIL}',
      crypt('${PASSWORD}', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb
    );
    update public.user_profiles
    set locale = 'pl', current_consent_version = '${CONSENT_VERSION}'
    where id = '${EXPORT_USER_ID}';
    insert into public.consent_log (user_id, consent_type, version, accepted, accepted_at, ip_address, user_agent)
    values
      ('${EXPORT_USER_ID}', 'terms_of_service', '${CONSENT_VERSION}', true,  '${CONSENT_TIMESTAMPS.terms_of_service}', null, null),
      ('${EXPORT_USER_ID}', 'privacy_policy',   '${CONSENT_VERSION}', true,  '${CONSENT_TIMESTAMPS.privacy_policy}',   null, null),
      ('${EXPORT_USER_ID}', 'cookies',          '${CONSENT_VERSION}', true,  '${CONSENT_TIMESTAMPS.cookies}',          null, null);
  `);
}

function deleteExportTargetUser() {
  runSql(`delete from auth.users where id = '${EXPORT_USER_ID}';`);
}

// Tests in this file mutate the same auth.users row → run serially.
test.describe.configure({ mode: 'serial' });

test.describe('GET /api/user/export (RODO art. 20)', () => {
  test.beforeEach(async ({ context, page }) => {
    recreateExportTargetUser();
    await context.clearCookies();
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[browser console.error] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`[browser pageerror] ${err.message}`);
    });
  });

  test.afterAll(() => {
    deleteExportTargetUser();
  });

  test('zalogowany użytkownik → 200, JSON ma consent_log DESC bez ip_address/user_agent/id/user_id', async ({
    page
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EXPORT_USER_EMAIL);
    await page.getByLabel('Hasło').fill(PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await page.waitForURL((url) => url.pathname === '/');

    // `page.request` shares the BrowserContext's cookies (including the
    // Supabase sb-* session cookies set by the login redirect). The top-level
    // `request` fixture is a separate APIRequestContext and would carry no
    // auth, yielding a misleading 401.
    const res = await page.request.get('/api/user/export');
    expect(res.status()).toBe(200);

    // Plan §4 — Content-Disposition niesie nazwę pliku z datą.
    const disposition = res.headers()['content-disposition'];
    expect(disposition).toMatch(
      /attachment;\s*filename="welderdoc-export-\d{4}-\d{2}-\d{2}\.json"/
    );

    const body = await res.json();
    expect(body.user_id).toBe(EXPORT_USER_ID);
    expect(body.email).toBe(EXPORT_USER_EMAIL);
    expect(body.profile.current_consent_version).toBe(CONSENT_VERSION);

    // Consent log: exactly 3 rows (terms_of_service / privacy_policy / cookies),
    // ordered by accepted_at DESC. Seeded timestamps make this deterministic.
    expect(body.consent_log).toHaveLength(3);
    expect(body.consent_log.map((r: { consent_type: string }) => r.consent_type)).toEqual([
      'terms_of_service',
      'privacy_policy',
      'cookies'
    ]);

    // Column-level minimisation — plan §6. The projection MUST NOT leak
    // ip_address (INET, privacy-sensitive) or user_agent (audit-only) or
    // id/user_id (not user-visible). Asserting on every row guards against
    // a partial projection regression.
    for (const row of body.consent_log) {
      expect(Object.keys(row).sort()).toEqual([
        'accepted',
        'accepted_at',
        'consent_type',
        'version'
      ]);
    }
  });

  test('brak sesji → 401 unauthorized', async ({ request }) => {
    // Fresh request context inherits zeroed cookies from beforeEach clearCookies.
    const res = await request.get('/api/user/export');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });
});
