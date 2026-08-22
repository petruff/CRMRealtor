import { getRepository } from '@/lib/data';
import type { Metadata } from 'next';
import { MailerWorkspace } from '@/components/mailer-workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mailers' };

export default async function MailersPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; saved?: string }>;
}) {
  const { campaign, saved } = await searchParams;
  const { repository, mailerRepository, isLive } = await getRepository();
  const [contacts, campaigns] = await Promise.all([repository.list(), mailerRepository.list()]);
  const selectedCampaignId = campaigns.some((item) => item.id === campaign)
    ? campaign
    : campaigns[0]?.id;

  return (
    <MailerWorkspace
      campaigns={campaigns}
      contacts={contacts}
      selectedCampaignId={selectedCampaignId}
      isLive={isLive}
      saved={saved}
    />
  );
}
