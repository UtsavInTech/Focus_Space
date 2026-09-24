/**
 * Which caption track to read, in order of how much it is worth.
 *
 * Uploaded captions in a language the learner reads are the best thing available: a human wrote them.
 * Auto-generated captions are worse — speech recognition mangles exactly the technical terms a learning
 * video is about — but they are the *only* source on most lectures, so they are a real fallback rather
 * than a last resort.
 *
 * The order below matters, and the previous version got one case wrong: it preferred any uploaded track
 * over any auto-generated one, so a video with Japanese uploaded captions and English auto-captions
 * handed FocusSpace Japanese. Language now outranks provenance, and provenance breaks the tie.
 *
 * Its own module, not a local function in the bridge, only so it can be tested: the bridge runs in the
 * page's MAIN world and touches `window.ytcfg` and the player at import time.
 */

export interface CaptionTrack {
  languageCode?: string;
  kind?: string;
}

export function pickTrack(tracks: CaptionTrack[], lang: string): CaptionTrack | null {
  const inLanguage = (code: string) => (t: CaptionTrack) => t.languageCode?.startsWith(code) === true;
  const uploaded = (t: CaptionTrack) => t.kind !== 'asr';
  const auto = (t: CaptionTrack) => t.kind === 'asr';

  return (
    tracks.find((t) => inLanguage(lang)(t) && uploaded(t)) ??
    tracks.find((t) => inLanguage(lang)(t) && auto(t)) ??
    tracks.find((t) => inLanguage('en')(t) && uploaded(t)) ??
    // Auto-generated English: the common case on a lecture with no uploaded captions at all.
    tracks.find((t) => inLanguage('en')(t) && auto(t)) ??
    tracks.find(uploaded) ??
    tracks.find(auto) ??
    tracks[0] ??
    null
  );
}
