import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const welcomeCss = readFileSync(new URL('./welcome/welcome.module.css', import.meta.url), 'utf8');
const connectionsSource = readFileSync(new URL('./connections/page.tsx', import.meta.url), 'utf8');
const brandLockupSource = readFileSync(new URL('../components/brand-lockup.tsx', import.meta.url), 'utf8');
const assistantSource = readFileSync(new URL('../components/omnix-assistant-launcher.tsx', import.meta.url), 'utf8');

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = globalCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  const body = match?.[1];
  if (body === undefined) throw new Error(`Missing CSS block: ${selector}`);
  return body;
}

describe('authenticated editorial design contract', () => {
  it('keeps the user-approved light tokens exact and blue primary authoritative', () => {
    const root = cssBlock(':root');

    expect(root).toContain('--sk-body-background-color: #ffffff;');
    expect(root).toContain('--sk-card-background: #ffffff;');
    expect(root).toContain('--sk-body-text-color: #181d26;');
    expect(root).toContain('--sk-muted-text-color: #666666;');
    expect(root).toContain('--sk-border-color: #e0e2e6;');
    expect(root).toContain('--sk-accent-color: #1b61c9;');
    expect(root).toContain('--sk-button-background: #1b61c9;');
    expect(root).toContain('--sk-body-link-color: #1b61c9;');
    expect(root).toContain('--sk-focus-color: #1b61c9;');
    expect(root).toContain('--sk-card-radius: 0.75rem;');
    expect(root).toContain('--sk-control-radius: 0.5rem;');
  });

  it('uses Inter for authenticated display and preserves an accessible dark companion', () => {
    const theme = cssBlock('@theme inline');
    const dark = cssBlock('.dark');

    expect(theme).toContain("--font-display: 'Inter'");
    expect(theme).toContain('--radius-lg: 0.5rem;');
    expect(theme).toContain('--radius-xl: 0.75rem;');
    expect(theme).toContain('--radius-2xl: 0.75rem;');
    expect(dark).toContain('--sk-body-background-color: #181d26;');
    expect(dark).toContain('--sk-card-background: #1d1f25;');
    expect(dark).toContain('--sk-body-text-color: #ffffff;');
    expect(dark).toContain('--sk-button-background: #1b61c9;');
  });

  it('defines accessible primitives and non-color navigation indicators centrally', () => {
    expect(globalCss).toMatch(/\.sk-primary-button\s*{[^}]*min-height:\s*2\.75rem;[^}]*border-radius:\s*var\(--sk-control-radius\);/s);
    expect(globalCss).toMatch(/\.sk-secondary-button\s*{[^}]*min-height:\s*2\.75rem;[^}]*border:\s*1px solid var\(--sk-control-border-color\);/s);
    expect(globalCss).toMatch(/\.sk-icon-button\s*{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;[^}]*border-radius:\s*9999px;/s);
    expect(globalCss).toContain('.sk-secondary-on-dark');
    expect(globalCss).toContain('.sk-legal-button');
    expect(globalCss).toContain('.sk-pill-button');
    expect(globalCss).toMatch(/\.sk-button-primary:hover\s*{[^}]*background:\s*var\(--sk-button-background-hover\);/s);
    expect(globalCss).toMatch(/\.sk-button-secondary:hover\s*{[^}]*border-color:\s*var\(--sk-accent-color\);/s);
    expect(globalCss).toMatch(/\.sk-nav-link\[aria-current='page'\]\s*{[^}]*box-shadow:\s*inset 3px 0 var\(--sk-accent-color\);/s);
    expect(globalCss).toMatch(/\.sk-mobile-tab\[aria-current='page'\]\s*{[^}]*box-shadow:\s*inset 0 -3px var\(--sk-accent-color\);/s);
    expect(globalCss).toMatch(/\.sk-overflow-rail\s*{[^}]*overflow-x:\s*auto;/s);
  });

  it('keeps the public welcome contract scoped and unchanged', () => {
    expect(globalCss).toContain("@import '@fontsource/cormorant-garamond/500.css';");
    expect(welcomeCss).toContain('--we-primary: #cc785c;');
    expect(welcomeCss).toContain('--we-canvas: #faf9f5;');
    expect(welcomeCss).toContain("--we-font-display: 'Cormorant Garamond'");
    expect(welcomeCss).toMatch(/\.landing :global\(\.font-display\)\s*{[^}]*font-family:\s*var\(--we-font-display\);/s);
  });

  it('keeps Connections cards on the centralized 12px radius contract', () => {
    expect(connectionsSource).not.toContain('rounded-[20px]');
    expect(connectionsSource.match(/rounded-\[var\(--sk-card-radius\)\]/g)).toHaveLength(12);
    expect(cssBlock(':root')).toContain('--sk-card-radius: 0.75rem;');
  });

  it('applies the Omnix blue identity to the platform mark and assistant avatar', () => {
    expect(cssBlock('.omnix-brand-mark')).toContain('background: var(--sk-accent-color);');
    expect(cssBlock('.omnix-brand-mark')).toContain("mask: url('/omnix-mark.png')");
    expect(brandLockupSource).toContain('className="omnix-brand-mark shrink-0"');
    expect(assistantSource.match(/\/omnix-assistant-blue\.png/g)).toHaveLength(2);
    expect(assistantSource).not.toContain('/omnix-assistant-v1.png');
  });
});
