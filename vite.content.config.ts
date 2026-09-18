import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (...parts: string[]) => fileURLToPath(new URL(parts.join('/'), `${import.meta.url.replace(/[^/]*$/, '')}`));

/**
 * Builds #2 and #3: classic IIFE scripts that run on youtube.com.
 *   default mode      → content.js (isolated world: filters, UI, data)
 *   --mode bridge     → bridge.js  (main world: YouTube SPA navigation + page config)
 */
export default defineConfig(({ mode }) => {
  const bridge = mode === 'bridge';
  return {
    plugins: bridge ? [] : [react()],
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
        entry: resolve(bridge ? 'src/content/bridge/main-world.ts' : 'src/content/index.tsx'),
        formats: ['iife'],
        name: bridge ? 'FocusSpaceBridge' : 'FocusSpaceContent',
        fileName: () => (bridge ? 'bridge.js' : 'content.js'),
      },
    },
  };
});
