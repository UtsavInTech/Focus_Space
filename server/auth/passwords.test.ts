import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords';

describe('passwords', () => {
  it('never stores the plaintext password in the hash output', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(stored).not.toContain('correct horse battery staple');
  });

  it('verifies a correct password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', stored)).toBe(false);
  });

  it('produces a different hash each time (random salt) even for the same password', () => {
    expect(hashPassword('same password')).not.toBe(hashPassword('same password'));
  });

  it('rejects malformed stored values instead of throwing', () => {
    expect(verifyPassword('anything', 'not-a-valid-stored-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
  });
});
