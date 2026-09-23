import { describe, expect, it } from 'vitest';
import { memoryRepository } from '../data/memory-repository.ts';
import { openHouseVisitors, signInOpenHouseVisitorCommand } from './open-house-commands.ts';

const NOW = new Date('2026-09-27T15:00:00.000Z');
const PROPERTY = '1408 Bayshore Dr, Tampa, FL';
const TAG = 'open-house:2026-09-27:1408-bayshore-dr-tampa-fl';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function uniquePhone(): string {
  return `813${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
}

describe('signInOpenHouseVisitorCommand', () => {
  it('creates a new open-house lead with tag, temperature and a consent note', async () => {
    const repository = memoryRepository();
    const phone = uniquePhone();
    const result = await signInOpenHouseVisitorCommand(repository, {
      property: PROPERTY, form: form({ firstName: 'Nina', lastName: 'Walsh', phone, timeframe: 'now', smsConsent: 'on', emailConsent: 'off' }),
    }, NOW);
    const contact = await repository.get(result.contactId);
    const notes = await repository.notesFor(result.contactId);

    expect(result).toMatchObject({ created: true, firstName: 'Nina' });
    expect(contact).toMatchObject({ source: 'open-house', relationship: 'lead', pipelineStage: 'new', leadType: 'hot', emailSubscribed: false });
    expect(contact?.tags).toEqual(expect.arrayContaining([TAG, 'sms-consent']));
    expect(notes[0]?.body).toContain('Text consent: granted');
    expect(openHouseVisitors(await repository.list(), '2026-09-27').map((visitor) => visitor.id)).toContain(result.contactId);
  });

  it('tags visitors who already have an agent and keeps them out of hot follow-up', async () => {
    const repository = memoryRepository();
    const result = await signInOpenHouseVisitorCommand(repository, {
      property: PROPERTY, form: form({ firstName: 'Omar', lastName: 'Reyes', phone: uniquePhone(), timeframe: 'now', hasAgent: 'yes' }),
    }, NOW);
    const contact = await repository.get(result.contactId);
    expect(contact?.leadType).toBe('nurture');
    expect(contact?.tags).toContain('has-agent');
  });

  it('updates a returning visitor instead of duplicating, and never downgrades consent', async () => {
    const repository = memoryRepository();
    const phone = uniquePhone();
    const email = `ret-${phone}@example.com`;
    const first = await signInOpenHouseVisitorCommand(repository, {
      property: PROPERTY, form: form({ firstName: 'Lee', lastName: 'Park', phone, email, emailConsent: 'on', timeframe: 'now' }),
    }, NOW);
    const before = (await repository.list()).length;
    const second = await signInOpenHouseVisitorCommand(repository, {
      property: '22 Palm Ave, Sarasota, FL', form: form({ firstName: 'Lee', lastName: 'Park', phone: `+1 ${phone}`, timeframe: 'just-looking' }),
    }, NOW);
    const contact = await repository.get(first.contactId);

    expect(second).toMatchObject({ contactId: first.contactId, created: false });
    expect((await repository.list()).length).toBe(before);
    expect(contact).toMatchObject({ emailSubscribed: true, leadType: 'hot' });
    expect(contact?.tags).toEqual(expect.arrayContaining([TAG, 'open-house:2026-09-27:22-palm-ave-sarasota-fl']));
    expect(await repository.notesFor(first.contactId)).toHaveLength(2);
  });
});
