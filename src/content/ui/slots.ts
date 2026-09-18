/**
 * Shadow-DOM "slots" FocusSpace renders into. Shadow roots keep our styles out
 * of YouTube and YouTube's styles out of us (YouTube's --yt-spec-* colour
 * variables still inherit, so FocusSpace follows YouTube's theme). React
 * renders once (overlay slot) and portals into the other slots; slots are
 * (re)attached as YouTube re-renders its layout.
 */

export class Slot {
  readonly host: HTMLElement;
  readonly container: HTMLDivElement;

  constructor(name: string, css: string, hostStyle = '') {
    this.host = document.createElement('focusspace-slot');
    this.host.setAttribute('data-slot', name);
    if (hostStyle) this.host.setAttribute('style', hostStyle);
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    this.container = document.createElement('div');
    this.container.className = 'fs-root fs-yt';
    shadow.append(style, this.container);
    // Typing in our inputs must not trigger YouTube's page hotkeys (f = fullscreen, k = play…).
    for (const type of ['keydown', 'keypress', 'keyup']) {
      this.host.addEventListener(type, (event) => {
        const origin = event.composedPath()[0];
        if (origin instanceof HTMLElement && origin.matches('input, textarea, select, [contenteditable="true"]')) event.stopPropagation();
      });
    }
  }

  /** Ensure the host is the first child of `parent`. */
  prepend(parent: Element): void {
    if (parent.firstElementChild !== this.host) parent.insertBefore(this.host, parent.firstChild);
  }

  /** Ensure the host sits in `parent` right before `before` (or last when null). */
  place(parent: Element, before: Element | null): void {
    if (this.host.parentElement === parent && this.host.nextElementSibling === before) return;
    parent.insertBefore(this.host, before);
  }

  detach(): void {
    if (this.host.isConnected) this.host.remove();
  }

  get attached() {
    return this.host.isConnected;
  }

  setTheme(theme: 'light' | 'dark', density: 'comfortable' | 'compact') {
    this.container.setAttribute('data-theme', theme);
    this.container.setAttribute('data-density', density);
  }
}
