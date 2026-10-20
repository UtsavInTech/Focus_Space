import { useEffect } from 'react';

const TARGETS = [
  '.fsw-page-head h1', '.fsw-page-head > p', '.fsw-auth-card > h1', '.fsw-auth-sub',
  '.fsw-account-head', '.fsw-account-card > h2', '.fsw-data-card', '.fsw-remove',
  '.fsw-data-plain > div', '.fsw-data-never', '.fsw-credits',
  '.fsw-legal > header', '.fsw-legal > section:not(.fsw-data)',
].join(',');

/** One-shot reveals only. No scroll handlers, RAF loop, or hidden content. */
export function usePageMotion(path: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.getElementById('main');
    if (!root) return;
    const seen = new WeakSet<Element>();
    const touched = new Set<Element>();
    const intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-page-arrived', '');
        intersection.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px 45px 0px', threshold: 0 });
    const observe = (element: Element) => {
      if (seen.has(element)) return;
      seen.add(element);
      touched.add(element);
      const order = element.parentElement ? [...element.parentElement.children].indexOf(element) : 0;
      element.setAttribute('data-page-order', String(Math.min(order, 3)));
      intersection.observe(element);
    };
    const scan = (element: Element) => {
      if (element.matches(TARGETS)) observe(element);
      element.querySelectorAll(TARGETS).forEach(observe);
    };
    scan(root);
    const mutations = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    });
    mutations.observe(root, { subtree: true, childList: true });
    return () => {
      intersection.disconnect();
      mutations.disconnect();
      for (const element of touched) {
        element.removeAttribute('data-page-arrived');
        element.removeAttribute('data-page-order');
      }
    };
  }, [path, enabled]);
}
