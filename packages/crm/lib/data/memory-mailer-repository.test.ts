import { describe, expect, it } from 'vitest';
import { memoryRepository } from './memory-repository';
import { memoryMailerRepository } from './memory-mailer-repository';

describe('memoryMailerRepository', () => {
  it('shares campaigns and sends across repository instances like an HMR reload', async () => {
    const contacts = memoryRepository();
    const first = memoryMailerRepository(contacts);
    const name = `HMR campaign ${Date.now()}`;
    const campaign = await first.create({ name });
    await first.markSent(campaign.id, 'c-monroe', '2026-08-10');

    const second = memoryMailerRepository(contacts);
    const reloaded = (await second.list()).find((item) => item.id === campaign.id);
    expect(reloaded).toMatchObject({
      name,
      sends: [{ contactId: 'c-monroe', sentOn: '2026-08-10' }],
    });
  });
});
