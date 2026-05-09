import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';

const { fetchMock, locationAssignMock, toastMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  locationAssignMock: vi.fn(),
  toastMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}));

vi.stubGlobal('fetch', fetchMock);

const originalLocation = window.location;
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...originalLocation, assign: locationAssignMock }
});

vi.mock('sonner', () => ({ toast: toastMock }));

import { DeleteAccountForm } from './DeleteAccountForm';

const EMAIL = 'me@test.local';

function renderForm(props?: Partial<React.ComponentProps<typeof DeleteAccountForm>>) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages}>
      <DeleteAccountForm email={EMAIL} locale="pl" {...props} />
    </NextIntlClientProvider>
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DeleteAccountForm', () => {
  it('renderuje email read-only i tytuły pól', () => {
    renderForm();
    const emailInput = screen.getByLabelText(
      plMessages.account.delete.email_label
    ) as HTMLInputElement;
    expect(emailInput.value).toBe(EMAIL);
    expect(emailInput).toBeDisabled();
    expect(screen.getByLabelText(plMessages.account.delete.password_label)).toBeInTheDocument();
    expect(screen.getByLabelText(plMessages.account.delete.confirmation_label)).toBeInTheDocument();
  });

  it('submit jest disabled gdy hasło puste', () => {
    renderForm();
    const btn = screen.getByRole('button', { name: plMessages.account.delete.submit });
    expect(btn).toBeDisabled();
  });

  it('submit jest disabled gdy confirmation != "DELETE"', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(plMessages.account.delete.password_label), 'pw');
    await user.type(screen.getByLabelText(plMessages.account.delete.confirmation_label), 'delete');
    expect(screen.getByRole('button', { name: plMessages.account.delete.submit })).toBeDisabled();
  });

  it('submit jest enabled gdy hasło + confirmation === "DELETE"', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(plMessages.account.delete.password_label), 'pw');
    await user.type(screen.getByLabelText(plMessages.account.delete.confirmation_label), 'DELETE');
    expect(screen.getByRole('button', { name: plMessages.account.delete.submit })).toBeEnabled();
  });

  it('200 happy path: woła fetch z poprawnym body i robi window.location.assign na /account-deleted (pl default)', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { deleted: true, user_id: 'u-1', deleted_at: '2026-05-09T00:00:00Z' })
    );

    renderForm();
    await user.type(screen.getByLabelText(plMessages.account.delete.password_label), 'pw');
    await user.type(screen.getByLabelText(plMessages.account.delete.confirmation_label), 'DELETE');
    await user.click(screen.getByRole('button', { name: plMessages.account.delete.submit }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/user/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'pw', confirmation: 'DELETE' })
      });
    });
    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith('/account-deleted'));
  });

  it('200 happy path: dodaje prefix locale dla en', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { deleted: true, user_id: 'u-1', deleted_at: '2026-05-09T00:00:00Z' })
    );

    renderForm({ locale: 'en' });
    await user.type(screen.getByLabelText(plMessages.account.delete.password_label), 'pw');
    await user.type(screen.getByLabelText(plMessages.account.delete.confirmation_label), 'DELETE');
    await user.click(screen.getByRole('button', { name: plMessages.account.delete.submit }));

    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith('/en/account-deleted'));
  });

  it('401 invalid_password → toast.error z mapowanym kluczem, brak nawigacji', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'invalid_password' }));

    renderForm();
    await user.type(screen.getByLabelText(plMessages.account.delete.password_label), 'badpw');
    await user.type(screen.getByLabelText(plMessages.account.delete.confirmation_label), 'DELETE');
    await user.click(screen.getByRole('button', { name: plMessages.account.delete.submit }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(plMessages.errors.invalid_password);
    });
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('429 rate_limited → toast.error z errors.rate_limited', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'rate_limited' }));

    renderForm();
    await user.type(screen.getByLabelText(plMessages.account.delete.password_label), 'pw');
    await user.type(screen.getByLabelText(plMessages.account.delete.confirmation_label), 'DELETE');
    await user.click(screen.getByRole('button', { name: plMessages.account.delete.submit }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(plMessages.errors.rate_limited);
    });
  });

  it('network failure (fetch reject) → toast.error z errors.network_error', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderForm();
    await user.type(screen.getByLabelText(plMessages.account.delete.password_label), 'pw');
    await user.type(screen.getByLabelText(plMessages.account.delete.confirmation_label), 'DELETE');
    await user.click(screen.getByRole('button', { name: plMessages.account.delete.submit }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(plMessages.errors.network_error);
    });
    expect(locationAssignMock).not.toHaveBeenCalled();
  });
});
