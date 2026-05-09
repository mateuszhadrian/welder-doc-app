import { describe, expect, it } from 'vitest';
import { CURRENT_TOS_VERSION } from './version';

describe('CURRENT_TOS_VERSION', () => {
  it('is an ISO date string (YYYY-MM-DD) — guards lex-comparison contract', () => {
    expect(CURRENT_TOS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
