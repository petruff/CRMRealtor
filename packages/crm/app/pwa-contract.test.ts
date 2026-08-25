import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

const serviceWorker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../components/pwa-provider.tsx', import.meta.url), 'utf8');

describe('privacy-safe installable PWA contract', () => {
  it('publishes a complete standalone manifest with any and maskable icons', () => {
    const value = manifest();
    expect(value.display).toBe('standalone');
    expect(value.start_url).toBe('/?source=pwa');
    expect(value.scope).toBe('/');
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]));
    expect(value.shortcuts).toHaveLength(4);
  });

  it('never places authenticated documents, APIs, auth or RSC payloads in the offline cache', () => {
    expect(serviceWorker).toContain("request.mode === 'navigate'");
    expect(serviceWorker).toContain("fetch(request).catch(() => caches.match(OFFLINE_URL))");
    expect(serviceWorker).toContain("url.pathname.startsWith('/api/')");
    expect(serviceWorker).toContain("url.pathname.startsWith('/auth/')");
    expect(serviceWorker).toContain("request.headers.has('RSC')");
    expect(serviceWorker).not.toMatch(/cache\.put\(request[^)]*\).*mode === 'navigate'/s);
  });

  it('registers lifecycle, install, update, offline and safe-area behavior', () => {
    expect(layout).toContain('viewportFit: \'cover\'');
    expect(layout).toContain('<PwaProvider>');
    expect(provider).toContain("navigator.serviceWorker.register('/sw.js'");
    expect(provider).toContain("window.addEventListener('beforeinstallprompt'");
    expect(provider).toContain("window.addEventListener('offline'");
    expect(provider).toContain("worker.postMessage({ type: 'SKIP_WAITING' })");
  });
});
