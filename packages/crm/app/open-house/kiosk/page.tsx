import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OpenHouseKiosk } from '@/components/open-house-kiosk';
import { getRepository } from '@/lib/data';
import { validateOpenHouseProperty } from '@/lib/domain/open-house';
import { openHouseSignInAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Open house sign-in' };

export default async function OpenHouseKioskPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  let property: string;
  try { property = validateOpenHouseProperty((await searchParams).property); } catch { redirect('/open-house'); }
  const { userDisplayName } = await getRepository();
  return <OpenHouseKiosk property={property} hostName={userDisplayName} action={openHouseSignInAction.bind(null, property)} />;
}
