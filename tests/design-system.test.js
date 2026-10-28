import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

describe('shared UI design system', () => {
  it('defines the requested palette, scales, shared classes, and motion preferences', () => {
    const css = read('src/ui/tokens.css');
    for (const token of [
      '--color-green-500: #0D6E52', '--color-green-700: #084A39',
      '--color-gold-400: #E5A93C', '--color-gold-600: #A76F13',
      '--color-sky-400: #FDF8EE', '--color-sky-600: #1E140C',
      '--color-coral-500: #FF5D4A', '--color-coral-700: #C93A2B',
      '--color-cloud: #FDF8EE', '--color-ink: #1E140C', '--color-white: #FDF8EE',
      '--space-1: 4px', '--space-2: 8px', '--space-3: 12px',
      '--space-4: 16px', '--space-6: 24px', '--space-8: 32px',
      '--radius-md: 12px', '--radius-lg: 16px', '--radius-pill: 999px',
      '--motion-fast: 120ms', '--motion-base: 200ms', '--motion-slow: 320ms',
    ]) expect(css).toContain(token);
    for (const component of ['btn-primary', 'btn-secondary', 'btn-danger', 'btn-ghost', 'card', 'pill', 'badge', 'toast']) {
      expect(css).toContain(`.${component}`);
    }
    expect(css).toContain('min-height: 48px');
    expect(css).toContain('translateY(4px)');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('keeps every documented component text pair above 4.5:1', () => {
    const source = read('src/ui/StyleGuide.js');
    const ratios = [...source.matchAll(/'([0-9]+\.[0-9]+):1'/g)].map((match) => Number(match[1]));
    expect(ratios.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  it('self-hosts the Latin variable font and records its licence', () => {
    const tokens = read('src/ui/tokens.css');
    const credits = read('CREDITS.md');
    const fontUrl = new URL('public/fonts/fredoka-latin-variable.woff2', root);
    expect(existsSync(fontUrl)).toBe(true);
    expect(readFileSync(fontUrl).subarray(0, 4).toString()).toBe('wOF2');
    expect(tokens).toContain("font-display: swap");
    expect(tokens).toContain("font-weight: 300 700");
    expect(tokens).toContain('unicode-range:');
    expect(credits).toContain('SIL Open Font License 1.1');
    expect(existsSync(new URL('public/fonts/OFL.txt', root))).toBe(true);
  });

  it('exposes the guide at the styleguide query without initializing gameplay', () => {
    const main = read('src/main.js');
    expect(main).toContain("get('styleguide') === '1'");
    expect(main).toContain('mountStyleGuide()');
  });

  it('bounds the loading screen and progress bar to narrow viewports', () => {
    const css = read('src/ui/screens.css');
    expect(css).toMatch(/\.loading-screen\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100vw;[^}]*max-width:\s*100vw;/s);
    expect(css).toContain('width: min(500px, calc(100vw - 48px))');
    expect(css).toContain('@media (max-width: 380px)');
    expect(css).toMatch(/\.loading-title\s*\{[^}]*font-size:\s*clamp\(1rem, 7\.5vw, 5rem\)/s);
  });
});
