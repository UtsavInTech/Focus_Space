import { useEffect, useState } from 'react';

/** Minimal hash router — the dashboard is a single extension page. */

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function readRoute(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(search) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string) {
  location.hash = to;
}
