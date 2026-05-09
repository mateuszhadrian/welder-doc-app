import { describe, expect, it } from 'vitest';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isValidEmail,
  isValidPassword
} from './validation';

describe('isValidEmail', () => {
  it('akceptuje typowy adres', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('akceptuje subdomeny i plus-tagi', () => {
    expect(isValidEmail('user.name+tag@sub.example.co.uk')).toBe(true);
  });

  it('przycina białe znaki przed walidacją', () => {
    expect(isValidEmail('  user@example.com  ')).toBe(true);
  });

  it('odrzuca brak znaku @', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('odrzuca brak domeny po @', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('odrzuca brak TLD (kropki)', () => {
    expect(isValidEmail('user@example')).toBe(false);
  });

  it('odrzuca biały znak w środku', () => {
    expect(isValidEmail('us er@example.com')).toBe(false);
  });

  it('odrzuca pusty / sam whitespace string', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
  });

  it('odrzuca adres przekraczający limit RFC 5321 (254 znaki)', () => {
    const local = 'a'.repeat(245);
    const tooLong = `${local}@example.com`;
    expect(tooLong.length).toBeGreaterThan(EMAIL_MAX_LENGTH);
    expect(isValidEmail(tooLong)).toBe(false);
  });
});

describe('isValidPassword', () => {
  it('akceptuje hasło o dokładnie 8 znakach', () => {
    expect(isValidPassword('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });

  it('akceptuje hasło o dokładnie 72 znakach (bcrypt limit)', () => {
    expect(isValidPassword('a'.repeat(PASSWORD_MAX_LENGTH))).toBe(true);
  });

  it('odrzuca hasło 7-znakowe', () => {
    expect(isValidPassword('a'.repeat(7))).toBe(false);
  });

  it('odrzuca hasło 73-znakowe', () => {
    expect(isValidPassword('a'.repeat(73))).toBe(false);
  });

  it('odrzuca pusty string', () => {
    expect(isValidPassword('')).toBe(false);
  });
});
