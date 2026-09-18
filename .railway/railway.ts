import { defineRailway, project, service } from 'railway/iac';

/**
 * Railway infrastructure for the FocusSpace API.
 *
 * The API is a single Node process with a SQLite file beside it, so there is
 * one service and no managed database. That file is the reason the volume in
 * DEPLOY.md is not optional: a container filesystem does not survive a
 * redeploy, so without it every deploy would delete every account.
 *
 * Secrets (OPENROUTER_API_KEY, AUTH_TOKEN_SECRET, RESEND_API_KEY) are set in
 * Railway, never here — this file is committed.
 */
export const partial = 'focusspace-api';

export default defineRailway(() => {
  const api = service('focusspace-api', {
    build: 'npm run build:server',
    start: 'node dist-server/index.mjs',
    // The route is unauthenticated and reports only "up and configured" — see server/index.ts.
    healthcheck: '/v1/health',
    healthcheckTimeout: 60,
  });
  return project('focusspace', { resources: [api] });
});
