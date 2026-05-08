import { describe, expect, it } from 'vitest';
import { anonymizeIp, pickForwardedFor } from './ipAnonymize';

describe('anonymizeIp', () => {
  it('zeruje ostatni oktet IPv4 (/24)', () => {
    expect(anonymizeIp('192.168.1.42')).toBe('192.168.1.0');
    expect(anonymizeIp('10.0.0.255')).toBe('10.0.0.0');
  });

  it('zeruje ostatnie 80 bitów IPv6 (/48)', () => {
    expect(anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3:0:0:0:0:0');
    expect(anonymizeIp('2001:db8:85a3::')).toBe('2001:db8:85a3:0:0:0:0:0');
    expect(anonymizeIp('::1')).toBe('0:0:0:0:0:0:0:0');
  });

  it('zwraca null dla pustych / null / nie-IP wejść', () => {
    expect(anonymizeIp(null)).toBeNull();
    expect(anonymizeIp(undefined)).toBeNull();
    expect(anonymizeIp('')).toBeNull();
    expect(anonymizeIp('not-an-ip')).toBeNull();
    expect(anonymizeIp('999.999.999.999')).toBeNull();
    expect(anonymizeIp('192.168.1')).toBeNull();
    expect(anonymizeIp('2001:::1')).toBeNull();
  });

  it('przycina spacje', () => {
    expect(anonymizeIp('  192.168.1.42  ')).toBe('192.168.1.0');
  });
});

describe('pickForwardedFor', () => {
  it('zwraca pierwszy adres', () => {
    expect(pickForwardedFor('203.0.113.5, 198.51.100.7, 192.0.2.1')).toBe('203.0.113.5');
  });

  it('zwraca null dla pustego nagłówka', () => {
    expect(pickForwardedFor(null)).toBeNull();
    expect(pickForwardedFor('')).toBeNull();
    expect(pickForwardedFor('   ')).toBeNull();
  });
});
