'use client';

import { Check, Download, RefreshCw, Share2, WifiOff, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaContextValue {
  isInstalled: boolean;
  install: () => Promise<void>;
}

const PwaContext = createContext<PwaContextValue | null>(null);

function detectsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

function detectsIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState<ServiceWorkerRegistration | null>(null);
  const reloadForUpdate = useRef(false);
  const installSheetRef = useRef<HTMLElement>(null);
  const installTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setIsInstalled(detectsStandalone());
    setIsIos(detectsIos());
    setIsOnline(navigator.onLine);
    let cancelled = false;
    let removeControllerChange: (() => void) | undefined;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setInstallHelpOpen(false);
      setIsInstalled(true);
    };
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onDisplayMode = () => setIsInstalled(detectsStandalone());
    const displayMode = window.matchMedia('(display-mode: standalone)');

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    displayMode.addEventListener?.('change', onDisplayMode);

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((registration) => {
        if (cancelled) return;
        if (registration.waiting && navigator.serviceWorker.controller) setUpdateReady(registration);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(registration);
          });
        });
        void registration.update();
      }).catch(() => {
        // The CRM remains fully usable when service-worker registration is unavailable.
      });

      const onControllerChange = () => {
        if (!reloadForUpdate.current) return;
        reloadForUpdate.current = false;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      removeControllerChange = () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      displayMode.removeEventListener?.('change', onDisplayMode);
      removeControllerChange?.();
    };
  }, []);

  useEffect(() => {
    if (installHelpOpen) installSheetRef.current?.focus();
  }, [installHelpOpen]);

  const closeInstallHelp = useCallback(() => {
    setInstallHelpOpen(false);
    queueMicrotask(() => installTriggerRef.current?.focus());
  }, []);

  const install = useCallback(async () => {
    if (isInstalled) return;
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstallPrompt(null);
      return;
    }
    installTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInstallHelpOpen(true);
  }, [installPrompt, isInstalled]);

  const applyUpdate = () => {
    const worker = updateReady?.waiting;
    if (!worker) return;
    reloadForUpdate.current = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  const value = useMemo(() => ({ isInstalled, install }), [isInstalled, install]);

  return (
    <PwaContext.Provider value={value}>
      {children}
      {!isOnline ? (
        <div className="pwa-connection-banner" role="status">
          <WifiOff className="size-4" aria-hidden />
          <span><strong>You’re offline.</strong> Client records stay protected; Omnix will reconnect automatically.</span>
        </div>
      ) : null}
      {updateReady ? (
        <div className="pwa-update-banner" role="status">
          <span><strong>A fresh Omnix is ready.</strong> Update without signing out.</span>
          <button type="button" className="sk-secondary-button" onClick={applyUpdate}>
            <RefreshCw className="size-4" aria-hidden /> Update now
          </button>
        </div>
      ) : null}
      {installHelpOpen ? (
        <div className="pwa-install-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeInstallHelp();
        }}>
          <section ref={installSheetRef} tabIndex={-1} className="pwa-install-sheet" role="dialog" aria-modal="true" aria-labelledby="pwa-install-title" onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeInstallHelp();
              return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
            const first = focusable[0];
            const last = focusable.at(-1);
            if (!first || !last) return;
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}>
            <div className="pwa-install-sheet__mark" aria-hidden><Download className="size-5" /></div>
            <div className="min-w-0">
              <p className="eyebrow">Field-ready access</p>
              <h2 id="pwa-install-title">Install Omnix on this device</h2>
              <p>{isIos ? 'In Safari, tap Share and then Add to Home Screen.' : 'Open your browser menu and choose Install app or Add to Home screen.'}</p>
            </div>
            <ol>
              <li><span>1</span><div><strong>{isIos ? 'Tap Share' : 'Open the browser menu'}</strong><small>{isIos ? 'Use the square-and-arrow button.' : 'Look beside the address bar.'}</small></div>{isIos ? <Share2 className="size-5" aria-hidden /> : null}</li>
              <li><span>2</span><div><strong>{isIos ? 'Choose Add to Home Screen' : 'Choose Install app'}</strong><small>Confirm Omnix when your browser asks.</small></div></li>
            </ol>
            <button type="button" className="sk-primary-button" onClick={closeInstallHelp}>Got it</button>
            <button type="button" className="pwa-install-sheet__close" aria-label="Close install instructions" onClick={closeInstallHelp}><X className="size-5" aria-hidden /></button>
          </section>
        </div>
      ) : null}
    </PwaContext.Provider>
  );
}

export function PwaInstallAction() {
  const context = useContext(PwaContext);
  if (!context) return null;

  return (
    <button type="button" className="sk-nav-link flex min-h-11 w-full items-center gap-3 rounded-[var(--sk-control-radius)] px-3 text-left text-sm text-ink" onClick={() => void context.install()} disabled={context.isInstalled}>
      {context.isInstalled ? <Check className="size-[18px]" aria-hidden /> : <Download className="size-[18px]" aria-hidden />}
      {context.isInstalled ? 'Omnix is installed' : 'Install Omnix'}
    </button>
  );
}
