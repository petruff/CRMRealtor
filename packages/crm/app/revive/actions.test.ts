import { beforeEach, describe, expect, it, vi } from 'vitest';

const contact = { id: 'c1', firstName: 'Ana', lastName: 'Silva', leadType: 'warm', relationship: 'lead', intent: 'seller', source: 'other', pipelineStage: 'new', tags: [], createdAt: '2026-08-11T00:00:00.000Z', email: 'ana@example.com', emailSubscribed: true };
const repository = {
  get: vi.fn(async () => contact as unknown),
  update: vi.fn(async (_id: string, patch: object) => ({ ...contact, ...patch })),
  addNote: vi.fn(async (_id: string, body: string) => ({ id: 'n1', contactId: 'c1', body, createdAt: '2026-09-24T00:00:00.000Z' })),
};
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ repository, workspaceScope: {} })) }));

const { markRevivedAction, stopEmailsAction } = await import('./actions');

describe('revive actions', () => {
  beforeEach(() => { vi.clearAllMocks(); repository.get.mockResolvedValue(contact); });

  it('logs the email as a conversation with the subject', async () => {
    expect(await markRevivedAction('c1', 'A quick question about 1450 Sunset Dr')).toEqual({ status: 'done' });
    expect(repository.addNote).toHaveBeenCalledWith('c1', 'Emailed: A quick question about 1450 Sunset Dr');
    expect(repository.update).toHaveBeenCalledWith('c1', expect.objectContaining({ pipelineStage: 'contacted' }));
  });

  it('turns email off and notes why when they ask to stop', async () => {
    expect(await stopEmailsAction('c1')).toMatchObject({ status: 'done' });
    expect(repository.update).toHaveBeenCalledWith('c1', { emailSubscribed: false });
    expect(repository.addNote).toHaveBeenCalledWith('c1', expect.stringMatching(/^Asked not to receive emails/u));
  });

  it('rejects bad ids and archived contacts without writing', async () => {
    expect(await markRevivedAction('../x y', 'Hi')).toMatchObject({ status: 'error' });
    repository.get.mockResolvedValue({ ...contact, archivedAt: '2026-09-01T00:00:00.000Z' });
    expect(await stopEmailsAction('c1')).toMatchObject({ status: 'error' });
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.addNote).not.toHaveBeenCalled();
  });
});
