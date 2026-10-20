import { useEffect, useState } from 'react';

export type Appearance = 'deep' | 'light';
const KEY = 'fs.site.appearance';

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'deep'; }
    catch { return 'deep'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = appearance === 'deep' ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance === 'deep' ? '#0d0d0e' : '#ffffff');
    try { localStorage.setItem(KEY, appearance); } catch { /* Session choice still works without storage. */ }
  }, [appearance]);
  return [appearance, setAppearance] as const;
}
