/**
 * RODO motyw 30: anonimizacja IP przed zapisem do `consent_log.ip_address`.
 *
 * - IPv4 → wyzeruj ostatni oktet (`/24`).
 * - IPv6 → wyzeruj ostatnie 80 bitów (`/48`).
 *
 * Funkcja jest pure: nie czyta nagłówków, nie sięga do procesu. Wywołujący
 * (Route Handler) wybiera adres źródłowy z `x-forwarded-for` / `x-real-ip`
 * i przekazuje string. Zwraca string w formacie akceptowanym przez Postgres
 * `INET` lub `null` gdy wejście nie jest poprawnym IP.
 */

export function anonymizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ip = raw.trim();
  if (!ip) return null;

  if (ip.includes('.') && !ip.includes(':')) {
    return anonymizeIPv4(ip);
  }

  if (ip.includes(':')) {
    return anonymizeIPv6(ip);
  }

  return null;
}

/**
 * Wyodrębnia pierwszy adres z nagłówka `x-forwarded-for`
 * (`client, proxy1, proxy2`). Zwraca `null` gdy brak wartości.
 */
export function pickForwardedFor(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(',')[0]?.trim();
  return first ? first : null;
}

function anonymizeIPv4(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  }

  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

function anonymizeIPv6(ip: string): string | null {
  // Ekspansja `::` do pełnych 8 grup. Postgres `INET` akceptuje też formę
  // skróconą, ale operujemy na pełnej, by jednoznacznie wyzerować bity 49–128.
  const expanded = expandIPv6(ip);
  if (!expanded) return null;

  // Zachowujemy pierwsze 3 grupy (48 bitów = `/48`), reszta = 0.
  const head = expanded.slice(0, 3);
  return [...head, '0', '0', '0', '0', '0'].join(':');
}

function expandIPv6(ip: string): string[] | null {
  const lower = ip.toLowerCase();

  // Niedozwolone: więcej niż jedno `::`.
  const doubleColonCount = (lower.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (lower.includes('::')) {
    const [left, right] = lower.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const fillCount = 8 - leftGroups.length - rightGroups.length;
    if (fillCount < 0) return null;
    groups = [...leftGroups, ...Array.from({ length: fillCount }, () => '0'), ...rightGroups];
  } else {
    groups = lower.split(':');
  }

  if (groups.length !== 8) return null;

  for (const group of groups) {
    if (group.length === 0 || group.length > 4) return null;
    if (!/^[0-9a-f]+$/.test(group)) return null;
  }

  return groups;
}
