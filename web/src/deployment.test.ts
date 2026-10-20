import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../public/appearance-init.js', import.meta.url), 'utf8');

describe('production appearance bootstrap', () => {
  it('uses a local external script compatible with the production CSP', () => {
    expect(html).toContain('src="/appearance-init.js"');
    expect(html).not.toMatch(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);
  });
  it('restores Light before the app renders', () => {
    const document = { documentElement: { dataset: { theme: 'dark' } } };
    runInNewContext(bootstrap, { document, localStorage: { getItem: () => 'light' } });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('keeps Deep and does not crash when browser storage is blocked', () => {
    const document = { documentElement: { dataset: { theme: 'dark' } } };
    expect(() => runInNewContext(bootstrap, { document, localStorage: { getItem: () => { throw new Error('storage blocked'); } } })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
