// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  previewOrganization: vi.fn(),
  applyOrganization: vi.fn(),
  rollbackOrganization: vi.fn(),
}));

vi.mock('@/app/import-actions', () => ({
  listImportMappingProfilesAction: actions.listProfiles,
  previewExistingImportOrganizationAction: actions.previewOrganization,
  applyExistingImportOrganizationAction: actions.applyOrganization,
  rollbackExistingImportOrganizationAction: actions.rollbackOrganization,
  previewImportAction: vi.fn(),
  commitImportAction: vi.fn(),
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
});
