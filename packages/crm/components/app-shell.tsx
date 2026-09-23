"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronDown, Ellipsis, Inbox, LogOut, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandLockup, BrandMark, CyryxAttribution } from "@/components/brand-lockup";
import { CaptureSheet } from "@/components/capture-sheet";
import { NAV_ICONS } from "@/components/nav-icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { PRODUCT_NAME } from "@/lib/brand";
import { CrmCommandPalette } from "@/components/crm-command-palette";
import { OmnixAssistantLauncher } from "@/components/omnix-assistant-launcher";
import { PwaInstallAction } from "@/components/pwa-provider";
import { parentRouteNavigation } from "@/lib/application/route-navigation";
import {
  HUBS,
  MOBILE_HUBS,
  MORE_SECTIONS,
  activeHub,
  activeTab,
  currentLabel as navigationLabel,
  isLinkActive,
  type Hub,
} from "@/lib/application/app-navigation";
import { inboxBadgeAction } from "@/app/inbox/actions";

type InboxBadge = { total: number; urgent: number } | undefined;

function Badge({ badge, compact = false }: { badge: InboxBadge; compact?: boolean }) {
  if (!badge || badge.total === 0) return null;
  const label = badge.total > 99 ? "99+" : String(badge.total);
  return (
    <span
      className={`ox-badge ${badge.urgent ? "is-urgent" : ""} ${compact ? "is-compact" : ""}`}
      aria-label={`${badge.total} waiting${badge.urgent ? `, ${badge.urgent} urgent` : ""}`}
    >
      {label}
    </span>
  );
}

