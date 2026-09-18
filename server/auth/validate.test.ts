import { describe, expect, it } from 'vitest';
import { ApiError } from '../http';
import { normalizeEmail, validateCredentials, validateRefreshRequest } from './validate';

const badRequest = (fn: () => unknown): ApiError => {
  try {
    fn();
    throw new Error('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
};

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Alice@Example.COM  ')).toBe('alice@example.com');
  });
});

describe('validateCredentials', () => {
  it('accepts a valid email/password and normalizes the email', () => {
    expect(validateCredentials({ email: ' A@B.com ', password: 'password1' })).toEqual({ email: 'a@b.com', password: 'password1' });
  });

  it('rejects a non-object body', () => {
    expect(badRequest(() => validateCredentials(null)).code).toBe('invalid_request');
    expect(badRequest(() => validateCredentials('a string')).code).toBe('invalid_request');
    expect(badRequest(() => validateCredentials([1, 2])).code).toBe('invalid_request');
  });

  it('rejects a missing or malformed email', () => {
    expect(badRequest(() => validateCredentials({ password: 'password1' })).code).toBe('invalid_request');
    expect(badRequest(() => validateCredentials({ email: 'not-an-email', password: 'password1' })).code).toBe('invalid_request');
    expect(badRequest(() => validateCredentials({ email: '   ', password: 'password1' })).code).toBe('invalid_request');
  });

  it('rejects an oversized email', () => {
    const huge = `${'a'.repeat(250)}@example.com`;
    expect(badRequest(() => validateCredentials({ email: huge, password: 'password1' })).code).toBe('invalid_request');
  });

  it('rejects a missing or too-short password', () => {
    expect(badRequest(() => validateCredentials({ email: 'a@b.com' })).code).toBe('invalid_request');
    expect(badRequest(() => validateCredentials({ email: 'a@b.com', password: 'short' })).code).toBe('invalid_request');
  });

  it('rejects an over-long password', () => {
    expect(badRequest(() => validateCredentials({ email: 'a@b.com', password: 'x'.repeat(201) })).code).toBe('invalid_request');
  });

  it('accepts the boundary password lengths (8 and 200 chars)', () => {
    expect(validateCredentials({ email: 'a@b.com', password: 'x'.repeat(8) }).password).toHaveLength(8);
    expect(validateCredentials({ email: 'a@b.com', password: 'x'.repeat(200) }).password).toHaveLength(200);
  });
});

describe('validateRefreshRequest', () => {
  it('accepts a well-formed refresh token', () => {
    expect(validateRefreshRequest({ refreshToken: 'abc123' })).toEqual({ refreshToken: 'abc123' });
  });

  it('rejects a missing, empty, or non-string refreshToken', () => {
    expect(badRequest(() => validateRefreshRequest({})).code).toBe('invalid_request');
    expect(badRequest(() => validateRefreshRequest({ refreshToken: '' })).code).toBe('invalid_request');
    expect(badRequest(() => validateRefreshRequest({ refreshToken: 123 })).code).toBe('invalid_request');
    expect(badRequest(() => validateRefreshRequest(null)).code).toBe('invalid_request');
  });
});
