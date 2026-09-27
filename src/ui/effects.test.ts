import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * An effect may return a cleanup function or nothing — anything else crashes React when it tries to
 * "clean up" with it, and without an error boundary that takes every FocusSpace surface on the page
 * down at once.
 *
 * The bug this guards: `useEffect(() => end.current?.scrollIntoView(…))`. `scrollIntoView` used to
 * return undefined; Chrome now returns a Promise, so the welcome guide blanked YouTube the moment its
 * chat scrolled. Browser APIs keep gaining return values like this, so an effect that calls one must
 * use a block body.
 */

const root = new URL('..', import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

describe('effects return a cleanup function or nothing', () => {
  it('never returns a DOM or network call from an expression-bodied effect', () => {
    const risky = /use(Layout)?Effect\(\(\) => [^{(\n][^\n]*?\.(scrollIntoView|scrollTo|scrollBy|scroll|animate|play|focus|requestFullscreen|showPicker)\(|use(Layout)?Effect\(\(\) => [^{(\n][^\n]*?\b(fetch|sendMessage)\(/;
    const offenders = files(root).filter((file) => risky.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });
});