/**
 * Premium shell for an independent realtor.
 *
 * Desktop: a calm command rail with five hubs, a primary "New" capture action,
 * global search, and a collapsible "More" drawer for everything that is not
 * daily work. Nested hub pages get sibling tabs above the content.
 * Phones: a focused top bar and a thumb-reachable tab bar built around a
 * raised Capture button.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const parentRoute = parentRouteNavigation(pathname);
  const hub = activeHub(pathname);
  const tab = activeTab(pathname, hub);
  const [moreOpen, setMoreOpen] = useState(() => MORE_SECTIONS.some((section) => section.links.some((link) => isLinkActive(pathname, link))));
  const [mobileUtilitiesOpen, setMobileUtilitiesOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [badge, setBadge] = useState<InboxBadge>(undefined);
  const mobileUtilitiesTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileUtilitiesRef = useRef<HTMLElement>(null);
  const captureTriggerRef = useRef<HTMLElement | null>(null);
  const currentLabel =
    parentRoute?.currentLabel ??
    navigationLabel(pathname) ??
    (pathname.startsWith("/workspace") ? "Workspaces" : PRODUCT_NAME);

  useEffect(() => {
    setMobileUtilitiesOpen(false);
    setCaptureOpen(false);
  }, [pathname]);

  const badgeCheckedAt = useRef(0);
  useEffect(() => {
    // The count is a hint, not a ledger: refresh at most once a minute, and
    // always when the realtor is inside the Inbox hub.
    const inInbox = activeHub(pathname)?.id === "inbox";
    if (!inInbox && Date.now() - badgeCheckedAt.current < 60_000) return;
    badgeCheckedAt.current = Date.now();
    let active = true;
    inboxBadgeAction().then((value) => { if (active) setBadge(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    if (!mobileUtilitiesOpen) return;
    mobileUtilitiesRef.current?.querySelector<HTMLElement>("a[href], button:not([disabled])")?.focus();
  }, [mobileUtilitiesOpen]);

  const openCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    captureTriggerRef.current = event.currentTarget;
    setCaptureOpen(true);
  }, []);
  const closeCapture = useCallback(() => {
    setCaptureOpen(false);
    queueMicrotask(() => captureTriggerRef.current?.focus());
  }, []);

  const closeMobileUtilities = (returnFocus = true) => {
    setMobileUtilitiesOpen(false);
    if (returnFocus) queueMicrotask(() => mobileUtilitiesTriggerRef.current?.focus());
  };

  const hubLink = (item: Hub) => {
    const Icon = NAV_ICONS[item.icon];
    const active = hub?.id === item.id;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`sk-nav-link ox-rail-link ${active ? "is-active bg-accent-soft font-semibold text-accent" : ""}`}
        title={item.description}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden />
        <span className="flex-1">{item.label}</span>
        {item.id === "inbox" ? <Badge badge={badge} /> : null}
      </Link>
    );
  };

  return (
    <div className="ox-app min-h-dvh lg:flex">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-[var(--sk-control-radius)] bg-accent px-4 py-2.5 text-sm font-medium text-white transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      {/* Desktop command rail */}
      <aside className="sk-desktop-rail ox-rail sticky top-0 hidden h-dvh w-[17rem] shrink-0 flex-col lg:flex">
        <div className="ox-rail-brand">
          <Link href="/" aria-label={`${PRODUCT_NAME} — Today`} className="rounded-[var(--sk-control-radius)]">
            <BrandLockup compact />
          </Link>
        </div>

        <div className="ox-rail-actions">
          <button type="button" className="sk-primary-button ox-new-button" onClick={openCapture} aria-haspopup="dialog">
            <Plus className="size-4" aria-hidden /> New
          </button>
          <CrmCommandPalette />
        </div>

        <nav aria-label="Primary" className="ox-rail-nav">
          <div className="grid gap-0.5">{HUBS.map(hubLink)}</div>

          <div className="ox-rail-more">
            <button
              type="button"
              className="ox-rail-more-toggle"
              aria-expanded={moreOpen}
              aria-controls="rail-more"
              onClick={() => setMoreOpen((value) => !value)}
            >
              <span>More</span>
              <ChevronDown className={`size-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {moreOpen ? (
              <div id="rail-more" className="grid gap-4 pt-2">
                {MORE_SECTIONS.map((section) => (
                  <div key={section.label}>
                    <p className="ox-rail-section-label">{section.label}</p>
                    <div className="grid gap-0.5">
                      {section.links.map((link) => {
                        const Icon = NAV_ICONS[link.icon];
                        const active = isLinkActive(pathname, link);
                        return (
                          <Link
                            key={link.href}
                            href={link.href}
                            aria-current={active ? "page" : undefined}
                            className={`sk-nav-link ox-rail-link is-secondary ${active ? "is-active bg-accent-soft font-semibold text-accent" : ""}`}
                          >
                            <Icon className="size-4 shrink-0" aria-hidden />
                            {link.label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="ox-rail-footer">
          <CyryxAttribution />
          <div className="flex items-center gap-1">
            <form action="/auth/signout" method="post">
              <button type="submit" className="sk-icon-button" aria-label="Sign out">
                <LogOut className="size-[18px]" aria-hidden />
              </button>
            </form>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone and tablet top bar */}
        <header className="safe-top ox-topbar sticky top-0 z-20 flex min-h-16 items-center justify-between px-4 lg:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            {parentRoute ? (
              <Link href={parentRoute.href} className="sk-icon-button shrink-0" aria-label={`Back to ${parentRoute.label}`}>
                <ArrowLeft className="size-[18px]" aria-hidden />
              </Link>
            ) : (
              <BrandMark size={30} />
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-muted">{PRODUCT_NAME}</p>
              <p className="truncate text-[15px] font-semibold leading-tight text-ink">{currentLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <CrmCommandPalette compact />
            <button
              ref={mobileUtilitiesTriggerRef}
              type="button"
              className="sk-icon-button"
              aria-label="More utilities"
              aria-haspopup="true"
              aria-expanded={mobileUtilitiesOpen}
              aria-controls="mobile-utilities"
              onClick={() => setMobileUtilitiesOpen((value) => !value)}
            >
              <Ellipsis className="size-[18px]" aria-hidden />
            </button>
          </div>
          {mobileUtilitiesOpen ? (
            <nav
              ref={mobileUtilitiesRef}
              id="mobile-utilities"
              aria-label="Mobile utilities"
              className="pwa-mobile-utilities ox-mobile-more fixed inset-x-3 z-30 grid gap-3 rounded-[var(--sk-card-radius)] border border-line bg-surface p-3"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMobileUtilities();
                }
              }}
            >
              <div>
                <p className="ox-rail-section-label">Deals</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(HUBS.find((item) => item.id === "deals")?.tabs ?? []).map((link) => {
                    const Icon = NAV_ICONS[link.icon];
                    return (
                      <Link key={link.href} href={link.href} className="sk-nav-link ox-tile-link" aria-current={isLinkActive(pathname, link) ? "page" : undefined}>
                        <Icon className="size-5" aria-hidden /> {link.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
              {MORE_SECTIONS.map((section) => (
                <div key={section.label}>
                  <p className="ox-rail-section-label">{section.label}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {section.links.map((link) => {
                      const Icon = NAV_ICONS[link.icon];
                      return (
                        <Link key={link.href} href={link.href} className="sk-nav-link ox-rail-link is-secondary" aria-current={isLinkActive(pathname, link) ? "page" : undefined}>
                          <Icon className="size-4 shrink-0" aria-hidden /> {link.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="grid gap-1 border-t border-line pt-2">
                <PwaInstallAction />
                <div className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--sk-control-radius)] px-3 text-sm text-ink">
                  <span>Theme</span><ThemeToggle />
                </div>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="sk-nav-link ox-rail-link is-secondary w-full text-left">
                    <LogOut className="size-4" aria-hidden /> Sign out
                  </button>
                </form>
              </div>
            </nav>
          ) : null}
        </header>

        <main id="main-content" tabIndex={-1} className="ox-main min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl">
            {hub?.tabs && !parentRoute ? (
              <nav aria-label={`${hub.label} sections`} className="ox-hub-tabs sk-overflow-rail">
                {hub.tabs.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  const active = tab?.href === item.href;
                  return (
                    <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`ox-hub-tab ${active ? "is-active" : ""}`}>
                      <Icon className="size-4" aria-hidden />
                      {item.label}
                      {item.href === "/inbox" ? <Badge badge={badge} compact /> : null}
                    </Link>
                  );
                })}
              </nav>
            ) : null}
            {children}
            <div className="mt-16 flex justify-center lg:hidden">
              <CyryxAttribution />
            </div>
          </div>
        </main>

        {/* Phone tab bar */}
        <nav aria-label="Primary" className="safe-bottom ox-tabbar fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 lg:hidden">
          {MOBILE_HUBS.slice(0, 2).map((id) => <MobileTab key={id} id={id} pathname={pathname} badge={badge} />)}
          <div className="grid place-items-center">
            <button type="button" className="ox-capture-fab" onClick={openCapture} aria-label="Quick capture" aria-haspopup="dialog">
              <Plus className="size-6" aria-hidden />
            </button>
          </div>
          {MOBILE_HUBS.slice(2).map((id) => <MobileTab key={id} id={id} pathname={pathname} badge={badge} />)}
        </nav>
      </div>

      <CaptureSheet open={captureOpen} onClose={closeCapture} />
      <OmnixAssistantLauncher suppressed={mobileUtilitiesOpen || captureOpen} />
    </div>
  );
}

function MobileTab({ id, pathname, badge }: { id: Hub["id"]; pathname: string; badge: InboxBadge }) {
  const item = HUBS.find((entry) => entry.id === id);
  if (!item) return null;
  const Icon = id === "inbox" ? Inbox : NAV_ICONS[item.icon];
  const active = activeHub(pathname)?.id === id;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`sk-mobile-tab ox-mobile-tab ${active ? "is-active bg-accent-soft font-semibold text-accent" : ""}`}
    >
      <span className="relative">
        <Icon className="size-[21px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
        {id === "inbox" ? <Badge badge={badge} compact /> : null}
      </span>
      {item.label}
    </Link>
  );
}
