import type { Metadata, Viewport } from 'next';
import { RouteChrome } from '@/components/route-chrome';
import { PwaProvider } from '@/components/pwa-provider';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/brand';
import './globals.css';
import './premium.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3200'),
  title: {
    default: `Today · ${PRODUCT_NAME}`,
    template: `%s · ${PRODUCT_NAME}`,
  },
  applicationName: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: PRODUCT_NAME,
  },
  icons: {
    icon: [
      { url: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Let her zoom. Locking scale on a tool used one-handed in a car is hostile.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#181d26' },
  ],
};

/**
 * Applied before first paint so dark mode never flashes light.
 * Kept inline and tiny for exactly that reason.
 */
const themeInit = `
(function(){try{
  var s=localStorage.getItem('theme');
  var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(d)document.documentElement.classList.add('dark');
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <PwaProvider>
          <RouteChrome>{children}</RouteChrome>
        </PwaProvider>
      </body>
    </html>
  );
}
