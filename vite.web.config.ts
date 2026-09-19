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
/** A production site whose "Add to Chrome" goes nowhere is a launch bug — say so on every such build. */
const storeListingWarning = {
  name: 'focusspace-store-listing',
  buildStart() {
    const url = process.env.VITE_CHROME_WEB_STORE_URL ?? '';
    if (!/^https:\/\/chromewebstore\.google\.com\//.test(url)) {
      console.warn('\n⚠  VITE_CHROME_WEB_STORE_URL is not set — every "Add to Chrome" button only scrolls the page.\n   Set it to the listing URL (https://chromewebstore.google.com/detail/…) before the public launch.\n');
    }
  },
};

export default defineConfig({
  plugins: [react(), storeListingWarning],
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
