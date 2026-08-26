import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/application/contact-import', () => ({ parseContactImport: vi.fn() }));
vi.mock('@/lib/application/workbook-portability', () => ({ parsePortableContactImport: vi.fn() }));
vi.mock('@/lib/application/contact-import-service', () => ({
  previewContactImport: vi.fn(), executeContactImport: vi.fn(),
}));
vi.mock('@/lib/application/imported-contact-organization', () => ({
  organizeExistingImportedContacts: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));

import { getRepository } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { parsePortableContactImport } from '@/lib/application/workbook-portability';
import { executeContactImport, previewContactImport } from '@/lib/application/contact-import-service';
import { organizeExistingImportedContacts } from '@/lib/application/imported-contact-organization';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  applyExistingImportOrganizationAction,
  commitImportAction,
  previewExistingImportOrganizationAction,
  previewImportAction,
  rollbackExistingImportOrganizationAction,
} from './import-actions';

describe('contact import actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a configured signed-out preview before workbook parsing starts', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getRepository).mockResolvedValue({ isLive: false } as Awaited<ReturnType<typeof getRepository>>);

    const result = await previewImportAction({
      filename: 'untrusted.xlsx', source: 'auto', contentBase64: 'not-a-workbook',
    });

    expect(result).toEqual({
      ok: false,
      message: 'Sign in to an authorized Omnix workspace before previewing contact files.',
    });
    expect(parsePortableContactImport).not.toHaveBeenCalled();
  });

  it('bounds concurrent workbook parsing per authenticated workspace', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      workspaceScope: { workspaceId: 'workspace-security-test' },
      repository: {}, importGateway: {},
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(parsePortableContactImport).mockImplementation(async () => {
      await gate;
      return { filename: 'synthetic.xlsx' } as Awaited<ReturnType<typeof parsePortableContactImport>>;
    });
    vi.mocked(previewContactImport).mockResolvedValue({} as Awaited<ReturnType<typeof previewContactImport>>);
    const input = { filename: 'synthetic.xlsx', source: 'auto' as const, contentBase64: 'UEs=' };

    const first = previewImportAction(input);
    const second = previewImportAction(input);
    await vi.waitFor(() => expect(parsePortableContactImport).toHaveBeenCalledTimes(2));
    await expect(previewImportAction(input)).resolves.toMatchObject({
      ok: false, message: expect.stringContaining('already being processed'),
    });
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('previews existing import organization without applying changes', async () => {
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      repository: {}, richContactRepository: {}, activityRepository: {}, importGateway: {},
      workspaceScope: { workspaceId: 'workspace-owner', membershipId: 'owner-1', role: 'owner' },
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(organizeExistingImportedContacts).mockResolvedValue({
      dryRun: true, policyVersion: 'omnix.import-classification.v1', scanned: 140,
      withImportProfile: 140, eligible: 138, wouldUpdate: 138, updated: 0,
      alreadyOrganized: 0, skippedProtected: 2, needsReview: 12, failed: 0,
      rollbackAvailable: false,
      leadTypes: { hot: 20, warm: 80, nurture: 38 },
      pipelineStages: { new: 38, contacted: 10, 'appointment-set': 5, active: 60, 'under-contract': 10, closed: 15, lost: 0 },
    });

    const response = await previewExistingImportOrganizationAction();

    expect(response).toMatchObject({ ok: true, result: { dryRun: true, wouldUpdate: 138 } });
    expect(organizeExistingImportedContacts).toHaveBeenCalledWith(
      expect.any(Object), { dryRun: true },
    );
  });

  it('keeps existing-import mutation owner-only', async () => {
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      richContactRepository: {},
      workspaceScope: { workspaceId: 'workspace-admin', membershipId: 'admin-1', role: 'admin' },
    } as unknown as Awaited<ReturnType<typeof getRepository>>);

    await expect(applyExistingImportOrganizationAction()).resolves.toEqual({
      ok: false,
      message: 'Only the workspace owner can organize existing imports.',
    });
    expect(organizeExistingImportedContacts).not.toHaveBeenCalled();
  });

  it('keeps rollback owner-only and validates its receipt before repository access', async () => {
    await expect(rollbackExistingImportOrganizationAction('not-a-run')).resolves.toEqual({
      ok: false, message: 'The rollback receipt is invalid.',
    });
    expect(getRepository).not.toHaveBeenCalled();
  });

  it('fails receipt preflight before applying the first contact mutation', async () => {
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      workspaceScope: { workspaceId: 'workspace-owner', membershipId: 'owner-1', role: 'owner' },
      repository: {}, importGateway: { getReceipt: vi.fn(async () => undefined) }, activityRepository: {}, incompleteRecordRepository: {},
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(parsePortableContactImport).mockResolvedValue({
      filename: 'contacts.numbers', format: 'numbers', provider: 'spreadsheet', totalRows: 1,
    } as Awaited<ReturnType<typeof parsePortableContactImport>>);
    vi.mocked(previewContactImport).mockResolvedValue({
      filename: 'contacts.numbers', format: 'numbers', provider: 'spreadsheet', totalRows: 1,
    } as Awaited<ReturnType<typeof previewContactImport>>);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn(async () => ({ data: null, error: { code: '42883' } })),
    } as never);

    const response = await commitImportAction({
      filename: 'contacts.numbers', source: 'auto', contentBase64: 'UEs=',
    });

    expect(response).toMatchObject({
      ok: false,
      message: expect.stringContaining('No contacts were changed'),
    });
    expect(executeContactImport).not.toHaveBeenCalled();
  });

  it('returns a durable aggregate replay before parsing or previewing mutable contact state', async () => {
    const contentBase64 = 'UEs=';
    const fileHash = createHash('sha256').update(Buffer.from(contentBase64, 'base64')).digest('hex');
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      workspaceScope: { workspaceId: 'workspace-owner', membershipId: 'owner-1', role: 'owner' },
      repository: {}, activityRepository: {}, incompleteRecordRepository: {},
      importGateway: {
        getReceipt: vi.fn(async () => ({
          idempotencyKey: `ui:${fileHash}`,
          requestHash: fileHash,
          statusCode: 200,
          createdAt: '2026-08-25T12:30:00.000Z',
          response: {
            state: 'recorded', runId: 'run-immutable', planHash: 'a'.repeat(64), noOp: false,
            counts: { total: 1, created: 1, updated: 0, unchanged: 0, rejected: 0, quarantined: 0, failed: 0, notesAdded: 0 },
            rowOutcomes: [{ rowNumber: 1, outcome: 'created', contactId: 'contact-original' }],
          },
        })),
      },
    } as unknown as Awaited<ReturnType<typeof getRepository>>);

    const response = await commitImportAction({
      filename: 'contacts.xlsx', source: 'spreadsheet', contentBase64,
    });

    expect(response).toMatchObject({
      ok: true,
      result: { created: 1, updated: 0, receiptState: 'recorded' },
    });
    expect(parsePortableContactImport).not.toHaveBeenCalled();
    expect(previewContactImport).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('recovers an exact prior import without replaying contact mutations', async () => {
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      workspaceScope: { workspaceId: 'workspace-owner', membershipId: 'owner-1', role: 'owner' },
      repository: {}, importGateway: { getReceipt: vi.fn(async () => undefined) }, activityRepository: {}, incompleteRecordRepository: {},
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(parsePortableContactImport).mockResolvedValue({
      filename: 'contacts.numbers', format: 'numbers', provider: 'spreadsheet', totalRows: 2,
    } as Awaited<ReturnType<typeof parsePortableContactImport>>);
    vi.mocked(previewContactImport).mockResolvedValue({
      filename: 'contacts.numbers', format: 'numbers', provider: 'spreadsheet', totalRows: 2,
    } as Awaited<ReturnType<typeof previewContactImport>>);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      rpc: vi.fn(async () => ({ data: {
        state: 'recovered', runId: 'run-a',
        counts: {
          total: 2, created: 1, updated: 1, unchanged: 0,
          rejected: 0, quarantined: 0, failed: 0, notesAdded: 0,
        },
        rowOutcomes: [
          { rowNumber: 1, outcome: 'created', contactId: 'contact-a' },
          { rowNumber: 2, outcome: 'updated', contactId: 'contact-b' },
        ],
      }, error: null })),
    } as never);

    const response = await commitImportAction({
      filename: 'contacts.numbers', source: 'auto', contentBase64: 'UEs=',
    });

    expect(response).toMatchObject({
      ok: true,
      result: { created: 1, updated: 1, receiptState: 'recovered' },
    });
    expect(executeContactImport).not.toHaveBeenCalled();
  });
});
