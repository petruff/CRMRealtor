import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const welcomeCss = readFileSync(new URL('./welcome/welcome.module.css', import.meta.url), 'utf8');
const loginCss = readFileSync(new URL('./login/login.module.css', import.meta.url), 'utf8');
const connectionsSource = readFileSync(new URL('./connections/page.tsx', import.meta.url), 'utf8');
const brandLockupSource = readFileSync(new URL('../components/brand-lockup.tsx', import.meta.url), 'utf8');
const assistantSource = readFileSync(new URL('../components/omnix-assistant-launcher.tsx', import.meta.url), 'utf8');
const welcomeMotionSource = readFileSync(new URL('../components/welcome-motion.tsx', import.meta.url), 'utf8');
const dataOperationsSource = readFileSync(new URL('./data/page.tsx', import.meta.url), 'utf8');
const nextConfigSource = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
const insightsSource = readFileSync(new URL('../components/insights-dashboard.tsx', import.meta.url), 'utf8');
const propertiesSource = readFileSync(new URL('./properties/page.tsx', import.meta.url), 'utf8');
const appShellSource = readFileSync(new URL('../components/app-shell.tsx', import.meta.url), 'utf8');

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

  it('keeps native controls and dense Insights workspaces inside their available container', () => {
    const input = cssBlock('.sk-input');

    expect(input).toContain('width: 100%;');
    expect(input).toContain('min-width: 0;');
    expect(input).toContain('max-width: 100%;');
    expect(globalCss).toMatch(/input\[type='date'\]\.sk-input,[^{]+\{[^}]*min-inline-size:\s*0;/s);
    expect(globalCss).toContain('container-name: insights-studio;');
    expect(globalCss).toContain('container-name: deal-form;');
    expect(globalCss).toContain('@container insights-studio (max-width: 63.99rem) { .insights-financial-grid');
    expect(globalCss).toContain('.insights-transaction-grid { grid-template-columns: 1fr; }');
    expect(globalCss).toContain('@container deal-form (max-width: 26rem) { .insights-deal-form-row { grid-template-columns: 1fr; }');
    expect(globalCss).toContain('@container (max-width: 63.99rem) { .insights-contributor-controls { grid-template-columns: repeat(2,');
  });

  it('keeps developer-only connection commands out of the realtor-facing data workspace', () => {
    expect(dataOperationsSource).not.toContain('npm run data');
    expect(dataOperationsSource).toContain('Developer tools');
    expect(dataOperationsSource).not.toContain('endpoint.endpoint_key');
    expect(dataOperationsSource).not.toContain('endpoint.auth_mode');
    expect(dataOperationsSource).not.toContain('key.key_prefix');
    expect(dataOperationsSource).not.toContain('key.scopes.join');
    expect(dataOperationsSource).toContain('Incoming automations');
  });

  it('keeps implementation language out of the default realtor-facing Connections experience', () => {
    expect(connectionsSource).not.toContain('Deployment truth');
    expect(connectionsSource).not.toContain('definition.capabilities.join');
    expect(connectionsSource).not.toContain('Encrypted payload reference');
    expect(connectionsSource).not.toContain('Payload SHA-256');
    expect(connectionsSource).not.toContain('Policy ID');
    expect(connectionsSource).not.toContain('Support ref ');
    expect(connectionsSource).not.toContain('controlled UAT');
    expect(connectionsSource).not.toContain('real-number UAT');
    expect(connectionsSource).toContain('Connection controls');
  });

  it('keeps public typography scoped while sharing the authenticated palette', () => {
    expect(globalCss).toContain("@import '@fontsource/cormorant-garamond/500.css';");
    expect(welcomeCss).toContain('--we-primary: var(--sk-button-background);');
    expect(welcomeCss).toContain('--we-canvas: var(--sk-body-background-color);');
    expect(welcomeCss).toContain('--we-foreground: var(--sk-headline-text-color);');
    expect(welcomeCss).toContain('--we-surface: var(--sk-fill-color);');
    expect(welcomeCss).toContain('--we-dark: #181d26;');
    expect(welcomeCss).toContain('--we-on-dark-accent: #79aaff;');
    expect(welcomeCss).not.toContain('--we-primary: #cc785c;');
    expect(welcomeCss).not.toContain('--we-canvas: #faf9f5;');
    expect(welcomeCss).toContain("--we-font-display: 'Cormorant Garamond'");
    expect(welcomeCss).toMatch(/\.landing :global\(\.font-display\)\s*{[^}]*font-family:\s*var\(--we-font-display\);/s);
    expect(welcomeMotionSource.match(/autoAlpha/g)).toHaveLength(5);
    expect(welcomeMotionSource).toContain('autoAlpha: 0.92');
  });

  it('keeps public mobile headers collision-free and preserves a visible sign-in label', () => {
    expect(loginCss).toContain('--auth-primary: var(--sk-button-background);');
    expect(loginCss).toContain('--auth-canvas: var(--sk-body-background-color);');
    expect(loginCss).not.toContain('--auth-primary: #cc785c;');
    expect(welcomeCss).toMatch(/\.brandLink\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(welcomeCss).toMatch(/@media \(max-width:\s*767px\)[\s\S]*\.navSignIn\s*\{[^}]*width:\s*auto;[^}]*overflow:\s*visible;/s);
    expect(welcomeCss).toMatch(/\.navSignIn svg\s*\{[^}]*display:\s*none;/s);
    expect(loginCss).toMatch(/\.header\s*\{[^}]*gap:\s*0\.75rem;[^}]*padding-top:\s*env\(safe-area-inset-top\);/s);
    expect(loginCss).toMatch(/@media \(max-width:\s*560px\)[\s\S]*\.header > a > div > div > p:last-child\s*\{[^}]*display:\s*none;/s);
  });

  it('keeps dense mobile records shrinkable and key actions thumb-sized', () => {
    expect(globalCss).toMatch(/\.sk-group > \*\s*\{[^}]*min-width:\s*0;/s);
    expect(globalCss).toMatch(/\.pipeline-filter-row button\s*\{[^}]*min-height:\s*2\.75rem;/s);
    expect(globalCss).toMatch(/\.insights-stage-chart li > a\s*\{[^}]*min-height:\s*2\.75rem;/s);
    expect(globalCss).toMatch(/body\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*clip;/s);
    expect(nextConfigSource).toContain('qualities: [90, 92]');
  });

  it('reflows the operating-current rail instead of clipping stages on narrow mobile', () => {
    expect(globalCss).toMatch(/@container \(max-width: 29\.99rem\)[\s\S]*\.insights-current-rail\s*{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*overflow:\s*visible;/);
    expect(globalCss).toMatch(/\.insights-current-label\s*{[\s\S]*white-space:\s*normal;/);
    expect(insightsSource).toMatch(/aria-label="Exact pipeline stage contributors"/);
  });

  it('reflows the Today operating brief and removes nonessential motion when requested', () => {
    expect(globalCss).toMatch(/@container \(max-width: 47\.99rem\)[\s\S]*\.today-operating-layout,[\s\S]*\.today-workstream-grid\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(globalCss).toMatch(/\.today-priority-list a\s*\{[^}]*min-height:\s*5\.25rem;/s);
    expect(globalCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.today-operating-briefing\s*\{\s*animation:\s*none;/);
    expect(globalCss).toMatch(/\.today-operating-trust\s*\{[^}]*min-height:\s*2\.75rem;/s);
  });

  it('keeps property authority honest and reachable on desktop and mobile', () => {
    expect(propertiesSource).toContain('MLS/IDX and licensed property feeds remain off');
    expect(propertiesSource).toContain('Unknown information stays unknown.');
    expect(propertiesSource).toContain('propertyFactCanDisplay');
    expect(propertiesSource).not.toContain('estimated value');
    expect(appShellSource.match(/href="\/properties"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(appShellSource).toContain('label: "Properties"');
  });

  it('keeps Connections cards on the centralized 12px radius contract', () => {
    expect(connectionsSource).not.toContain('rounded-[20px]');
    expect(connectionsSource.match(/rounded-\[var\(--sk-card-radius\)\]/g)?.length).toBeGreaterThanOrEqual(8);
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
