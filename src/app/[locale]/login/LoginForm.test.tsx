import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';

const { searchParamsGetMock, signInWithPasswordMock, resendMock, migrateMock, toastMock } =
  vi.hoisted(() => ({
    searchParamsGetMock: vi.fn().mockReturnValue(null),
    signInWithPasswordMock: vi.fn(),
    resendMock: vi.fn(),
    migrateMock: vi.fn(),
    toastMock: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn()
    }
  }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: searchParamsGetMock })
}));

const locationAssignMock = vi.fn();
const originalLocation = window.location;
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...originalLocation, assign: locationAssignMock }
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      resend: resendMock
    }
  })
}));

vi.mock('@/lib/autosave/migrateGuestAutosave', () => ({
  migrateGuestAutosave: migrateMock
}));

vi.mock('sonner', () => ({ toast: toastMock }));

import { LoginForm } from './LoginForm';

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages}>
      <LoginForm locale="pl" />
    </NextIntlClientProvider>
  );
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsGetMock.mockReturnValue(null);
    migrateMock.mockResolvedValue({ migrated: false, reason: 'no_autosave' });
  });

  it('renderuje pola email i hasło + przycisk submit', () => {
    renderForm();
    expect(screen.getByLabelText(plMessages.auth.login.email_label)).toBeInTheDocument();
    expect(screen.getByLabelText(plMessages.auth.login.password_label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: plMessages.auth.login.submit })).toBeInTheDocument();
  });

  it('blokuje submit i pokazuje błąd dla niepoprawnego formatu email', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.login.email_label), 'not-an-email');
    await user.type(screen.getByLabelText(plMessages.auth.login.password_label), 'pass1234');
    await user.click(screen.getByRole('button', { name: plMessages.auth.login.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.invalid_email_format
    );
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it('blokuje submit i pokazuje błąd dla pustego hasła', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.login.email_label), 'a@b.com');
    await user.click(screen.getByRole('button', { name: plMessages.auth.login.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.password_required);
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it('mapuje INVALID_CREDENTIALS na klucz errors.invalid_credentials', async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'Invalid login credentials', status: 400 }
    });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.login.email_label), 'a@b.com');
    await user.type(screen.getByLabelText(plMessages.auth.login.password_label), 'badpass');
    await user.click(screen.getByRole('button', { name: plMessages.auth.login.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.invalid_credentials
    );
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('pokazuje resend button przy EMAIL_NOT_CONFIRMED', async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'Email not confirmed', status: 400 }
    });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.login.email_label), 'a@b.com');
    await user.type(screen.getByLabelText(plMessages.auth.login.password_label), 'pass');
    await user.click(screen.getByRole('button', { name: plMessages.auth.login.submit }));

    expect(
      await screen.findByRole('button', { name: plMessages.auth.login.resend_verification })
    ).toBeInTheDocument();
  });

  it('na sukcesie woła migrateGuestAutosave i przekierowuje', async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null
    });
    migrateMock.mockResolvedValue({ migrated: true });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.login.email_label), 'a@b.com');
    await user.type(screen.getByLabelText(plMessages.auth.login.password_label), 'pass');
    await user.click(screen.getByRole('button', { name: plMessages.auth.login.submit }));

    // Default locale (pl) → canonical URL has no prefix (`/`).
    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith('/'));
    expect(migrateMock).toHaveBeenCalledWith(
      expect.anything(),
      plMessages.documents.untitled_default
    );
    expect(toastMock.success).toHaveBeenCalledWith(plMessages.toasts.guest_migrated);
  });

  it('honoruje query param ?next=... przy redirect', async () => {
    const user = userEvent.setup();
    searchParamsGetMock.mockReturnValue('/pl/dashboard');
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null
    });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.login.email_label), 'a@b.com');
    await user.type(screen.getByLabelText(plMessages.auth.login.password_label), 'pass');
    await user.click(screen.getByRole('button', { name: plMessages.auth.login.submit }));

    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith('/pl/dashboard'));
  });

  it('pokazuje toast.warning gdy migracja zwróci project_limit', async () => {
    const user = userEvent.setup();
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null
    });
    migrateMock.mockResolvedValue({ migrated: false, reason: 'project_limit' });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.login.email_label), 'a@b.com');
    await user.type(screen.getByLabelText(plMessages.auth.login.password_label), 'pass');
    await user.click(screen.getByRole('button', { name: plMessages.auth.login.submit }));

    await waitFor(() =>
      expect(toastMock.warning).toHaveBeenCalledWith(plMessages.toasts.guest_migration_limit)
    );
  });
});
