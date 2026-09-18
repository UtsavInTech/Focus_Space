import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const resolve = (...parts: string[]) => fileURLToPath(new URL(parts.join('/'), `${import.meta.url.replace(/[^/]*$/, '')}`));

/**
 * Build #3: the FocusSpace API server (Layer 2A) — a plain Node ESM bundle.
 * Built with vite, the same tool background.js/content.js already use,
 * rather than adding a second TS runner/bundler: this lets server/*.ts
 * import FocusSpace's own prompt-building code and types straight from
 * src/ via the same "@/" alias the extension uses, instead of duplicating
 * LearningContext/HomepageContext or the prompt builders.
 */
export default defineConfig({
  resolve: { alias: { '@': resolve('src') } },
  build: {
    ssr: resolve('server/index.ts'),
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: { entryFileNames: 'index.mjs', format: 'es' },
    },
  },
});
