import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';

const { updateUserMock } = vi.hoisted(() => ({
  updateUserMock: vi.fn()
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      updateUser: updateUserMock
    }
  })
}));

import { UpdatePasswordForm } from './UpdatePasswordForm';

function renderForm(props: Parameters<typeof UpdatePasswordForm>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages}>
      <UpdatePasswordForm {...props} />
    </NextIntlClientProvider>
  );
}

async function fillBoth(user: ReturnType<typeof userEvent.setup>, p1: string, p2: string) {
  await user.type(screen.getByLabelText(plMessages.auth.resetPassword.password_label), p1);
  await user.type(screen.getByLabelText(plMessages.auth.resetPassword.password_confirm_label), p2);
}

describe('UpdatePasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderuje oba pola hasła + przycisk submit', () => {
    renderForm();
    expect(screen.getByLabelText(plMessages.auth.resetPassword.password_label)).toBeInTheDocument();
    expect(
      screen.getByLabelText(plMessages.auth.resetPassword.password_confirm_label)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: plMessages.auth.resetPassword.submit })
    ).toBeInTheDocument();
  });

  it('na sukcesie woła onSuccess i nie renderuje błędu', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    updateUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    renderForm({ onSuccess });

    await fillBoth(user, 'newpass123', 'newpass123');
    await user.click(screen.getByRole('button', { name: plMessages.auth.resetPassword.submit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(updateUserMock).toHaveBeenCalledWith({ password: 'newpass123' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mapuje słabe hasło z GoTrue na alert errors.password_too_weak', async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({
      data: { user: null },
      error: {
        name: 'AuthApiError',
        message: 'Password should be at least 8 characters',
        status: 422
      }
    });
    renderForm();

    await fillBoth(user, 'shortpw1', 'shortpw1'); // ≥ 8 chars to pass preflight
    await user.click(screen.getByRole('button', { name: plMessages.auth.resetPassword.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.password_too_weak);
  });

  it('na "Auth session missing" woła onSessionMissing', async () => {
    const user = userEvent.setup();
    const onSessionMissing = vi.fn();
    updateUserMock.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 401 }
    });
    renderForm({ onSessionMissing });

    await fillBoth(user, 'newpass123', 'newpass123');
    await user.click(screen.getByRole('button', { name: plMessages.auth.resetPassword.submit }));

    await waitFor(() => expect(onSessionMissing).toHaveBeenCalledTimes(1));
  });

  it('walidacja klienta: niepasujące hasła → inline error, SDK nie wywołane', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillBoth(user, 'newpass123', 'differentpw');
    await user.click(screen.getByRole('button', { name: plMessages.auth.resetPassword.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.password_mismatch);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('walidacja klienta: hasło < 8 znaków → inline error, SDK nie wywołane', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillBoth(user, 'short', 'short');
    await user.click(screen.getByRole('button', { name: plMessages.auth.resetPassword.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.password_too_short
    );
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('mapuje AuthRetryableFetchError na errors.network_error', async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }
    });
    renderForm();

    await fillBoth(user, 'newpass123', 'newpass123');
    await user.click(screen.getByRole('button', { name: plMessages.auth.resetPassword.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.network_error);
  });
});
