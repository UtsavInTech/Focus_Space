/**
 * The cinema look switches YouTube to its own dark theme by setting `html[dark]`. A page that loaded
 * light keeps YouTube's light stylesheet, and a few of its colours are set there with a stronger rule
 * (`:root:root { … }`) than the dark theme's (`[dark] { … }`) — so, untreated, some of YouTube's own
 * buttons end up white text on white (Subscribe, tooltips).
 *
 * This reads YouTube's *own* dark values from its stylesheets and re-applies exactly those variables
 * with a stronger rule, only while FocusSpace turned dark on. It knows no variable names (YouTube's are
 * hashed and change), so it keeps working through YouTube updates; if the pattern ever disappears it
 * simply has nothing to fix.
 */

const STYLE_ID = 'focusspace-cinema-fix';
let lastSheetCount = -1;

function darkOverrides(): string {
  const dark = new Map<string, string>();
  const stuck = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet: not YouTube's theme
    }
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      const selector = (rule as CSSStyleRule).selectorText;
      if (!style || !selector) continue;
      const custom = Array.from(style).filter((p) => p.startsWith('--'));
      if (!custom.length) continue;
      if (selector === '[dark]' || selector === 'html[dark]' || selector === ':root[dark]') custom.forEach((p) => dark.set(p, style.getPropertyValue(p)));
      else if (/^:root:root\b|^html:not\(\[dark\]\)/.test(selector)) custom.forEach((p) => stuck.add(p));
    }
  }
  return [...stuck]
    .filter((p) => dark.has(p))
    .map((p) => `${p}:${dark.get(p)}`)
    .join(';');
}

/** Keeps the fix in step with the page: on while FocusSpace made YouTube dark, gone otherwise. */
export function syncCinemaFix(on: boolean): void {
  const existing = document.getElementById(STYLE_ID);
  if (!on) {
    existing?.remove();
    lastSheetCount = -1;
    return;
  }
  // YouTube loads more stylesheets as you move around; only re-read when that count changes.
  const count = document.styleSheets.length;
  if (existing && count === lastSheetCount) return;
  lastSheetCount = count;
  try {
    const declarations = darkOverrides();
    const style = existing ?? Object.assign(document.createElement('style'), { id: STYLE_ID });
    style.textContent = declarations ? `html[dark]:root:root:root{${declarations}}` : '';
    if (!existing) (document.head ?? document.documentElement).appendChild(style);
  } catch {
    /* never let a cosmetic fix break the page */
  }
}
