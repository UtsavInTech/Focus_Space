import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (...parts: string[]) => fileURLToPath(new URL(parts.join('/'), `${import.meta.url.replace(/[^/]*$/, '')}`));

/**
 * Build #4: the public website (focusspace.app) — the marketing home, pricing
 * and FAQ the YouTube launcher opens.
 *
 * Deliberately a separate build from the extension: the site ships to a CDN as
 * plain static files, targets real browsers rather than `chrome110`, and must
 * never accidentally pull a `chrome.*` API into its bundle. It shares only what
 * is genuinely shared — the `--fs-*` design tokens in src/ui/styles.css — via
 * the same `@` alias the extension uses.
 */
export default defineConfig({
  plugins: [react()],
  root: resolve('web'),
  publicDir: resolve('web/public'),
  resolve: { alias: { '@': resolve('src') } },
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
  server: { port: 5174 },
});
