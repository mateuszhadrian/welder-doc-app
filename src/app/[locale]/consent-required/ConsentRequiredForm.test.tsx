import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';
import enMessages from '@/messages/en.json';

import { ConsentRequiredForm } from './ConsentRequiredForm';

const CONSENT_VERSION = '2026-05-01';

const locationAssignMock = vi.fn();
const originalLocation = window.location;
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...originalLocation, assign: locationAssignMock }
});

const originalFetch = globalThis.fetch;

function renderForm(locale: 'pl' | 'en' = 'pl') {
  const messages = locale === 'pl' ? plMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ConsentRequiredForm locale={locale} consentVersion={CONSENT_VERSION} />
    </NextIntlClientProvider>
  );
}

describe('ConsentRequiredForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renderuje 2 checkboxy zgód i przycisk submit (disabled)', () => {
    renderForm();
    expect(screen.getByLabelText(plMessages.auth.consent.tos_label)).toBeInTheDocument();
    expect(screen.getByLabelText(plMessages.auth.consent.pp_label)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: plMessages.auth.consent.submit });
    expect(button).toBeDisabled();
  });

  it('przycisk pozostaje disabled gdy tylko 1 z 2 checkboxów jest zaznaczony', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByLabelText(plMessages.auth.consent.tos_label));
    expect(screen.getByRole('button', { name: plMessages.auth.consent.submit })).toBeDisabled();
  });

  it('na sukcesie POST-uje bundle zgód i przekierowuje na / (locale=pl)', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderForm('pl');
    await user.click(screen.getByLabelText(plMessages.auth.consent.tos_label));
    await user.click(screen.getByLabelText(plMessages.auth.consent.pp_label));
    await user.click(screen.getByRole('button', { name: plMessages.auth.consent.submit }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        types: ['terms_of_service', 'privacy_policy'],
        version: CONSENT_VERSION,
        accepted: true
      })
    });
    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith('/'));
  });

  it('przekierowuje z prefiksem /en dla locale=en', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderForm('en');
    await user.click(screen.getByLabelText(enMessages.auth.consent.tos_label));
    await user.click(screen.getByLabelText(enMessages.auth.consent.pp_label));
    await user.click(screen.getByRole('button', { name: enMessages.auth.consent.submit }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(locationAssignMock).toHaveBeenCalledWith('/en'));
  });

  it('przy 4xx z envelope { error } pokazuje zmapowany komunikat i ponownie aktywuje przycisk', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_payload' })
    }) as unknown as typeof fetch;

    renderForm();
    await user.click(screen.getByLabelText(plMessages.auth.consent.tos_label));
    await user.click(screen.getByLabelText(plMessages.auth.consent.pp_label));
    await user.click(screen.getByRole('button', { name: plMessages.auth.consent.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.invalid_payload);
    expect(screen.getByRole('button', { name: plMessages.auth.consent.submit })).not.toBeDisabled();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it('przy 401 unauthorized pokazuje errors.unauthorized', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'unauthorized' })
    }) as unknown as typeof fetch;

    renderForm();
    await user.click(screen.getByLabelText(plMessages.auth.consent.tos_label));
    await user.click(screen.getByLabelText(plMessages.auth.consent.pp_label));
    await user.click(screen.getByRole('button', { name: plMessages.auth.consent.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.unauthorized);
  });

  it('przy nieznanym kodzie błędu (brak tłumaczenia) fall-back na errors.unknown', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'completely_unmapped_code' })
    }) as unknown as typeof fetch;

    renderForm();
    await user.click(screen.getByLabelText(plMessages.auth.consent.tos_label));
    await user.click(screen.getByLabelText(plMessages.auth.consent.pp_label));
    await user.click(screen.getByRole('button', { name: plMessages.auth.consent.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.unknown);
  });

  it('przy network error (fetch throw) pokazuje errors.network_error', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    renderForm();
    await user.click(screen.getByLabelText(plMessages.auth.consent.tos_label));
    await user.click(screen.getByLabelText(plMessages.auth.consent.pp_label));
    await user.click(screen.getByRole('button', { name: plMessages.auth.consent.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.network_error);
    expect(locationAssignMock).not.toHaveBeenCalled();
  });
});
