import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (...parts: string[]) => fileURLToPath(new URL(parts.join('/'), `${import.meta.url.replace(/[^/]*$/, '')}`));

/**
 * Builds #2, #3 and #4: classic IIFE scripts injected into pages.
 *   default mode      → content.js (youtube.com, isolated world: filters, UI, data)
 *   --mode bridge     → bridge.js  (youtube.com, main world: SPA navigation + page config)
 *   --mode site       → site.js    (focusspace.app: announces the extension's id)
 */
export default defineConfig(({ mode }) => {
  const bridge = mode === 'bridge';
  const site = mode === 'site';
  const plain = bridge || site;
  return {
    plugins: plain ? [] : [react()],
    resolve: { alias: { '@': resolve('src') } },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: mode === 'development' ? 'inline' : false,
      target: 'chrome111',
      copyPublicDir: false,
      lib: {
        entry: resolve(site ? 'src/content/site-bridge.ts' : bridge ? 'src/content/bridge/main-world.ts' : 'src/content/index.tsx'),
        formats: ['iife'],
        name: site ? 'FocusSpaceSite' : bridge ? 'FocusSpaceBridge' : 'FocusSpaceContent',
        fileName: () => (site ? 'site.js' : bridge ? 'bridge.js' : 'content.js'),
      },
    },
  };
});
