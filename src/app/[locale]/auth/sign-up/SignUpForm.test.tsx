import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';
import { BusinessError } from '@/lib/supabase/errors';

const { registerUserMock } = vi.hoisted(() => ({
  registerUserMock: vi.fn()
}));

vi.mock('@/lib/auth/registration', () => ({
  registerUser: registerUserMock
}));

const locationAssignMock = vi.fn();
const originalLocation = window.location;
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...originalLocation, assign: locationAssignMock }
});

import { SignUpForm } from './SignUpForm';

const CONSENT_VERSION = '2026-05-01';
const VALID_EMAIL = 'new-user@example.com';
const VALID_PASSWORD = 'StrongPass123';

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages}>
      <SignUpForm locale="pl" consentVersion={CONSENT_VERSION} />
    </NextIntlClientProvider>
  );
}

async function fillCredentials(
  user: ReturnType<typeof userEvent.setup>,
  email = VALID_EMAIL,
  password = VALID_PASSWORD
) {
  await user.type(screen.getByLabelText(plMessages.auth.signUp.email_label), email);
  await user.type(screen.getByLabelText(plMessages.auth.signUp.password_label), password);
}

async function checkAllConsents(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(plMessages.auth.signUp.consent_tos_label));
  await user.click(screen.getByLabelText(plMessages.auth.signUp.consent_pp_label));
  await user.click(screen.getByLabelText(plMessages.auth.signUp.consent_cookies_label));
}

function clickSubmit(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: plMessages.auth.signUp.submit }));
}

describe('SignUpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderuje pola email/password, 3 checkboxy zgód i przycisk submit', () => {
    renderForm();
    expect(screen.getByLabelText(plMessages.auth.signUp.email_label)).toBeInTheDocument();
    expect(screen.getByLabelText(plMessages.auth.signUp.password_label)).toBeInTheDocument();
    expect(screen.getByLabelText(plMessages.auth.signUp.consent_tos_label)).toBeInTheDocument();
    expect(screen.getByLabelText(plMessages.auth.signUp.consent_pp_label)).toBeInTheDocument();
    expect(screen.getByLabelText(plMessages.auth.signUp.consent_cookies_label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: plMessages.auth.signUp.submit })).toBeInTheDocument();
  });

  it('blokuje submit i pokazuje błąd dla niepoprawnego formatu email', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillCredentials(user, 'not-an-email', VALID_PASSWORD);
    await checkAllConsents(user);
    await clickSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.invalid_email_format
    );
    expect(registerUserMock).not.toHaveBeenCalled();
  });

  it('blokuje submit i pokazuje błąd dla zbyt krótkiego hasła', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillCredentials(user, VALID_EMAIL, '1234567');
    await checkAllConsents(user);
    await clickSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.password_too_short
    );
    expect(registerUserMock).not.toHaveBeenCalled();
  });

  it('blokuje submit i pokazuje consent_required gdy choć jeden checkbox jest odznaczony', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillCredentials(user);
    // Tylko 2 z 3 zaznaczone.
    await user.click(screen.getByLabelText(plMessages.auth.signUp.consent_tos_label));
    await user.click(screen.getByLabelText(plMessages.auth.signUp.consent_pp_label));
    await clickSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.consent_required);
    expect(registerUserMock).not.toHaveBeenCalled();
  });

  it('na sukcesie woła registerUser z bundle zgód i przekierowuje na /auth/check-email', async () => {
    const user = userEvent.setup();
    registerUserMock.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: VALID_EMAIL },
      session: null,
      consentDeferred: true
    });
    renderForm();

    await fillCredentials(user);
    await checkAllConsents(user);
    await clickSubmit(user);

    await waitFor(() => expect(registerUserMock).toHaveBeenCalledTimes(1));
    expect(registerUserMock).toHaveBeenCalledWith({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
      consent: {
        types: ['terms_of_service', 'privacy_policy', 'cookies'],
        version: CONSENT_VERSION,
        accepted: true
      }
    });
    await waitFor(() =>
      expect(locationAssignMock).toHaveBeenCalledWith(
        `/auth/check-email?email=${encodeURIComponent(VALID_EMAIL)}`
      )
    );
  });

  it('mapuje EMAIL_ALREADY_REGISTERED na alert z linkiem "Zaloguj się"', async () => {
    const user = userEvent.setup();
    registerUserMock.mockResolvedValue({
      ok: false,
      step: 'signup',
      error: {
        business: BusinessError.EMAIL_ALREADY_REGISTERED,
        message: 'errors.email_already_registered'
      }
    });
    renderForm();

    await fillCredentials(user);
    await checkAllConsents(user);
    await clickSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(plMessages.errors.email_already_registered);
    // CTA "Zaloguj się" pojawia się TYLKO wewnątrz alertu przy EMAIL_ALREADY_REGISTERED.
    // Stały link u dołu formularza ma tę samą treść, więc scope'ujemy do alertu.
    const cta = within(alert).getByRole('link', {
      name: plMessages.auth.signUp.already_registered_cta
    });
    expect(cta).toHaveAttribute('href', '/login');
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('mapuje RATE_LIMITED na errors.rate_limited bez linku do logowania', async () => {
    const user = userEvent.setup();
    registerUserMock.mockResolvedValue({
      ok: false,
      step: 'signup',
      error: { business: BusinessError.RATE_LIMITED, message: 'errors.rate_limited' }
    });
    renderForm();

    await fillCredentials(user);
    await checkAllConsents(user);
    await clickSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(plMessages.errors.rate_limited);
    // Brak linka CTA wewnątrz alertu — stały link u dołu formularza nas nie interesuje.
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument();
  });

  it('przekierowuje z prefiksem locale dla EN', async () => {
    const user = userEvent.setup();
    registerUserMock.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: VALID_EMAIL },
      session: null,
      consentDeferred: true
    });
    render(
      <NextIntlClientProvider locale="pl" messages={plMessages}>
        <SignUpForm locale="en" consentVersion={CONSENT_VERSION} />
      </NextIntlClientProvider>
    );

    await fillCredentials(user);
    await checkAllConsents(user);
    await clickSubmit(user);

    await waitFor(() =>
      expect(locationAssignMock).toHaveBeenCalledWith(
        `/en/auth/check-email?email=${encodeURIComponent(VALID_EMAIL)}`
      )
    );
  });
});
