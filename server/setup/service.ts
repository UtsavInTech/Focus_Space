import type { AiPrompt } from '@/learning/ai/actions';
import { SPACE_ICON_NAMES } from '@/modes/icons';
import { SETUP_MAX_TEXT, VOICE_MAX_SPEECH_CHARS, type SetupAnswer, type SetupChannelsAnswer, type SetupRequest, type SetupSpacePlan, type SetupSpacesAnswer } from '@/types/setup';
import { ApiError } from '../http';

/**
 * The setup assistant's understanding step: what someone said while setting FocusSpace up, turned into
 * Spaces (with subtopics) or channel names. The model only *understands*; the extension creates the
 * Spaces and looks the channels up on YouTube, so nothing here can change anyone's data.
 */

const MAX_SPACES = 8;
const MAX_TOPICS = 8;
const MAX_CHANNELS = 5;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, n) : '');
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown, max: number, len = 60) => (Array.isArray(v) ? v.map((s) => clip(s, len)).filter(Boolean).slice(0, max) : []);

export function validateSetupRequest(body: unknown): SetupRequest {
  if (!isObject(body)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object.');
  const text = clip(body.text, SETUP_MAX_TEXT);
  if (!text) throw new ApiError(400, 'invalid_request', 'Say or type something first.');
  if (body.task === 'spaces') {
    const catalog = Array.isArray(body.catalog)
      ? body.catalog
          .filter(isObject)
          .map((c) => ({ id: clip(c.id, 40), name: clip(c.name, 60) }))
          .filter((c) => c.id && c.name)
          .slice(0, 60)
      : [];
    return { task: 'spaces', text, existing: strings(body.existing, 60), catalog };
  }
  if (body.task === 'channels') return { task: 'channels', text, space: clip(body.space, 80) || 'this Space' };
  throw new ApiError(400, 'invalid_request', 'Unknown task.');
}

export function validateSpeechText(body: unknown): string {
  const text = isObject(body) ? clip(body.text, VOICE_MAX_SPEECH_CHARS) : '';
  if (!text) throw new ApiError(400, 'invalid_request', 'Nothing to say.');
  return text;
}

const VOICE = 'You are FocusSpace’s setup assistant: warm, brief and human — like a friend helping someone get started, never like a form. Replies are spoken aloud, so write the way people talk: short sentences, no lists, no markdown, no emoji.';

export function setupPrompt(request: SetupRequest): AiPrompt {
  if (request.task === 'spaces') {
    return {
      system: [
        VOICE,
        'FocusSpace organises YouTube into Spaces: one per subject someone wants to focus on. Read what the person said — typed or transcribed speech, possibly Hinglish, with typos and filler — and work out every distinct subject they want a Space for.',
        'Rules:',
        '- A Space name is the subject alone, 1–4 words, Title Case, correctly spelled: "I want to learn system desing so add it" → "System Design". Never include filler like "I want", "add it", "for now", "please", "space", "mode".',
        '- Languages are named "Learn Spanish", "Learn French", etc.',
        '- If a subject matches one of the templates, set templateId to that template id and use the template name exactly; otherwise templateId is null.',
        '- For every Space give 4–7 topics a learner would move through (beginner to advanced for learning subjects), each with 2–4 short search keywords; 4–8 Space keywords; a searchHint of 1–3 words; a one-sentence description.',
        `- icon is one of: ${SPACE_ICON_NAMES.join(', ')}. kind is "learning", "media" (music, entertainment) or "general".`,
        '- Skip subjects the person already has a Space for.',
        '- If they did not name any subject (a greeting, a question, "I don’t know"), return no spaces and use reply to ask, in one friendly sentence, what they would like to learn or watch — suggest two or three examples.',
        '- Otherwise reply confirms what you understood in one or two sentences, naming the Spaces, e.g. "Got it — System Design, Learn Spanish and Learn French. I’ll set those up for you now."',
        'Answer with one JSON object: {"reply": string, "spaces": [{"name", "templateId", "icon", "kind", "description", "topics": [{"name", "keywords": []}], "keywords": [], "searchHint"}]}',
      ].join('\n'),
      user: JSON.stringify({ said: request.text, alreadyHas: request.existing, templates: request.catalog }),
    };
  }
  return {
    system: [
      VOICE,
      `The person was asked whether they have a favourite YouTube channel, teacher or creator for their "${request.space}" Space. Read their answer (typed or transcribed speech, possibly Hinglish, names possibly misspelled by speech recognition).`,
      '- channels: the channel or creator names they mentioned, spelled the way the channel is known on YouTube when you are confident (e.g. "striver" → "take U forward", "love babbar" → "Love Babbar"). At most five. Empty if they said no, skip, not really, or named none.',
      '- reply: one short sentence — if names were given, say you will look them up; if not, say that is fine and FocusSpace will find the best creators for them.',
      'Answer with one JSON object: {"reply": string, "channels": [string]}',
    ].join('\n'),
    user: JSON.stringify({ space: request.space, said: request.text }),
  };
}

/** The model's JSON, reduced to exactly the shape the extension trusts. Anything malformed is dropped, not guessed at. */
export function parseSetupAnswer(request: SetupRequest, data: unknown): SetupAnswer {
  const raw = isObject(data) ? data : {};
  const reply = clip(raw.reply, 400);
  if (request.task === 'channels') {
    const answer: SetupChannelsAnswer = { reply: reply || 'No problem.', channels: strings(raw.channels, MAX_CHANNELS, 80) };
    return answer;
  }
  const templateIds = new Set(request.catalog.map((c) => c.id));
  const had = new Set(request.existing.map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const spaces: SetupSpacePlan[] = [];
  for (const s of Array.isArray(raw.spaces) ? raw.spaces.filter(isObject) : []) {
    const name = clip(s.name, 40);
    if (!name || had.has(name.toLowerCase()) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const templateId = typeof s.templateId === 'string' && templateIds.has(s.templateId) ? s.templateId : null;
    spaces.push({
      name,
      templateId,
      icon: (SPACE_ICON_NAMES as readonly string[]).includes(String(s.icon)) ? String(s.icon) : 'book-open',
      kind: s.kind === 'media' || s.kind === 'general' ? s.kind : 'learning',
      description: clip(s.description, 200),
      topics: (Array.isArray(s.topics) ? s.topics.filter(isObject) : [])
        .map((t) => ({ name: clip(t.name, 50), keywords: strings(t.keywords, 4) }))
        .filter((t) => t.name)
        .slice(0, MAX_TOPICS),
      keywords: strings(s.keywords, 8),
      searchHint: clip(s.searchHint, 40) || name.toLowerCase(),
    });
    if (spaces.length >= MAX_SPACES) break;
  }
  const answer: SetupSpacesAnswer = { reply: reply || (spaces.length ? `Got it — I’ll set up ${spaces.map((s) => s.name).join(', ')}.` : 'What would you like to learn or watch?'), spaces };
  return answer;
}
