#!/usr/bin/env node
/**
 * How FocusSpace is doing: active users, retention and paying users, from the live API.
 *
 *   npm run metrics
 *
 * Reads FOCUSSPACE_ADMIN_TOKEN (the server's ADMIN_TOKEN) from the environment or the local .env,
 * which is gitignored. FOCUSSPACE_API overrides the API address (default https://api.focusspace.xyz).
 */
import { readFileSync } from 'node:fs';

function fromDotEnv(name) {
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

const token = process.env.FOCUSSPACE_ADMIN_TOKEN ?? fromDotEnv('FOCUSSPACE_ADMIN_TOKEN');
const api = process.env.FOCUSSPACE_API ?? fromDotEnv('FOCUSSPACE_API') ?? 'https://api.focusspace.xyz';
if (!token) {
  console.error('Set FOCUSSPACE_ADMIN_TOKEN in .env (the same value as ADMIN_TOKEN on the API).');
  process.exit(1);
}

const res = await fetch(`${api}/v1/admin/metrics`, { headers: { Authorization: `Bearer ${token}` } });
const json = await res.json().catch(() => null);
if (!res.ok || !json?.ok) {
  console.error(`Could not read metrics (HTTP ${res.status}): ${json?.error ?? 'no response'}`);
  process.exit(1);
}
const m = json.metrics;
const pct = (v) => (v === null || v === undefined ? '  …  ' : `${(v * 100).toFixed(0).padStart(3)}%`);

console.log(`\nFocusSpace · ${m.asOf}\n`);
console.log(`Active today        ${m.active.day}`);
console.log(`Active this week    ${m.active.week}   (${m.active.weekSignedIn} signed in)`);
console.log(`Active this month   ${m.active.month}`);
console.log(`Weekly ÷ monthly    ${m.stickiness === null ? '…' : m.stickiness}`);
console.log(`Paying              ${m.paying.total}   ${Object.entries(m.paying.byPlan).map(([p, n]) => `${p} ${n}`).join(' · ') || ''}`);
console.log(`Monthly revenue     ₹${m.paying.mrrInr.toLocaleString('en-IN')} (list price, before GST and fees)`);

const newTotal = m.newInstalls.reduce((a, d) => a + d.n, 0);
console.log(`\nNew installs, last 30 days: ${newTotal}`);
for (const d of m.newInstalls.slice(-10)) console.log(`  ${d.day}  ${'█'.repeat(Math.min(40, d.n))} ${d.n}`);

console.log('\nRetention (of each week’s new installs, how many came back)');
console.log('  week of       new   next day   week 2   month 1');
for (const r of m.retention) console.log(`  ${r.week}  ${String(r.size).padStart(5)}   ${pct(r.day1)}      ${pct(r.day7)}    ${pct(r.day30)}`);
console.log('\n  "…" = too recent to know yet.\n');
