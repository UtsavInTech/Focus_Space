/**
 * Scroll reveal for anything marked `data-reveal`: it settles into place the first time it scrolls into
 * view, then stays. One observer for the whole site, plus a MutationObserver so elements that mount
 * later (a route change, a signed-in state) are picked up rather than left invisible.
 *
 * The hidden starting state only exists once this has run (`html.fsw-reveal-ready`), and only for
 * people who have not asked for reduced motion (site.css) — without JavaScript, or without
 * IntersectionObserver, the page is simply all there.
 */
export function startReveal(): void {
  if (typeof IntersectionObserver === 'undefined') return;

  const seen = new WeakSet<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        // An attribute, not a class: React owns `className` and rewrites it when a card's state changes
        // (a plan becoming yours after checkout), which would wipe a class and hide the card again.
        entry.target.setAttribute('data-revealed', '');
        io.unobserve(entry.target);
      }
    },
    // Reveal a little before the element is fully up, so nothing is still fading while being read.
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );

  const scan = (root: ParentNode) => {
    root.querySelectorAll('[data-reveal]').forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      io.observe(el);
    });
  };

  document.documentElement.classList.add('fsw-reveal-ready');
  scan(document);
  new MutationObserver(() => scan(document)).observe(document.body, { childList: true, subtree: true });
}
