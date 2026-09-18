import { createContext, useContext, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/**
 * How FocusSpace UI navigates to YouTube pages.
 *
 * On youtube.com the content script provides YouTube's own SPA router (same
 * tab, instant, back/forward intact). Extension pages provide "reuse the open
 * YouTube tab". Links keep real hrefs, so middle-click / Ctrl-click / "Open in
 * new tab" still work exactly like on YouTube.
 */
export interface Navigator {
  go(url: string): void;
}

export const NavigatorContext = createContext<Navigator>({ go: (url) => location.assign(url) });

export const useNavigator = () => useContext(NavigatorContext);

export function YtLink({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigator = useNavigator();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigator.go(href);
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
