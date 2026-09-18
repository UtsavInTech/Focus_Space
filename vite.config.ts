import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (...parts: string[]) => fileURLToPath(new URL(parts.join('/'), `${import.meta.url.replace(/[^/]*$/, '')}`));

/**
 * Build #1: extension pages (popup, dashboard) and the background service worker.
 * The service worker is emitted as an ES module (manifest: "type": "module").
 * The content script is built separately as a classic IIFE (see vite.content.config.ts),
 * because Chrome does not load content scripts as modules.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: { alias: { '@': resolve('src') } },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: mode !== 'development',
    sourcemap: mode === 'development' ? 'inline' : false,
    target: 'chrome110',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve('popup.html'),
        dashboard: resolve('dashboard.html'),
        background: resolve('src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
}));
