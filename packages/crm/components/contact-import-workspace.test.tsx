// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  previewOrganization: vi.fn(),
  applyOrganization: vi.fn(),
  rollbackOrganization: vi.fn(),
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));

vi.mock('@/app/import-actions', () => ({
  listImportMappingProfilesAction: actions.listProfiles,
  previewExistingImportOrganizationAction: actions.previewOrganization,
  applyExistingImportOrganizationAction: actions.applyOrganization,
  rollbackExistingImportOrganizationAction: actions.rollbackOrganization,
  previewImportAction: actions.previewImport,
  commitImportAction: actions.commitImport,
  saveImportMappingProfileAction: vi.fn(),
}));

import { ContactImportWorkspace } from '@/components/contact-import-workspace';

const audit = {
  dryRun: true,
  policyVersion: 'omnix.import-classification.v1' as const,
  scanned: 140,
  withImportProfile: 140,
  eligible: 138,
  wouldUpdate: 138,
  updated: 0,
  alreadyOrganized: 0,
  skippedProtected: 2,
  needsReview: 12,
  failed: 0,
  rollbackAvailable: false,
  leadTypes: { hot: 20, warm: 80, nurture: 38 },
  pipelineStages: {
    new: 38, contacted: 10, 'appointment-set': 5, active: 60,
    'under-contract': 10, closed: 15, lost: 0,
  },
};

afterEach(cleanup);

