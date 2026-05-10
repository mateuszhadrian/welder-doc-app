import { describe, expect, it } from 'vitest';
import { isUuid } from './uuid';

describe('isUuid', () => {
  it('accepts a canonical lowercase v4 UUID', () => {
    expect(isUuid('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true);
  });

  it('accepts a real gen_random_uuid()-style v4', () => {
    expect(isUuid('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  it('accepts an uppercase UUID (case-insensitive)', () => {
    expect(isUuid('F47AC10B-58CC-4372-A567-0E02B2C3D479')).toBe(true);
  });

  it('accepts the nil UUID', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isUuid('')).toBe(false);
  });

  it('rejects a UUID without hyphens', () => {
    expect(isUuid('f47ac10b58cc4372a5670e02b2c3d479')).toBe(false);
  });

  it('rejects a UUID with non-hex characters', () => {
    expect(isUuid('zzzzzzzz-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(false);
  });

  it('rejects a UUID with the wrong segment length', () => {
    expect(isUuid('aaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(false); // 7 chars in segment 1
  });

  it('rejects free-form strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('123')).toBe(false);
  });

  it('rejects strings with leading or trailing whitespace', () => {
    // Anchored regex — paths are passed straight from URL params and we want
    // an exact match; trim is the caller's job if they want to be lenient.
    expect(isUuid(' aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(false);
    expect(isUuid('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee ')).toBe(false);
  });
});
