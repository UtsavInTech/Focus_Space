import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityDb } from '../auth/db';
import { clientIp } from '../http';
import { UsageDb } from './db';
import { ANON_ADDRESS_DAILY_CEILING, ANON_DAILY_AI_UNITS, anonymousKeys, assertAnonymousAllowed, parseInstallId, recordAnonymous } from './service';

/**
 * Signed-out AI is for students — often thirty of them behind one hostel address. The allowance is per
 * install, with a per-address ceiling underneath so made-up install ids cannot farm it.
 */

let dir: string;
let identity: IdentityDb;
let db: UsageDb;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focusspace-anon-test-'));
  identity = new IdentityDb(join(dir, 'test.db'));
  db = new UsageDb(join(dir, 'test.db'));
});
afterEach(() => {
  identity.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const HOSTEL = '203.0.113.7';
const use = (keys: ReturnType<typeof anonymousKeys>, n: number) => {
  for (let i = 0; i < n; i++) {
    assertAnonymousAllowed(db, keys, 'chat');
    recordAnonymous(db, keys, 'chat');
  }
};

describe('signed-out AI allowance', () => {
  it('students sharing one address each get their own daily allowance', () => {
    const first = anonymousKeys(HOSTEL, randomUUID(), 'secret');
    const second = anonymousKeys(HOSTEL, randomUUID(), 'secret');
    use(first, ANON_DAILY_AI_UNITS);
    expect(() => assertAnonymousAllowed(db, first, 'chat')).toThrow(/without an account today/);
    expect(() => use(second, ANON_DAILY_AI_UNITS)).not.toThrow();
  });

  it('minting install ids stops at the address ceiling', () => {
    let spent = 0;
    expect(() => {
      while (spent < ANON_ADDRESS_DAILY_CEILING + 50) {
        use(anonymousKeys(HOSTEL, randomUUID(), 'secret'), 1);
        spent++;
      }
    }).toThrow(/busy on your network/);
    expect(spent).toBe(ANON_ADDRESS_DAILY_CEILING);
  });

  it('without an install id, the address itself is the allowance — as before', () => {
    const keys = anonymousKeys(HOSTEL, null, 'secret');
    expect(keys.ceiling).toBeNull();
    use(keys, ANON_DAILY_AI_UNITS);
    expect(() => assertAnonymousAllowed(db, keys, 'chat')).toThrow();
  });

  it('only a well-formed random install id is accepted', () => {
    const id = randomUUID();
    expect(parseInstallId(id)).toBe(id);
    expect(parseInstallId(id.toUpperCase())).toBe(id);
    for (const bad of ['', 'abc', 'x'.repeat(36), null, 42, `${id}-extra`]) expect(parseInstallId(bad)).toBeNull();
  });
});

describe('the caller’s address behind a proxy', () => {
  const req = (headers: Record<string, string>, remoteAddress = '10.0.0.1') => ({ headers, socket: { remoteAddress } });

  it('behind the proxy, the proxy’s record of the client is used — not the proxy’s own address', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.4' }), true)).toBe('198.51.100.4');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 198.51.100.4' }), true)).toBe('198.51.100.4');
  });

  it('the first X-Forwarded-For entry is the client’s own claim, never trusted over the proxy’s', () => {
    expect(clientIp(req({ 'x-forwarded-for': 'spoofed, 198.51.100.4' }), true)).not.toBe('spoofed');
  });

  it('without a proxy, forwarding headers are ignored — anyone could send them', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.4', 'x-forwarded-for': '198.51.100.4' }), false)).toBe('10.0.0.1');
  });
});
