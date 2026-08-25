import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Omnix Realtor CRM',
    short_name: 'Omnix',
    description: 'A private relationship command center for real estate.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    background_color: '#181d26',
    theme_color: '#181d26',
    orientation: 'any',
    lang: 'en-US',
    categories: ['business', 'productivity'],
    prefer_related_applications: false,
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today', short_name: 'Today', description: 'Open today’s priorities', url: '/?source=pwa-shortcut', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
      { name: 'Contacts', short_name: 'Contacts', description: 'Open the relationship book', url: '/contacts?source=pwa-shortcut', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
      { name: 'Activities', short_name: 'Activities', description: 'Open follow-up work', url: '/activities?source=pwa-shortcut', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
      { name: 'Pipeline', short_name: 'Pipeline', description: 'Open the real estate pipeline', url: '/pipeline?source=pwa-shortcut', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
