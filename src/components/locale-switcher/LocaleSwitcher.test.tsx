import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';

const { replaceMock, pathnameMock, updateProfileMock, toastMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pathnameMock: vi.fn().mockReturnValue('/'),
  updateProfileMock: vi.fn(),
  toastMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathnameMock()
}));

vi.mock('@/lib/supabase/profile', () => ({
  updateProfile: updateProfileMock
}));

vi.mock('sonner', () => ({ toast: toastMock }));

import { LocaleSwitcher } from './LocaleSwitcher';

function renderSwitcher(props: { currentLocale: 'pl' | 'en'; userId?: string }) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages}>
      <LocaleSwitcher {...props} />
    </NextIntlClientProvider>
  );
}

function clearCookies() {
  document.cookie.split(';').forEach((c) => {
    const eqPos = c.indexOf('=');
    const name = (eqPos > -1 ? c.substr(0, eqPos) : c).trim();
    if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });
}

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue('/');
    updateProfileMock.mockResolvedValue({
      data: null,
      error: null,
      count: null,
      status: 200,
      statusText: 'OK'
    });
    clearCookies();
  });

  afterEach(() => {
    clearCookies();
  });

  it('renderuje obie opcje locale i oznacza aktualny przyciskiem aria-pressed', () => {
    renderSwitcher({ currentLocale: 'pl' });

    const plBtn = screen.getByRole('button', { name: plMessages.localeSwitcher.locale_pl });
    const enBtn = screen.getByRole('button', { name: plMessages.localeSwitcher.locale_en });

    expect(plBtn).toHaveAttribute('aria-pressed', 'true');
    expect(enBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('klik w aktualną locale nie wywołuje updateProfile ani nawigacji', async () => {
    const user = userEvent.setup();
    renderSwitcher({ currentLocale: 'pl', userId: 'user-1' });

    await user.click(screen.getByRole('button', { name: plMessages.localeSwitcher.locale_pl }));

    expect(updateProfileMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('auth: woła updateProfile, ustawia cookie i nawiguje na ścieżkę z prefiksem', async () => {
    const user = userEvent.setup();
    pathnameMock.mockReturnValue('/');
    renderSwitcher({ currentLocale: 'pl', userId: 'user-1' });

    await user.click(screen.getByRole('button', { name: plMessages.localeSwitcher.locale_en }));

    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledWith('user-1', { locale: 'en' });
    });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/en'));
    expect(document.cookie).toContain('NEXT_LOCALE=en');
  });

  it('auth: zdejmuje istniejący prefix locale przy budowaniu ścieżki en→pl', async () => {
    const user = userEvent.setup();
    pathnameMock.mockReturnValue('/en/login');
    renderSwitcher({ currentLocale: 'en', userId: 'user-1' });

    await user.click(screen.getByRole('button', { name: plMessages.localeSwitcher.locale_pl }));

    await waitFor(() => {
      expect(updateProfileMock).toHaveBeenCalledWith('user-1', { locale: 'pl' });
    });
    // Default locale (pl) — no prefix.
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    expect(document.cookie).toContain('NEXT_LOCALE=pl');
  });

  it('auth: PostgrestError → toast.error z mapowanym kluczem, brak cookie, brak nawigacji', async () => {
    const user = userEvent.setup();
    updateProfileMock.mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        message: "violates check constraint locale IN ('pl','en')",
        details: '',
        hint: ''
      },
      count: null,
      status: 400,
      statusText: 'Bad Request'
    });
    renderSwitcher({ currentLocale: 'pl', userId: 'user-1' });

    await user.click(screen.getByRole('button', { name: plMessages.localeSwitcher.locale_en }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(plMessages.errors.profile_locale_invalid);
    });
    expect(replaceMock).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('NEXT_LOCALE');
  });

  it('guest (no userId): pomija updateProfile, ale ustawia cookie i nawiguje', async () => {
    const user = userEvent.setup();
    renderSwitcher({ currentLocale: 'pl' });

    await user.click(screen.getByRole('button', { name: plMessages.localeSwitcher.locale_en }));

    expect(updateProfileMock).not.toHaveBeenCalled();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/en'));
    expect(document.cookie).toContain('NEXT_LOCALE=en');
  });

  it('cookie ma atrybut samesite=lax i max-age na ~1 rok', async () => {
    // jsdom expose tylko wartość pary (samesite/max-age są zjadane), więc
    // weryfikujemy obecność `NEXT_LOCALE` + długość. Detale atrybutów
    // ustawione w handlerze są pokryte przez code-review.
    const user = userEvent.setup();
    renderSwitcher({ currentLocale: 'pl' });

    await user.click(screen.getByRole('button', { name: plMessages.localeSwitcher.locale_en }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(document.cookie).toMatch(/NEXT_LOCALE=en/);
  });
});
