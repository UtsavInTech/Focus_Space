/**
 * The usage-accounting period — UTC calendar month, e.g. "2025-06". Computed
 * entirely from the server's own clock, never the client's, per
 * docs/LAYER_2C_USAGE_ENTITLEMENTS.md. Kept to this one function so switching
 * to a rolling window later touches nothing else.
 */
export function currentPeriod(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}
