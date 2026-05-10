import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import plMessages from '@/messages/pl.json';
import { BusinessError } from '@/lib/supabase/errors';

const { routerRefreshMock, renameDocumentMock } = vi.hoisted(() => ({
  routerRefreshMock: vi.fn(),
  renameDocumentMock: vi.fn()
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefreshMock })
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ __isClient: true })
}));

vi.mock('@/lib/supabase/documents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/documents')>(
    '@/lib/supabase/documents'
  );
  return {
    ...actual,
    renameDocument: renameDocumentMock
  };
});

import { RenameDocumentForm } from './RenameDocumentForm';

const DOC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function renderForm(initialName = 'Stara nazwa') {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages}>
      <RenameDocumentForm documentId={DOC_ID} initialName={initialName} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  renameDocumentMock.mockResolvedValue({
    data: {
      id: DOC_ID,
      name: 'Nowa nazwa',
      schema_version: 1,
      data: { schemaVersion: 1, canvasWidth: 100, canvasHeight: 100, shapes: [], weldUnits: [] },
      created_at: '2026-05-10T12:00:00Z',
      updated_at: '2026-05-10T13:00:00Z'
    },
    error: null
  });
});

describe('RenameDocumentForm — view mode', () => {
  it('renders the initial name and a rename action button', () => {
    renderForm('Stara nazwa');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stara nazwa');
    expect(
      screen.getByRole('button', { name: plMessages.project.rename.action })
    ).toBeInTheDocument();
  });

  it('swaps to an input on rename click and focuses it', async () => {
    const user = userEvent.setup();
    renderForm('Stara nazwa');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));

    const input = screen.getByLabelText(plMessages.project.rename.label);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Stara nazwa');
    expect(input).toHaveFocus();
  });
});

describe('RenameDocumentForm — happy path', () => {
  it('PATCHes the new name and exits edit mode on success', async () => {
    const user = userEvent.setup();
    renderForm('Stara nazwa');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label);
    await user.clear(input);
    await user.type(input, 'Nowa nazwa');
    await user.click(screen.getByRole('button', { name: plMessages.project.rename.save }));

    expect(renameDocumentMock).toHaveBeenCalledWith(expect.any(Object), DOC_ID, {
      name: 'Nowa nazwa'
    });

    // Edit mode exited; heading shows the new (optimistic + server-confirmed) name.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Nowa nazwa');
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('trims whitespace before PATCHing', async () => {
    const user = userEvent.setup();
    renderForm('A');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label);
    await user.clear(input);
    await user.type(input, '   Nowa nazwa   ');
    await user.click(screen.getByRole('button', { name: plMessages.project.rename.save }));

    expect(renameDocumentMock).toHaveBeenCalledWith(expect.any(Object), DOC_ID, {
      name: 'Nowa nazwa'
    });
  });
});

describe('RenameDocumentForm — client-side preflight', () => {
  it('blocks submit and shows inline error for empty name (whitespace-only)', async () => {
    const user = userEvent.setup();
    renderForm('A');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label);
    await user.clear(input);
    await user.type(input, '    ');
    await user.click(screen.getByRole('button', { name: plMessages.project.rename.save }));

    expect(renameDocumentMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.document_name_invalid
    );
  });

  it('caps input at 100 characters (HTML maxLength)', async () => {
    const user = userEvent.setup();
    renderForm('A');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'x'.repeat(150));

    expect(input.value.length).toBe(100);
  });
});

describe('RenameDocumentForm — error mapping', () => {
  it('surfaces DOCUMENT_NAME_INVALID from the server inline and stays in edit mode', async () => {
    renameDocumentMock.mockResolvedValueOnce({
      data: null,
      error: {
        business: BusinessError.DOCUMENT_NAME_INVALID,
        message: 'errors.document_name_invalid'
      }
    });

    const user = userEvent.setup();
    renderForm('A');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label);
    await user.clear(input);
    await user.type(input, 'x'); // passes the client preflight, server rejects.
    await user.click(screen.getByRole('button', { name: plMessages.project.rename.save }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      plMessages.errors.document_name_invalid
    );
    // Still in edit mode — input is rendered.
    expect(screen.getByLabelText(plMessages.project.rename.label)).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it('falls back to errors.unknown for an unmapped server error', async () => {
    renameDocumentMock.mockResolvedValueOnce({
      data: null,
      error: { business: BusinessError.UNKNOWN, message: 'errors.unknown' }
    });

    const user = userEvent.setup();
    renderForm('A');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label);
    await user.clear(input);
    await user.type(input, 'x');
    await user.click(screen.getByRole('button', { name: plMessages.project.rename.save }));

    expect(await screen.findByRole('alert')).toHaveTextContent(plMessages.errors.unknown);
  });
});

describe('RenameDocumentForm — cancel / escape', () => {
  it('reverts the draft and exits edit mode on Cancel click', async () => {
    const user = userEvent.setup();
    renderForm('Stara nazwa');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label);
    await user.clear(input);
    await user.type(input, 'Edycja w toku');
    await user.click(screen.getByRole('button', { name: plMessages.project.rename.cancel }));

    expect(renameDocumentMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stara nazwa');
  });

  it('exits edit mode on Escape key', async () => {
    const user = userEvent.setup();
    renderForm('Stara nazwa');

    await user.click(screen.getByRole('button', { name: plMessages.project.rename.action }));
    const input = screen.getByLabelText(plMessages.project.rename.label);
    await user.clear(input);
    await user.type(input, 'Edycja{Escape}');

    expect(renameDocumentMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stara nazwa');
  });
});
