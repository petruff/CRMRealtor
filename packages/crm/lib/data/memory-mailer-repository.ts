import type { ContactRepository } from '@/lib/data/repository';
import type { MailerCampaign, MailerSend } from '@/lib/domain/mailer';
import type { MailerRepository } from './mailer-repository';

interface MailerStore {
  campaigns: MailerCampaign[];
}

const CACHE_KEY = '__omnixMemoryMailerStore__';

function seedCampaigns(now: Date = new Date()): MailerCampaign[] {
  const year = now.getUTCFullYear();
  const createdAt = `${year}-01-01T12:00:00.000Z`;
  return [
    { id: 'm-jan', name: 'Just Listed — Alder Hollow', notes: 'Neighbourhood postcard', createdAt, sends: [] },
    { id: 'm-mar', name: 'Spring Market Update', createdAt, sends: [] },
    { id: 'm-jun', name: 'Mid-Year Home Value', createdAt, sends: [] },
    { id: 'm-oct', name: 'Fall Neighbourhood Report', createdAt, sends: [] },
    { id: 'm-dec', name: 'Holiday Card', createdAt, sends: [] },
  ];
}

function globalStore(): MailerStore {
  const ref = globalThis as typeof globalThis & { [CACHE_KEY]?: MailerStore };
  if (!ref[CACHE_KEY]) ref[CACHE_KEY] = { campaigns: seedCampaigns() };
  return ref[CACHE_KEY];
}

function nextId(): string {
  return `m-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMemoryMailerRepository(
  contacts: ContactRepository,
  state: MailerStore = { campaigns: [] },
): MailerRepository {
  const requireTargets = async (mailerId: string, contactId: string) => {
    const campaign = state.campaigns.find((item) => item.id === mailerId);
    if (!campaign) throw new Error('Mailer campaign not found.');
    if (!(await contacts.get(contactId))) throw new Error('Contact not found.');
    return campaign;
  };

  return {
    async list() {
      return state.campaigns
        .map((campaign) => ({ ...campaign, sends: campaign.sends.map((send) => ({ ...send })) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
    },

    async create(input) {
      const campaign: MailerCampaign = {
        id: nextId(),
        name: input.name,
        notes: input.notes,
        createdAt: new Date().toISOString(),
        sends: [],
      };
      state.campaigns.push(campaign);
      return { ...campaign, sends: [] };
    },

    async markSent(mailerId, contactId, sentOn) {
      const campaign = await requireTargets(mailerId, contactId);
      const existing = campaign.sends.find((send) => send.contactId === contactId);
      if (existing) return { ...existing };
      const send: MailerSend = { mailerId, contactId, sentOn };
      campaign.sends.push(send);
      return { ...send };
    },

    async unmarkSent(mailerId, contactId) {
      const campaign = await requireTargets(mailerId, contactId);
      campaign.sends = campaign.sends.filter((send) => send.contactId !== contactId);
    },
  };
}

export function memoryMailerRepository(contacts: ContactRepository): MailerRepository {
  return createMemoryMailerRepository(contacts, globalStore());
}
