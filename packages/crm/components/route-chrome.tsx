'use client';

import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { DemoBanner } from '@/components/demo-banner';
import { isPublicPagePath } from '@/lib/routing/route-policy';

export function RouteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isPublicPagePath(pathname)) return children;
  // Guest-facing kiosk: authenticated, but without any CRM navigation or data.
  // Client portal: a visitor's private page, never the CRM shell.
  if (pathname.startsWith('/portal/')) return <main id="main-content" className="ox-portal-shell">{children}</main>;
  if (pathname === '/open-house/kiosk') return <main id="main-content" className="ox-kiosk-shell">{children}</main>;

  return (
    <AppShell>
      <DemoBanner />
      {children}
    </AppShell>
  );
}

