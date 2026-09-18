import { describe, expect, it } from 'vitest';
import { NOTES_VERSION } from '@/types/notes';
import { defaultsFor, normalize } from './schema';

describe('schema migration/defaults (WS3 additions on top of WS1\'s existing keys)', () => {
  it('an old settings blob without ai.language defaults to English, and an invalid value is rejected', () => {
    const migrated = normalize('settings', { ai: { provider: 'auto', endpointUrl: '' } });
    expect(migrated.ai.language).toBe('en');

    const invalid = normalize('settings', { ai: { provider: 'auto', endpointUrl: '', language: 'klingon' } });
    expect(invalid.ai.language).toBe('en');

    const valid = normalize('settings', { ai: { provider: 'auto', endpointUrl: '', language: 'hi' } });
    expect(valid.ai.language).toBe('hi');
  });

  it('a missing notes key defaults to an empty store at the current version', () => {
    expect(normalize('notes', undefined)).toEqual({ version: NOTES_VERSION, byVideo: {} });
    expect(defaultsFor('notes')).toEqual({ version: NOTES_VERSION, byVideo: {} });
  });

  it('a notes store from a stale NOTES_VERSION is rebuilt empty rather than trusted as-is', () => {
    const stale = { version: NOTES_VERSION - 1, byVideo: { v1: [{ id: 'x' }] } };
    expect(normalize('notes', stale)).toEqual({ version: NOTES_VERSION, byVideo: {} });
  });

  it('a notes store at the current version with real content is kept as-is', () => {
    const current = { version: NOTES_VERSION, byVideo: { v1: [{ id: 'x' }] } };
    expect(normalize('notes', current)).toEqual(current);
  });

  it('WS1\'s preferenceProfiles key is untouched by these additions', () => {
    expect(defaultsFor('preferenceProfiles')).toEqual({ version: expect.any(Number), modes: {} });
  });

  it('an old settings blob without api.baseUrl defaults to anonymous (no configured server)', () => {
    const migrated = normalize('settings', { ai: { provider: 'auto', endpointUrl: '' } });
    expect(migrated.api).toEqual({ baseUrl: '' });
  });

  it('a missing auth key defaults to a fully anonymous state', () => {
    expect(defaultsFor('auth')).toEqual({ user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null });
    expect(normalize('auth', undefined)).toEqual({ user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null });
  });

  it('a coherent auth state (user + both tokens) round-trips as-is', () => {
    const state = { user: { id: 'u1', email: 'a@b.com' }, accessToken: 'at', accessTokenExpiresAt: 12345, refreshToken: 'rt' };
    expect(normalize('auth', state)).toEqual(state);
  });

  it('a partially-written auth state (e.g. a crash mid-write) is treated as anonymous rather than trusted', () => {
    expect(normalize('auth', { user: { id: 'u1', email: 'a@b.com' }, accessToken: null, accessTokenExpiresAt: null, refreshToken: null })).toEqual({
      user: null,
      accessToken: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
    });
    expect(normalize('auth', { user: null, accessToken: 'orphaned-token', accessTokenExpiresAt: null, refreshToken: null })).toEqual({
      user: null,
      accessToken: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
    });
  });
});
