import type { Metadata } from 'next';
import Link from 'next/link';
import { UserRoundPlus } from 'lucide-react';
import { CapturePicker } from '@/components/capture-picker';
import { PageHeader } from '@/components/page-header';
import { captureCandidates } from '@/lib/application/capture-candidates';
import { getRepository } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Log a conversation',
  description: 'Pick the person you just talked to and capture notes, next step and follow-up.',
};

export default async function CapturePage() {
  const { repository } = await getRepository();
  const candidates = captureCandidates(await repository.list(), new Date());
  return (
    <div className="ox-stack ox-narrow">
      <PageHeader
        eyebrow="Quick capture"
        title="Who did you just talk to?"
        description="Pick the person — Omnix turns what happened into notes, the next step and the follow-up date."
        actions={<Link href="/contacts/new" className="sk-secondary-button"><UserRoundPlus className="size-4" aria-hidden /> New person</Link>}
      />
      <CapturePicker candidates={candidates} />
    </div>
  );
}
