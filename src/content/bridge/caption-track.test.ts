import { describe, expect, it } from 'vitest';
import { pickTrack } from './caption-track';

/**
 * Which caption track FocusSpace reads.
 *
 * The case that motivated this: a lecture with uploaded captions in one language and auto-generated
 * ones in the learner's handed over the wrong language, because provenance was checked before language.
 * Auto-generated captions are lossy, but they are the only source most lectures have — so they are a
 * real fallback, not a last resort.
 */

const t = (languageCode: string, kind?: string) => ({ languageCode, kind });

describe('pickTrack', () => {
  it('prefers uploaded captions in the learner’s language', () => {
    expect(pickTrack([t('es'), t('en', 'asr'), t('en')], 'en')).toEqual(t('en'));
  });

  it('falls back to auto-generated captions in the learner’s language before another language', () => {
    expect(pickTrack([t('ja'), t('en', 'asr')], 'en')).toEqual(t('en', 'asr'));
  });

  it('uses auto-generated English when nothing else is in a language we can read', () => {
    // The regression: uploaded Japanese used to beat auto-generated English.
    expect(pickTrack([t('ja'), t('en', 'asr')], 'de')).toEqual(t('en', 'asr'));
  });

  it('prefers uploaded English over auto-generated English', () => {
    expect(pickTrack([t('en', 'asr'), t('en')], 'de')).toEqual(t('en'));
  });

  it('takes whatever exists rather than nothing', () => {
    expect(pickTrack([t('ja', 'asr')], 'en')).toEqual(t('ja', 'asr'));
    expect(pickTrack([t('ja')], 'en')).toEqual(t('ja'));
  });

  it('returns null when there is no track at all', () => {
    expect(pickTrack([], 'en')).toBeNull();
  });

  it('tolerates a track with no language code', () => {
    expect(pickTrack([{}], 'en')).toEqual({});
  });

  it('matches a regional code against its base language', () => {
    expect(pickTrack([t('en-GB')], 'en')).toEqual(t('en-GB'));
    expect(pickTrack([t('hi-IN', 'asr'), t('fr')], 'hi')).toEqual(t('hi-IN', 'asr'));
  });
});
