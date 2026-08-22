import type { MailerCampaign, MailerSend } from '@/lib/domain/mailer';

export interface MailerRepository {
  list(): Promise<MailerCampaign[]>;
  create(input: { name: string; notes?: string }): Promise<MailerCampaign>;
  markSent(mailerId: string, contactId: string, sentOn: string): Promise<MailerSend>;
  unmarkSent(mailerId: string, contactId: string): Promise<void>;
}
