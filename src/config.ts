/**
 * Where the deployed FocusSpace lives.
 *
 * One constant, because three surfaces need it and none of them should hold
 * their own copy: the extension opens the site, the site links back to the
 * extension, and the account layer only attaches a bearer token to an AI
 * endpoint that shares an origin with `settings.api.baseUrl` (see
 * docs/LAYER_2C_USAGE_ENTITLEMENTS.md, "Extension wiring").
 *
 * Overridable at build time so a staging build can point somewhere else
 * without a code change:
 *
 *   VITE_SITE_URL=https://staging.focusspace.xyz npm run build
 */

const fromEnv = (key: string): string | undefined => {
  const value = import.meta.env?.[key];
  return typeof value === 'string' && value ? value.replace(/\/$/, '') : undefined;
};

/** The public website — the home, pricing and FAQ pages. */
export const SITE_URL = fromEnv('VITE_SITE_URL') ?? 'https://focusspace.xyz';

/** The deployed API. Empty means "not deployed yet"; the extension then falls back to whatever the learner configured in Settings. */
export const API_URL = fromEnv('VITE_API_URL') ?? '';

export const siteUrl = (path = '/'): string => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