describe('ContactImportWorkspace automatic organization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.listProfiles.mockResolvedValue({ ok: true, profiles: [] });
    actions.previewOrganization.mockResolvedValue({ ok: true, result: audit });
    actions.applyOrganization.mockResolvedValue({
      ok: true,
      result: { ...audit, dryRun: false, updated: 138, runId: '67e55044-10b1-426f-9247-bb680e5fe0c8', rollbackAvailable: true },
    });
    actions.rollbackOrganization.mockResolvedValue({
      ok: true,
      receipt: { runId: '67e55044-10b1-426f-9247-bb680e5fe0c8', contactCount: 138, state: 'rolled-back', noOp: false },
    });
    actions.previewImport.mockResolvedValue({ ok: false, message: 'Read-only routing check.' });
  });

  it('explains and applies the bounded existing-import cleanup in one action', async () => {
    const user = userEvent.setup();
    render(<ContactImportWorkspace />);

    expect(await screen.findByRole('heading', {
      name: '138 imported contacts are ready to organize.',
    })).toBeInTheDocument();
    expect(screen.getByText('20 Hot')).toBeInTheDocument();
    expect(screen.getByText('12 safely queued for review')).toBeInTheDocument();
    expect(screen.getByText(/already edited by a person stay untouched/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /organize existing imports/i }));

    expect(await screen.findByText(/138 contacts organized automatically/i)).toBeInTheDocument();
    expect(actions.applyOrganization).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /restore previous values/i })).toBeInTheDocument();
  });

  it('restores the exact organization run from its receipt', async () => {
    const user = userEvent.setup();
    render(<ContactImportWorkspace />);
    await user.click(await screen.findByRole('button', { name: /organize existing imports/i }));
    await user.click(await screen.findByRole('button', { name: /restore previous values/i }));
    expect(actions.rollbackOrganization).toHaveBeenCalledWith('67e55044-10b1-426f-9247-bb680e5fe0c8');
    expect(await screen.findByText(/138 contacts were restored/i)).toBeInTheDocument();
  });

  it('reads Apple Numbers files as bounded binary input instead of CSV text', async () => {
    const user = userEvent.setup();
    actions.previewImport.mockResolvedValueOnce({
      ok: true,
      isLive: true,
      preview: {
        provider: 'spreadsheet', filename: 'contacts.numbers', format: 'numbers', totalRows: 3,
        headers: ['First Name', 'Lead Type', 'Pipeline Stage'], recognizedFields: ['firstName', 'leadType', 'pipelineStage'],
        unknownFields: [], preservedFields: [], rejected: [],
        counts: { create: 3, update: 0, unchanged: 0, merge: 0, 'archived-match': 0, 'ambiguous-identity': 0, rejected: 0, protected: 0 },
        classificationCounts: { automatic: 3, explicit: 0, needsReview: 0 },
        rows: [
          { rowNumber: 2, action: 'create', candidate: { firstName: 'Hot', lastName: 'Contact', tags: [], leadType: 'hot', pipelineStage: 'active' }, classification: { summary: 'Active lead.' }, changes: [] },
          { rowNumber: 3, action: 'create', candidate: { firstName: 'Warm', lastName: 'Contact', tags: [], leadType: 'warm', pipelineStage: 'new' }, classification: { summary: 'Warm prospect.' }, changes: [] },
          { rowNumber: 4, action: 'create', candidate: { firstName: 'Nurture', lastName: 'Contact', tags: [], leadType: 'nurture', pipelineStage: 'lost' }, classification: { summary: 'Archived lead.' }, changes: [] },
        ],
      },
    });
    const { container } = render(<ContactImportWorkspace />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAccessibleName('Choose a contact import file');
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'contacts.numbers', {
      type: 'application/vnd.apple.numbers',
    });

    await user.upload(input, file);

    await waitFor(() => expect(actions.previewImport).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'contacts.numbers',
      contentBase64: expect.any(String),
    })));
    expect(actions.previewImport.mock.calls[0]?.[0]).not.toHaveProperty('content');
    expect(await screen.findByText('1 Hot')).toBeInTheDocument();
    expect(screen.getByText('1 Warm')).toBeInTheDocument();
    expect(screen.getByText('1 Nurture')).toBeInTheDocument();
    expect(screen.getByText('1 Active')).toBeInTheDocument();
  });

  it('separates qualification review, quarantine, incomplete rows, failures, and current contacts', async () => {
    const user = userEvent.setup();
    actions.previewImport.mockResolvedValueOnce({
      ok: true, isLive: true,
      preview: {
        provider: 'spreadsheet', filename: 'contacts.csv', format: 'csv', totalRows: 1,
        headers: ['First Name'], recognizedFields: ['firstName'], unknownFields: [], preservedFields: [], rejected: [],
        counts: { create: 1, update: 0, unchanged: 0, merge: 0, 'archived-match': 0, 'ambiguous-identity': 0, rejected: 0, protected: 0 },
        classificationCounts: { automatic: 0, explicit: 0, needsReview: 1 },
        rows: [{
          rowNumber: 2, action: 'create', candidate: { firstName: 'Avery', lastName: '', tags: [], leadType: 'nurture', pipelineStage: 'new' },
          classification: { summary: 'Qualification review.', needsReview: true }, changes: ['firstName'],
        }],
      },
    });
    actions.commitImport.mockResolvedValueOnce({
      ok: true,
      result: {
        ok: false, provider: 'spreadsheet', totalRows: 6, created: 1, updated: 1, unchanged: 1,
        merged: 0, archivedMatches: 0, ambiguousIdentities: 0, notesAdded: 0,
        qualificationReview: 1, incomplete: 2, rejected: 1, quarantined: 1, protected: 0, failed: 1,
        errors: [], rowOutcomes: [],
      },
    });
    const { container } = render(<ContactImportWorkspace />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['First Name\nAvery'], 'contacts.csv', { type: 'text/csv' }));
    await user.click(await screen.findByRole('button', { name: /confirm import/i }));

    expect(await screen.findByText(/1 imported contacts need qualification review/i)).toBeInTheDocument();
    expect(screen.getByText(/2 incomplete \(1 safely quarantined\) · 1 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/1 already current/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Review qualification' })[0]).toHaveAttribute('href', '/contacts?scope=needs-review');
    expect(screen.getAllByRole('link', { name: 'Review quarantined records' })[0]).toHaveAttribute('href', '/contacts/incomplete');
    expect(screen.getByRole('button', { name: 'Fix and re-import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry failed rows' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View import history' })).toHaveAttribute('href', '/data#import-history');
  });

  it('keeps failed-only recovery focused on retry and history', async () => {
    const user = userEvent.setup();
    actions.previewImport.mockResolvedValueOnce({
      ok: true, isLive: true,
      preview: {
        provider: 'spreadsheet', filename: 'contacts.csv', format: 'csv', totalRows: 1,
        headers: ['Email'], recognizedFields: ['email'], unknownFields: [], preservedFields: [], rejected: [],
        counts: { create: 1, update: 0, unchanged: 0, merge: 0, 'archived-match': 0, 'ambiguous-identity': 0, rejected: 0, protected: 0 },
        classificationCounts: { automatic: 1, explicit: 0, needsReview: 0 },
        rows: [{
          rowNumber: 2, action: 'create', candidate: { email: 'avery@example.com', tags: [], leadType: 'warm', pipelineStage: 'new' },
          classification: { summary: 'Warm prospect.' }, changes: ['email'],
        }],
      },
    });
    actions.commitImport.mockResolvedValue({
      ok: true,
      result: {
        ok: false, provider: 'spreadsheet', totalRows: 1, created: 0, updated: 0, unchanged: 0,
        merged: 0, archivedMatches: 0, ambiguousIdentities: 0, notesAdded: 0,
        qualificationReview: 0, incomplete: 0, rejected: 0, quarantined: 0, protected: 0, failed: 1,
        errors: [{ rowNumber: 2, message: 'Temporary provider failure.' }], rowOutcomes: [],
      },
    });
    const { container } = render(<ContactImportWorkspace />);
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['Email\navery@example.com'], 'contacts.csv', { type: 'text/csv' }),
    );
    await user.click(await screen.findByRole('button', { name: /confirm import/i }));

    expect(await screen.findByRole('button', { name: 'Retry failed rows' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View import history' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fix and re-import' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review quarantined records' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry failed rows' }));
    expect(actions.commitImport).toHaveBeenCalledTimes(2);
  });

  it('directs a rejected-only result back to correction without a quarantine CTA', async () => {
    const user = userEvent.setup();
    actions.previewImport.mockResolvedValueOnce({
      ok: true, isLive: true,
      preview: {
        provider: 'spreadsheet', filename: 'contacts.csv', format: 'csv', totalRows: 2,
        headers: ['First Name'], recognizedFields: ['firstName'], unknownFields: [], preservedFields: [], rejected: [],
        counts: { create: 1, update: 0, unchanged: 0, merge: 0, 'archived-match': 0, 'ambiguous-identity': 0, rejected: 1, protected: 0 },
        classificationCounts: { automatic: 1, explicit: 0, needsReview: 0 },
        rows: [{
          rowNumber: 2, action: 'create', candidate: { firstName: 'Avery', lastName: '', tags: [], leadType: 'nurture', pipelineStage: 'new' },
          classification: { summary: 'New relationship.' }, changes: ['firstName'],
        }],
      },
    });
    actions.commitImport.mockResolvedValueOnce({
      ok: true,
      result: {
        ok: false, provider: 'spreadsheet', totalRows: 2, created: 1, updated: 0, unchanged: 0,
        merged: 0, archivedMatches: 0, ambiguousIdentities: 0, notesAdded: 0,
        qualificationReview: 0, incomplete: 1, rejected: 1, quarantined: 0, protected: 0, failed: 0,
        errors: [{ rowNumber: 2, message: 'Add a name, email, or phone.' }], rowOutcomes: [],
      },
    });
    const { container } = render(<ContactImportWorkspace />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['First Name\n'], 'contacts.csv', { type: 'text/csv' }));
    await user.click(await screen.findByRole('button', { name: /confirm import/i }));

    expect(await screen.findByRole('button', { name: 'Fix and re-import' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review quarantined records' })).not.toBeInTheDocument();
  });

  it('uses Already current in preview copy', async () => {
    const user = userEvent.setup();
    actions.previewImport.mockResolvedValueOnce({
      ok: true, isLive: true,
      preview: {
        provider: 'spreadsheet', filename: 'contacts.csv', format: 'csv', totalRows: 1,
        headers: ['Email'], recognizedFields: ['email'], unknownFields: [], preservedFields: [], rejected: [],
        counts: { create: 0, update: 0, unchanged: 1, merge: 0, 'archived-match': 0, 'ambiguous-identity': 0, rejected: 0, protected: 0 },
        classificationCounts: { automatic: 0, explicit: 1, needsReview: 0 }, rows: [],
      },
    });
    const { container } = render(<ContactImportWorkspace />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['Email\na@example.com'], 'contacts.csv', { type: 'text/csv' }));

    expect(await screen.findByText(/1 Already current/)).toBeInTheDocument();
    expect(screen.queryByText(/clients already existing/i)).not.toBeInTheDocument();
  });
});
