import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken } from './tokens';

const SECRET = 'a'.repeat(32);

describe('access tokens', () => {
  it('round-trips a valid, unexpired token', () => {
    const now = Date.now();
    const token = signAccessToken({ sub: 'user-1', sid: 'session-1', exp: now + 60_000 }, SECRET);
    expect(verifyAccessToken(token, SECRET, now)).toEqual({ sub: 'user-1', sid: 'session-1', exp: now + 60_000 });
  });

  it('rejects a token verified with the wrong secret', () => {
    const now = Date.now();
    const token = signAccessToken({ sub: 'user-1', sid: 'session-1', exp: now + 60_000 }, SECRET);
    expect(verifyAccessToken(token, 'b'.repeat(32), now)).toBeNull();
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    const token = signAccessToken({ sub: 'user-1', sid: 'session-1', exp: now - 1 }, SECRET);
    expect(verifyAccessToken(token, SECRET, now)).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const now = Date.now();
    const token = signAccessToken({ sub: 'user-1', sid: 'session-1', exp: now + 60_000 }, SECRET);
    const [body, signature] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ sub: 'user-2', sid: 'session-1', exp: now + 60_000 })).toString('base64url');
    expect(verifyAccessToken(`${forgedBody}.${signature}`, SECRET, now)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('never throws on garbage input', () => {
    expect(verifyAccessToken('', SECRET)).toBeNull();
    expect(verifyAccessToken('not-a-token', SECRET)).toBeNull();
    expect(verifyAccessToken('a.b.c', SECRET)).toBeNull();
    expect(verifyAccessToken('%%%.###', SECRET)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('generates high-entropy, unique tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
  });

  it('hashes deterministically so a stored hash can be matched against a presented token', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('never stores the raw refresh token value in its hash', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).not.toBe(token);
  });
});
