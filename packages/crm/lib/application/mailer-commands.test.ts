import { describe, expect, it } from 'vitest';
import type { Contact, Note } from '@/lib/domain/contact';
import type { ContactRepository } from '@/lib/data/repository';
import { createMemoryMailerRepository } from '@/lib/data/memory-mailer-repository';
import {
  createMailerCampaignCommand,
  currentDateOnly,
  markMailerSentCommand,
  unmarkMailerSentCommand,
} from './mailer-commands';

function contactsRepository(ids: string[] = ['c-1']): ContactRepository {
  const contacts = ids.map(
    (id): Contact => ({
      id,
      firstName: 'Test',
      lastName: id,
      leadType: 'warm',
      relationship: 'lead',
      intent: 'unknown',
      source: 'other',
      pipelineStage: 'new',
      tags: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      emailSubscribed: true,
      mailingAddress: '10 Main St',
      city: 'Decatur',
      state: 'GA',
      postalCode: '30030',
    }),
  );
  return {
    async list() { return contacts; },
    async get(id) { return contacts.find((contact) => contact.id === id); },
    async create() { throw new Error('not used'); },
    async update() { throw new Error('not used'); },
    async remove() {},
    async notesFor() { return [] as Note[]; },
    async addNote() { throw new Error('not used'); },
  };
}

describe('mailer commands', () => {
  it('stamps the Realtor calendar day rather than the UTC rollover day', () => {
    const instant = new Date('2026-08-11T02:00:00.000Z');
    expect(currentDateOnly(instant, 'America/New_York')).toBe('2026-08-10');
    expect(() => currentDateOnly(instant, 'Not/A-Time-Zone')).toThrow('time zone is invalid');
  });

  it('validates campaign input without writing', async () => {
    const repository = createMemoryMailerRepository(contactsRepository());
    await expect(createMailerCampaignCommand(repository, { name: '  ' })).rejects.toMatchObject({
      fieldErrors: { name: 'Enter a campaign name.' },
    });
    await expect(
      createMailerCampaignCommand(repository, { name: 'x'.repeat(121) }),
    ).rejects.toMatchObject({ fieldErrors: { name: 'Use 120 characters or fewer.' } });
    await expect(
      createMailerCampaignCommand(repository, { name: 'Good', notes: 'x'.repeat(1_001) }),
    ).rejects.toMatchObject({ fieldErrors: { notes: 'Use 1000 characters or fewer.' } });
    expect(await repository.list()).toHaveLength(0);
  });

  it('creates, marks, and unmarks idempotently while preserving the first date', async () => {
    const repository = createMemoryMailerRepository(contactsRepository());
    const campaign = await createMailerCampaignCommand(repository, {
      name: '  Spring postcard  ',
      notes: '  Farm area A  ',
    });
    expect(campaign).toMatchObject({ name: 'Spring postcard', notes: 'Farm area A' });

    const contacts = contactsRepository();
    await markMailerSentCommand(repository, contacts, campaign.id, 'c-1', '2026-08-09');
    await markMailerSentCommand(repository, contacts, campaign.id, 'c-1', '2026-08-10');
    expect((await repository.list())[0]?.sends).toEqual([
      { mailerId: campaign.id, contactId: 'c-1', sentOn: '2026-08-09' },
    ]);

    await unmarkMailerSentCommand(repository, campaign.id, 'c-1');
    await unmarkMailerSentCommand(repository, campaign.id, 'c-1');
    expect((await repository.list())[0]?.sends).toEqual([]);
  });

  it('rejects malformed IDs, dates, and missing same-repository targets', async () => {
    const repository = createMemoryMailerRepository(contactsRepository());
    const contacts = contactsRepository();
    const campaign = await createMailerCampaignCommand(repository, { name: 'Postcard' });
    await expect(markMailerSentCommand(repository, contacts, '../bad', 'c-1')).rejects.toThrow('invalid');
    await expect(markMailerSentCommand(repository, contacts, campaign.id, 'c-1', '2026-02-31')).rejects.toThrow(
      'Send date is invalid',
    );
    await expect(markMailerSentCommand(repository, contacts, campaign.id, 'other-owner-contact')).rejects.toThrow(
      'Contact not found',
    );
    await expect(unmarkMailerSentCommand(repository, 'missing-campaign', 'c-1')).rejects.toThrow(
      'Mailer campaign not found',
    );
  });

  it('rejects a new send when the contact address is incomplete at command time', async () => {
    const contacts = contactsRepository();
    const contact = await contacts.get('c-1');
    if (!contact) throw new Error('fixture missing');
    contact.postalCode = '   ';
    const repository = createMemoryMailerRepository(contacts);
    const campaign = await createMailerCampaignCommand(repository, { name: 'Postcard' });
    await expect(
      markMailerSentCommand(repository, contacts, campaign.id, 'c-1', '2026-08-10'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('complete street'),
      fieldErrors: { mailingAddress: 'Complete the mailing address first.' },
    });
    expect((await repository.list())[0]?.sends).toEqual([]);
  });

  it('does not hide repository failures', async () => {
    const repository = createMemoryMailerRepository(contactsRepository());
    repository.create = async () => { throw new Error('provider unavailable'); };
    await expect(createMailerCampaignCommand(repository, { name: 'Postcard' })).rejects.toThrow(
      'provider unavailable',
    );
  });
});
