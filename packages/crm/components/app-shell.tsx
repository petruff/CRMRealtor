"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BellRing,
  CalendarCheck,
  CheckSquare,
  Grid2X2,
  KanbanSquare,
  Plug,
  Database,
  Send,
  Sparkles,
  Settings,
  LogOut,
  Users,
  Ellipsis,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BrandLockup,
  BrandMark,
  CyryxAttribution,
} from "@/components/brand-lockup";
import { ThemeToggle } from "@/components/theme-toggle";
import { PRODUCT_NAME } from "@/lib/brand";
import { CrmCommandPalette } from "@/components/crm-command-palette";
import { OmnixAssistantLauncher } from "@/components/omnix-assistant-launcher";

const CORE_NAV = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/activities", label: "Activities", icon: CheckSquare },
] as const;

const BUSINESS_NAV = [
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/omnix", label: "Omnix AI", icon: Sparkles },
] as const;

const OPERATIONS_NAV = [
  { href: "/mailers", label: "Mailers", icon: Send },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/data", label: "Data & API", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const MOBILE_NAV = [...CORE_NAV, ...OPERATIONS_NAV.slice(0, 2)] as const;
const ALL_NAV = [...CORE_NAV, ...BUSINESS_NAV, ...OPERATIONS_NAV] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Mobile-first shell: bottom tab bar on phones (thumb-reachable), a quiet
 * left rail from `lg` up. Tablets keep the full-width field layout and
 * measure and larger display type rather than stretching the phone view.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileUtilitiesOpen, setMobileUtilitiesOpen] = useState(false);
  const mobileUtilitiesTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileUtilitiesRef = useRef<HTMLElement>(null);
  const currentLabel =
    ALL_NAV.find(({ href }) => isActive(pathname, href))?.label ??
    (pathname.startsWith("/workspace") ? "Workspaces" : PRODUCT_NAME);

  useEffect(() => {
    setMobileUtilitiesOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileUtilitiesOpen) return;
    mobileUtilitiesRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
  }, [mobileUtilitiesOpen]);

  const closeMobileUtilities = (returnFocus = true) => {
    setMobileUtilitiesOpen(false);
    if (returnFocus) queueMicrotask(() => mobileUtilitiesTriggerRef.current?.focus());
  };

  const navGroup = (
    label: string,
    items: readonly {
      href: string;
      label: string;
      icon: typeof CalendarCheck;
    }[],
  ) => (
    <div>
      <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">
        {label}
      </p>
      <div className="grid gap-1">
        {items.map(({ href, label: itemLabel, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`sk-nav-link relative flex min-h-11 items-center gap-3 rounded-[var(--sk-control-radius)] px-3 text-sm transition-colors ${
                active
                  ? "bg-accent-soft font-semibold text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon
                className={`size-[18px] shrink-0 ${active ? "text-accent" : ""}`}
                aria-hidden
              />
              {itemLabel}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-[var(--sk-control-radius)] bg-accent px-4 py-2.5 text-sm font-medium text-white transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>
      {/* Desktop rail */}
      <aside className="sk-desktop-rail sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line px-4 py-5 lg:flex">
        <div className="px-2">
          <BrandLockup />
        </div>

        <nav
          aria-label="Primary"
          className="mt-8 flex flex-1 flex-col gap-6 overflow-y-auto pb-4"
        >
          <CrmCommandPalette />
          {navGroup("Core", CORE_NAV)}
          {navGroup("Business", BUSINESS_NAV)}
          {navGroup("Operations", OPERATIONS_NAV)}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-line px-2 pt-3">
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
        {/* Mobile header */}
        <header
          className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-line px-4 backdrop-blur-xl lg:hidden"
          style={{ background: "var(--sk-nav-background)" }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark size={32} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-muted">
                {PRODUCT_NAME}
              </p>
              <p className="truncate text-sm font-semibold leading-tight text-ink">
                {currentLabel}
              </p>
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
              className="fixed inset-x-3 top-[4.5rem] z-30 grid gap-1 rounded-[var(--sk-card-radius)] border border-line bg-surface p-2 shadow-[var(--sk-shadow-md)]"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMobileUtilities();
                }
              }}
            >
              <Link href="/alerts" className="sk-nav-link flex min-h-11 items-center gap-3 rounded-[var(--sk-control-radius)] px-3 text-sm text-ink" aria-current={isActive(pathname, "/alerts") ? "page" : undefined}>
                <BellRing className="size-[18px]" aria-hidden /> Alerts
              </Link>
              <Link href="/settings" className="sk-nav-link flex min-h-11 items-center gap-3 rounded-[var(--sk-control-radius)] px-3 text-sm text-ink" aria-current={isActive(pathname, "/settings") ? "page" : undefined}>
                <Settings className="size-[18px]" aria-hidden /> Settings
              </Link>
              <Link href="/workspace" className="sk-nav-link flex min-h-11 items-center gap-3 rounded-[var(--sk-control-radius)] px-3 text-sm text-ink">
                <Grid2X2 className="size-[18px]" aria-hidden /> Workspaces
              </Link>
              <div className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--sk-control-radius)] px-3 text-sm text-ink">
                <span>Theme</span><ThemeToggle />
              </div>
              <form action="/auth/signout" method="post">
                <button type="submit" className="sk-nav-link flex min-h-11 w-full items-center gap-3 rounded-[var(--sk-control-radius)] px-3 text-left text-sm text-ink">
                  <LogOut className="size-[18px]" aria-hidden /> Sign out
                </button>
              </form>
            </nav>
          ) : null}
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pb-32 pt-6 sm:px-6 md:px-10 lg:px-14 lg:pb-28 lg:pt-12"
        >
          <div className="mx-auto w-full max-w-6xl">
            {children}
            <div className="mt-16 flex justify-center lg:hidden">
              <CyryxAttribution />
            </div>
          </div>
        </main>

        {/* Mobile bottom tabs */}
        <nav
          aria-label="Primary"
          className="safe-bottom fixed inset-x-0 bottom-0 z-20 grid min-h-[4.75rem] grid-cols-5 border-t border-line pt-1.5 backdrop-blur-xl lg:hidden"
          style={{ background: "var(--sk-nav-background)" }}
        >
          {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`sk-mobile-tab flex min-h-11 flex-col items-center justify-center gap-1 rounded-[var(--sk-control-radius)] px-1 text-[11px] transition-colors ${
                  active ? "bg-accent-soft font-semibold text-accent" : "text-subtle hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <Icon
                  className="size-[20px]"
                  strokeWidth={active ? 2.2 : 1.8}
                  aria-hidden
                />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <OmnixAssistantLauncher suppressed={mobileUtilitiesOpen} />
    </div>
  );
}
