import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * One logo, everywhere.
 *
 * The brand exists in four places that cannot import each other — the extension's components, the
 * website's, the stylesheets' tokens, and the PNG generator that draws the toolbar icon — so the only
 * thing keeping them in step is care. These assert the parts that were actually wrong before: the
 * website shipped a hand-copied icon set that had already drifted, the wordmark was one flat colour
 * everywhere, and the mark was a violet gradient tile that matched nothing.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const BRAND = '#ef4444';
const extensionMark = read('./components/primitives.tsx');
const websiteMark = read('../../web/src/components/Logo.tsx');
const iconScript = read('../../scripts/generate-icons.mjs');

describe('the FocusSpace mark', () => {
  it('is the same geometry in the extension, the website and the icon generator', () => {
    // The play triangle's path is the most distinctive part; if it matches, the marks are the same one.
    const triangle = /M13\.2 11\.5v9a\.85\.85 0 0 0 1\.31\.72l6\.9-4\.5a\.85\.85 0 0 0 0-1\.44l-6\.9-4\.5a\.85\.85 0 0 0-1\.31\.72Z/;
    expect(extensionMark).toMatch(triangle);
    expect(websiteMark).toMatch(triangle);
    // The generator draws rather than copies a path, so it is checked on the radii it shares.
    for (const value of ['12.6', '8.4']) {
      expect(extensionMark).toContain(value);
      expect(websiteMark).toContain(value);
      expect(iconScript).toContain(value);
    }
  });

  it('is the same mark in the website’s tab icon, which is linked at a fresh address', () => {
    const favicon = read('../../web/public/favicon.svg');
    expect(favicon).toContain('M13.2 11.5v9a.85.85 0 0 0 1.31.72l6.9-4.5a.85.85 0 0 0 0-1.44l-6.9-4.5a.85.85 0 0 0-1.31.72Z');
    for (const value of ['12.6', '8.4', 'M16 2v6', 'M24 16h6']) expect(favicon).toContain(value);
    expect(favicon.toLowerCase()).toContain(BRAND);
    // A favicon is cached by its address; the page must link a versioned one, or the old mark lingers.
    expect(read('../../web/index.html')).toMatch(/href="\/favicon\.svg\?v=\d+"/);
  });

  it('has the target’s four crosshair ticks, not just rings', () => {
    for (const source of [extensionMark, websiteMark]) {
      for (const tick of ['M16 2v6', 'M16 24v6', 'M2 16h6', 'M24 16h6']) expect(source).toContain(tick);
    }
  });

  it('keeps no trace of the old violet gradient tile', () => {
    for (const source of [extensionMark, websiteMark, iconScript]) {
      expect(source.toLowerCase()).not.toMatch(/8b7dff|5b47f0|lineargradient/);
    }
  });

  it('can be rendered monochrome for dark or coloured surfaces', () => {
    // "Sometimes we need white": tone='current' is how a surface takes the mark in its own colour.
    for (const source of [extensionMark, websiteMark]) expect(source).toContain("tone === 'brand' ? 'var(--fs-brand)' : undefined");
  });
});

describe('the brand colour', () => {
  it('is defined once per stylesheet, in light and dark', () => {
    for (const path of ['./styles.css', '../content/ui/content.css']) {
      expect((read(path).match(/--fs-brand:/g) ?? []).length).toBe(2);
    }
    expect(read('../../web/src/site.css')).toContain('--fs-brand:');
  });

  it('is the red from the brand sheet, and the icon generator uses the same value', () => {
    expect(read('./styles.css').toLowerCase()).toContain(`--fs-brand: ${BRAND}`);
    expect(read('../../web/src/site.css').toLowerCase()).toContain(`--fs-brand: ${BRAND}`);
    // 0xef, 0x44, 0x44 — the same colour, as bytes.
    expect(iconScript).toMatch(/BRAND = \[0xef, 0x44, 0x44\]/);
  });

  it('is the interactive colour too: every accent is red, and no violet is left behind', () => {
    for (const path of ['./styles.css', '../content/ui/content.css']) {
      const css = read(path);
      const accents = [...css.matchAll(/--fs-accent:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
      expect(accents).toHaveLength(2); // light and dark
      for (const hex of accents) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        expect(r).toBeGreaterThan(180);
        expect(Math.max(g, b)).toBeLessThan(80);
      }
      expect(css.toLowerCase()).not.toMatch(/6d5dfc|8b7dff|a99dff|109, 93, 252|139, 125, 255|169, 157, 255/);
    }
  });

  it('keeps white button text readable on the accent (WCAG AA, 4.5:1)', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const path of ['./styles.css', '../content/ui/content.css']) {
      const css = read(path);
      const accents = [...css.matchAll(/--fs-accent:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]);
      const onAccent = [...css.matchAll(/--fs-on-accent:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]);
      accents.forEach((accent, i) => {
        const [hi, lo] = [luminance(onAccent[i]), luminance(accent)].sort((a, b) => b - a);
        expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});

describe('the wordmark', () => {
  it('splits "Focus" from "Space" so only the second half is red', () => {
    for (const source of [extensionMark, websiteMark]) {
      expect(source).toMatch(/Focus<span className="fs[w]?-wordmark-accent">Space<\/span>/);
    }
    expect(read('./styles.css')).toMatch(/\.fs-wordmark-accent\s*\{\s*color:\s*var\(--fs-brand\)/);
    expect(read('../../web/src/site.css')).toMatch(/\.fsw-wordmark-accent\s*\{\s*color:\s*var\(--fs-brand\)/);
  });

  it('lets "Focus" inherit the surface — black on light, white on dark', () => {
    for (const css of [read('./styles.css'), read('../../web/src/site.css')]) {
      expect(css).toMatch(/wordmark-name\s*\{[^}]*color:\s*inherit/);
    }
  });

  it('is not left as a bare string on any surface', () => {
    const surfaces = [
      '../content/ui/GuideSpaces.tsx',
      '../content/ui/WatchRail.tsx',
      '../../web/src/components/SiteNav.tsx',
      '../../web/src/components/Footer.tsx',
    ];
    for (const path of surfaces) {
      const source = read(path);
      expect(source, path).toContain('<Wordmark />');
      expect(source, path).not.toMatch(/<span>FocusSpace<\/span>/);
    }
  });
});

describe('the generated icons', () => {
  it('are written to both the extension and the website from one source', () => {
    expect(iconScript).toMatch(/OUTS = \[/);
    expect(iconScript).toContain("join(ROOT, 'public', 'icons')");
    expect(iconScript).toContain("join(ROOT, 'web', 'public', 'icons')");
  });
});
