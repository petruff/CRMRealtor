'use client';

import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { DemoBanner } from '@/components/demo-banner';
import { isPublicPagePath } from '@/lib/routing/route-policy';

export function RouteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isPublicPagePath(pathname)) return children;

  return (
    <AppShell>
      <DemoBanner />
      {children}
    </AppShell>
  );
}

