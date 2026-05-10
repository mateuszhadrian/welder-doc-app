import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';
import enMessages from '@/messages/en.json';

const { resetPasswordForEmailMock } = vi.hoisted(() => ({
  resetPasswordForEmailMock: vi.fn()
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: resetPasswordForEmailMock
    }
  })
}));

import { ForgotPasswordForm } from './ForgotPasswordForm';

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function renderForm(locale: 'pl' | 'en' = 'pl') {
  const messages = locale === 'pl' ? plMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ForgotPasswordForm locale={locale} />
    </NextIntlClientProvider>
  );
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://welder.test';
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  });

  it('renderuje pole email + przycisk submit + link powrotu', () => {
    renderForm();
    expect(screen.getByLabelText(plMessages.auth.forgotPassword.email_label)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: plMessages.auth.forgotPassword.back_to_login })
    ).toHaveAttribute('href', '/login');
  });

  it('blokuje submit i pokazuje błąd dla niepoprawnego formatu email', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(
      screen.getByLabelText(plMessages.auth.forgotPassword.email_label),
      'not-an-email'
    );
    await user.click(screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.invalid_email_format
    );
    expect(resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it('na sukcesie pokazuje generic sent message i ukrywa formularz', async () => {
    const user = userEvent.setup();
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.forgotPassword.email_label), 'a@b.com');
    await user.click(screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      plMessages.auth.forgotPassword.sent_generic
    );
    expect(
      screen.queryByRole('button', { name: plMessages.auth.forgotPassword.submit })
    ).not.toBeInTheDocument();
  });

  it('buduje redirectTo z buildLocalePath dla locale=pl (callback bez prefixu, next bez prefixu)', async () => {
    const user = userEvent.setup();
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    renderForm('pl');

    await user.type(screen.getByLabelText(plMessages.auth.forgotPassword.email_label), 'a@b.com');
    await user.click(screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit }));

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalled());
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith('a@b.com', {
      redirectTo: `https://welder.test/auth/callback?next=${encodeURIComponent('/reset-password')}`
    });
  });

  it('buduje redirectTo z buildLocalePath dla locale=en (callback i next z prefixem /en)', async () => {
    const user = userEvent.setup();
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    renderForm('en');

    await user.type(screen.getByLabelText(enMessages.auth.forgotPassword.email_label), 'a@b.com');
    await user.click(screen.getByRole('button', { name: enMessages.auth.forgotPassword.submit }));

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalled());
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith('a@b.com', {
      redirectTo: `https://welder.test/en/auth/callback?next=${encodeURIComponent('/en/reset-password')}`
    });
  });

  it('przy RATE_LIMITED (429) pokazuje błąd, NIE pokazuje sent message (per-IP, nie per-email)', async () => {
    const user = userEvent.setup();
    resetPasswordForEmailMock.mockResolvedValue({
      data: null,
      error: { name: 'AuthApiError', message: 'Email rate limit exceeded', status: 429 }
    });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.forgotPassword.email_label), 'a@b.com');
    await user.click(screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.rate_limited);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('przy AuthRetryableFetchError (network) pokazuje network_error, NIE silent-success', async () => {
    const user = userEvent.setup();
    resetPasswordForEmailMock.mockResolvedValue({
      data: null,
      error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }
    });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.forgotPassword.email_label), 'a@b.com');
    await user.click(screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.network_error);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('anti-enumeration: 422 invalid_email z GoTrue też pokazuje sent message (silent success)', async () => {
    const user = userEvent.setup();
    // GoTrue 422 (np. email_address_invalid) NIE może ujawniać czy email
    // jest w bazie — UI pokazuje ten sam komunikat co przy realnym wysłaniu.
    resetPasswordForEmailMock.mockResolvedValue({
      data: null,
      error: { name: 'AuthApiError', message: 'Email address invalid', status: 422 }
    });
    renderForm();

    await user.type(screen.getByLabelText(plMessages.auth.forgotPassword.email_label), 'a@b.com');
    await user.click(screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      plMessages.auth.forgotPassword.sent_generic
    );
  });

  it('trim-uje email przed wysłaniem do supabase', async () => {
    const user = userEvent.setup();
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    renderForm();

    await user.type(
      screen.getByLabelText(plMessages.auth.forgotPassword.email_label),
      '  a@b.com  '
    );
    await user.click(screen.getByRole('button', { name: plMessages.auth.forgotPassword.submit }));

    await waitFor(() => expect(resetPasswordForEmailMock).toHaveBeenCalled());
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith('a@b.com', expect.anything());
  });
});
