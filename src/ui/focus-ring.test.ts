import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * One focus ring per control.
 *
 * The bug this guards: `:focus-visible { box-shadow: var(--fs-ring) }` is unscoped, so it also hit the
 * bare `<input>` inside the FocusSpace AI composer — which already draws its own focus state. Inside
 * YouTube, where `--fs-ring` was redefined to YouTube's link blue, that produced a 4px blue ring nested
 * inside the composer's violet hairline: visibly two containers where there is one control.
 *
 * CSS cannot be executed here, so this asserts the two things that made it wrong — the opt-out exists
 * and every composite control uses it, and the ring is FocusSpace's colour rather than YouTube's.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const styles = read('./styles.css');
const content = read('../content/ui/content.css');

describe('the global focus ring', () => {
  it('has an opt-out for controls that draw their own focus state', () => {
    expect(styles).toMatch(/\.fs-focus-host :focus-visible\s*\{[^}]*box-shadow:\s*none/);
  });

  it('is used by every composite control that owns a focus state', () => {
    // A container styling :focus-within is, by definition, showing focus for something inside it.
    const composites = ['.fs-ai-composer', '.fs-tags', '.fs-welcome-input'];
    for (const selector of composites) {
      const css = selector === '.fs-tags' ? styles : content;
      expect(css, `${selector} should style its own focus`).toContain(`${selector}:focus-within`);
    }
    // …and each one must be marked as the host in the markup.
    // FocusSpace AI and the guide share one message box (content/ui/Composer.tsx), which marks itself.
    const markup = [read('../content/ui/Composer.tsx'), read('../content/ui/LearningPanel.tsx'), read('./components/TagInput.tsx')].join('\n');
    expect(markup.match(/fs-focus-host/g)?.length).toBe(3);
  });

  it('uses FocusSpace’s accent inside YouTube, not YouTube’s link blue', () => {
    const rings = content.match(/--fs-ring:[^;]+;/g) ?? [];
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) {
      expect(ring).not.toMatch(/#3ea6ff|#065fd4/i);
    }
  });

  it('never stacks a second outline inside the AI panel', () => {
    // The panel is one surface: the dock draws the hairline, nothing inside it draws another.
    expect(content).toMatch(/\.fs-ai-composer:focus-within\s*\{[^}]*inset 0 0 0 1px/);
    expect(content).not.toMatch(/\.fs-ai-composer:focus-within\s*\{[^}]*var\(--fs-ring\)/);
    expect(content).not.toMatch(/\.fs-ai-panel\s*\{[^}]*border:/);
  });
});

describe('the FocusSpace mark', () => {
  it('animates only where it represents something active, and stops for reduced motion', () => {
    expect(styles).toMatch(/\.fs-mark\.is-active \.fs-mark-ring\s*\{\s*animation:/);
    const reduced = styles.slice(styles.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.fs-mark\.is-active \.fs-mark-ring\s*\{\s*animation:\s*none/);
  });

  it('turns slowly enough to read as attention rather than loading', () => {
    const duration = styles.match(/animation: fs-mark-orbit (\d+)s/)?.[1];
    expect(Number(duration)).toBeGreaterThanOrEqual(6);
  });
});
