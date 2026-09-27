import type { AiPrompt } from '@/learning/ai/actions';
import { SPACE_ICON_NAMES } from '@/modes/icons';
import { SETUP_MAX_TEXT, VOICE_MAX_SPEECH_CHARS, type CommandAction, type SetupAction, type SetupAnswer, type SetupCommandAnswer, type SetupChannelsAnswer, type SetupPickAnswer, type SetupRequest, type SetupSpacePlan, type SetupSpacesAnswer, type SetupTurnAnswer } from '@/types/setup';
import { ApiError } from '../http';

/**
 * The setup assistant's understanding step: what someone said while setting FocusSpace up, turned into
 * Spaces (with subtopics) or channel names. The model only *understands*; the extension creates the
 * Spaces and looks the channels up on YouTube, so nothing here can change anyone's data.
 */

const MAX_SPACES = 8;
const MAX_TOPICS = 10;
const MAX_CHANNELS = 5;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, n) : '');
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown, max: number, len = 60) => (Array.isArray(v) ? v.map((s) => clip(s, len)).filter(Boolean).slice(0, max) : []);

const catalogOf = (v: unknown) =>
  Array.isArray(v)
    ? v
        .filter(isObject)
        .map((c) => ({ id: clip(c.id, 40), name: clip(c.name, 60) }))
        .filter((c) => c.id && c.name)
        .slice(0, 60)
    : [];

export function validateSetupRequest(body: unknown): SetupRequest {
  if (!isObject(body)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object.');
  const text = clip(body.text, SETUP_MAX_TEXT);
  if (!text) throw new ApiError(400, 'invalid_request', 'Say or type something first.');
  if (body.task === 'spaces') return { task: 'spaces', text, existing: strings(body.existing, 60), catalog: catalogOf(body.catalog) };
  if (body.task === 'channels') return { task: 'channels', text, space: clip(body.space, 80) || 'this Space' };
  if (body.task === 'turn') {
    const state = isObject(body.state) ? body.state : {};
    const spaces = (Array.isArray(state.spaces) ? state.spaces.filter(isObject) : [])
      .map((sp) => ({ name: clip(sp.name, 40), channels: strings(sp.channels, 12, 80), isNew: sp.isNew === true }))
      .filter((sp) => sp.name)
      .slice(0, 40);
    const asking = isObject(state.asking) && state.asking.kind === 'channels' ? { kind: 'channels' as const, space: clip(state.asking.space, 40) } : isObject(state.asking) && state.asking.kind === 'subjects' ? { kind: 'subjects' as const } : null;
    return { task: 'turn', text, state: { spaces, asking }, catalog: catalogOf(body.catalog) };
  }
  if (body.task === 'pick') {
    const items = (Array.isArray(body.items) ? body.items.filter(isObject) : [])
      .map((it) => ({
        name: clip(it.name, 80),
        candidates: (Array.isArray(it.candidates) ? it.candidates.filter(isObject) : [])
          .map((c) => ({ title: clip(c.title, 80), handle: clip(c.handle, 40) || null, subscribers: clip(c.subscribers, 30), description: clip(c.description, 160) }))
          .filter((c) => c.title)
          .slice(0, 6),
      }))
      .filter((it) => it.name && it.candidates.length)
      .slice(0, MAX_CHANNELS);
    if (!items.length) throw new ApiError(400, 'invalid_request', 'Nothing to choose between.');
    return { task: 'pick', text, space: clip(body.space, 40) || 'their Space', items };
  }
  if (body.task === 'command') return { task: 'command', text, spaces: strings(body.spaces, 60), active: clip(body.active, 40) || null, catalog: catalogOf(body.catalog) };
  throw new ApiError(400, 'invalid_request', 'Unknown task.');
}

export function validateSpeechText(body: unknown): string {
  const text = isObject(body) ? clip(body.text, VOICE_MAX_SPEECH_CHARS) : '';
  if (!text) throw new ApiError(400, 'invalid_request', 'Nothing to say.');
  return text;
}

const SPACE_RULES = [
  '- A Space name is the subject alone, 1–4 words, Title Case, correctly spelled: "I want to learn system desing so add it" → "System Design". Never include filler like "I want", "add it", "for now", "please", "space", "mode".',
  '- Languages are named "Learn Spanish", "Learn French", etc.',
  '- If a subject matches one of the templates, set templateId to that template id and use the template name exactly; otherwise templateId is null.',
  '- For a learning subject, give 8 subtopics (never fewer than 6, at most 10) a learner moves through, beginner to advanced.',
  '- For music, entertainment or anything to enjoy rather than study (kind "media"), subtopics are what they will listen to or watch, the languages, genres, moods and artists that fit them and what they mentioned (Karan Aujla → Punjabi Hits, Punjabi Hip-Hop, Karan Aujla, Bollywood, Chill & Lo-fi, Workout…). Never how to make it (music theory, instruments, songwriting, production) unless they said they want to learn music.',
  '- Every subtopic gets 2–4 short YouTube search keywords; the Space gets 4–8 keywords specific enough not to match unrelated videos ("punjabi song", "official music video", "lyrics", an artist name, never bare generic words like "live", "performance", "video", "new").',
  '- avoid: 3–8 words for what this Space is not, so it never shows up there, for music: "news", "podcast", "vlog", "reaction", "tutorial", "interview"; for a learning subject: "meme", "prank", "reaction".',
  '- A searchHint of 1–3 words, and a one-sentence description.',
  `- icon is one of: ${SPACE_ICON_NAMES.join(', ')}. kind is "learning", "media" (music, entertainment) or "general".`,
];

/** Speech recognition mangles creator names; these are the ones learners here name most, and how YouTube knows them. */
export const KNOWN_CREATORS = ['Telusko', 'take U forward (Striver)', 'CodeHelp - by Babbar', 'Love Babbar', 'Apna College', 'Chai aur Code (Hitesh Choudhary)', 'Harkirat Singh', 'Kunal Kushwaha', 'CodeWithHarry', 'Gaurav Sen', 'Krish Naik', 'freeCodeCamp.org', 'Abdul Bari', 'Jenny\'s Lectures CS IT', 'Neso Academy', 'Gate Smashers', 'Akshay Saini', 'Traversy Media', 'Fireship', 'NeetCode', 'Aditya Verma', 'Coder Army', 'Physics Wallah', 'Dhruv Rathee', 'Karan Aujla'];

const VOICE = 'You are FocusSpace’s setup guide: warm, quick and human, like a friend helping someone get started, never a form. Replies are spoken aloud: one short sentence, twelve words at most, the way people talk. Open naturally and vary it ("Okay,", "Alright,", "Got it.", "Nice!", "Sure,"), never the same opener twice in a row. No lists, markdown, emoji or long dashes (—). Never read out results the app will show itself (every subtopic, every channel); just say what you are doing.';

export function setupPrompt(request: SetupRequest): AiPrompt {
  if (request.task === 'turn') {
    return {
      system: [
        VOICE,
        'FocusSpace organises YouTube into Spaces, one per subject someone wants to focus on, and each Space can have favourite creators (YouTube channels). You are in the middle of setting this up with someone. Each turn you get what they just said (typed, or speech-to-text: possibly Hinglish, with typos and misheard names), every Space they have with the creators already in it, and the question you last asked. Decide what to do as a list of actions, and what to say.',
        'Actions:',
        '- create_space: for every new subject they want (never one they already have), with channels: the creators they named for that subject in the same breath ("system design with gaurav sen" → channels ["Gaurav Sen"]), or []. The Space follows these rules:',
        ...SPACE_RULES.map((r) => '  ' + r),
        '- add_channels: creators to add, under the exact name of the Space they belong to, one they have or one you are creating in this same answer. A name is the creator alone (never the subject, never "with"). Speech recognition often mishears creator names: in a programming Space "telescope" is Telusko, "striver" is take U forward, "hit esh" is Hitesh Choudhary. Well-known creators: ' + KNOWN_CREATORS.join(', ') + '.',
        '- remove_channels: when they take a creator back or correct one, "not Telescope, Telusko", "wait, in DSA I said Telusko", "remove X from DSA". Look at that Space’s current creators to find the wrong one (e.g. "India Telescope Shop" is the mistaken "Telescope") and remove it by its exact current name, then add_channels the right one.',
        '- remove_space: only when they clearly ask to delete a Space.',
        '- no_channels: they answered the creator question for a Space with no, skip, none, not really, you choose.',
        '- A correction about one Space does not answer the question about another, if you asked about System Design and they fixed DSA, do not answer for System Design.',
        '- A bare name (or names) answers the question you asked: it goes to the Space in answeringFor, never another one.',
        '- Never drop a creator they named. If you are unsure of the spelling, keep it as they said it. Before answering, check: every creator named anywhere in what they said appears in exactly one add_channels, including creators said together with a new subject in the same breath.',
        '- Every Space in spaces already exists, never create it again, never say you will.',
        '- Greeting, question or nothing actionable: no actions; reply answers briefly and asks what they would like.',
        'Examples (answeringFor → said → actions):',
        '• DSA → "I like CodeHelp by Babbar and Apna College, also telescope" → add_channels DSA ["CodeHelp - by Babbar", "Apna College", "Telusko"]',
        '• System Design → "gaurav sen, and remove apna college from DSA" → add_channels System Design ["Gaurav Sen"]; remove_channels DSA ["Apna College"]',
        '• System Design → "wait, in DSA I said Telusko" (DSA has India Telescope Shop) → remove_channels DSA ["India Telescope Shop"]; add_channels DSA ["Telusko"], System Design is still unanswered',
        '• Web Development → "nah skip, and add a cooking space" → no_channels Web Development; create_space Cooking',
        '• (nothing asked) → "DSA with striver and system design" → create_space DSA with channels ["take U forward"]; create_space System Design with channels []',
        '• DSA → "the Love Babbar channel itself. also add system design with gaurav sen" → add_channels DSA ["Love Babbar"]; create_space System Design with channels ["Gaurav Sen"]',
        'reply: one short spoken sentence saying what you are doing ("Got it, swapping that for Telusko in DSA.", "Okay! System Design, Spanish and English, coming up."). Never ask the next creator question yourself; the app asks it.',
        'Answer with one JSON object: {"reply": string, "actions": [{"type": "create_space", "channels": [string], "space": {"name", "templateId", "icon", "kind", "description", "topics": [{"name", "keywords": []}], "keywords": [], "searchHint", "avoid": []}} | {"type": "add_channels" | "remove_channels", "space": string, "names": [string]} | {"type": "remove_space" | "no_channels", "space": string}]}',
      ].join('\n'),
      user: JSON.stringify({
        said: request.text,
        answeringFor: request.state.asking?.kind === 'channels' ? request.state.asking.space : null,
        spaces: request.state.spaces.map((sp) => ({ name: sp.name, creators: sp.channels })),
        templates: request.catalog,
      }),
    };
  }
  if (request.task === 'command') {
    return {
      system: [
        'You are FocusSpace AI inside YouTube. Never use long dashes (—) in the reply. FocusSpace organises YouTube into Spaces (one per subject or mood); the active Space decides what the home page shows. Turn what the person said into actions, in the order they should happen. Reply is spoken or shown: one short, warm sentence saying what you are doing, no lists, no markdown.',
        '- switch_space: to a Space they have, use its exact name. "Change the mode/mood to music" picks their closest Space.',
        '- create_space: when they ask for a Space they don’t have ("create a mood music mode"), then switch_space to it. The Space follows these rules:',
        ...SPACE_RULES.map((r) => '  ' + r),
        '- play: they want a particular video or song played, query is what to type into YouTube search, specific and clean ("Karan Aujla Winning Speech", "Harkirat building an app"). Fix obvious speech-recognition slips in names.',
        '- search: they want to browse videos about something, not one video.',
        '- Frustrated or bored ("I’m tired of DSA, change the mood") without saying to what: switch to their most relaxing or entertaining Space if they have one; otherwise no actions and reply asks what they’d like instead.',
        '- A question (what, why, how, explain, summarise, "what does this video say…") is never a command, even if it mentions videos: no actions, reply empty. Only an instruction to change, create, play, open or show something is.',
        'Example: spaces ["DSA", "System Design"], said "change mode to system design and play video of harkirat building the new app" → switch_space System Design; play "Harkirat Singh building new app".',
        'Example: spaces ["DSA"], said "create one mood music and play karan aujla winning speech" → create_space Music (kind media, icon music); switch_space Music; play "Karan Aujla Winning Speech".',
        'Answer with one JSON object: {"reply": string, "actions": [{"type": "switch_space", "space": string} | {"type": "create_space", "space": {"name", "templateId", "icon", "kind", "description", "topics": [{"name", "keywords": []}], "keywords": [], "searchHint", "avoid": []}} | {"type": "play" | "search", "query": string}]}',
      ].join('\n'),
      user: JSON.stringify({ said: request.text, spaces: request.spaces, activeSpace: request.active, templates: request.catalog }),
    };
  }
  if (request.task === 'pick') {
    return {
      system: [
        `Someone setting up their "${request.space}" Space on FocusSpace named YouTube creators. For each name, YouTube's channel search returned candidates. Pick the channel they most likely mean: the name (or a close mishearing of it) first, then relevance to "${request.space}", then size. Choose null when no candidate is plausibly it, a shop, an unrelated brand, or someone with the same word in their name who is clearly not a ${request.space} creator.`,
        'Answer with one JSON object: {"picks": [index or null, one per name, in order]}',
      ].join('\n'),
      user: JSON.stringify({ said: request.text, items: request.items.map((it) => ({ name: it.name, candidates: it.candidates.map((c, i) => ({ index: i, ...c })) })) }),
    };
  }
  if (request.task === 'spaces') {
    return {
      system: [
        VOICE,
        'FocusSpace organises YouTube into Spaces: one per subject someone wants to focus on. Read what the person said, typed or transcribed speech, possibly Hinglish, with typos and filler, and work out every distinct subject they want a Space for.',
        'Rules:',
        ...SPACE_RULES,
        '- Every subject they mention is its own Space, including a subject mentioned together with a creator. "DSA with Striver" means a DSA Space AND the creator Striver for the DSA Space; never file a creator under a different subject than the one it was said with.',
        '- channels lists creators they named, under the exact name of the Space they belong to (the Space you are creating, or one they already have). A creator entry is the creator’s name only, never the subject, never words like "with", spelled the way the channel is known on YouTube when you are confident (Striver → "take U forward").',
        'Example: said "I want system design and spanish, and DSA with striver" → spaces System Design, Learn Spanish and DSA (templateId "dsa"); channels [{"space": "DSA", "names": ["take U forward"]}].',
        '- Skip subjects the person already has a Space for.',
        '- If they did not name any subject or creator (a greeting, a question, "I don’t know"), return no spaces and use reply to ask, in one friendly sentence, what they would like to learn or watch, suggest two or three examples.',
        '- Otherwise reply confirms what you understood in one or two sentences, naming the Spaces, e.g. "Got it, System Design, Learn Spanish and Learn French. I’ll set those up for you now."',
        'Answer with one JSON object: {"reply": string, "spaces": [{"name", "templateId", "icon", "kind", "description", "topics": [{"name", "keywords": []}], "keywords": [], "searchHint", "avoid": []}], "channels": [{"space": string, "names": [string]}]}',
      ].join('\n'),
      user: JSON.stringify({ said: request.text, alreadyHas: request.existing, templates: request.catalog }),
    };
  }
  return {
    system: [
      VOICE,
      `The person was asked whether they have a favourite YouTube channel, teacher or creator for their "${request.space}" Space. Read their answer (typed or transcribed speech, possibly Hinglish, names possibly misspelled by speech recognition).`,
      '- channels: the channel or creator names they mentioned, spelled the way the channel is known on YouTube when you are confident (e.g. "striver" → "take U forward", "love babbar" → "Love Babbar"). At most five. Empty if they said no, skip, not really, or named none.',
      '- reply: one short sentence, if names were given, say you will look them up; if not, say that is fine and FocusSpace will find the best creators for them.',
      'Answer with one JSON object: {"reply": string, "channels": [string]}',
    ].join('\n'),
    user: JSON.stringify({ space: request.space, said: request.text }),
  };
}

/** The model's JSON, reduced to exactly the shape the extension trusts. Anything malformed is dropped, not guessed at. */
export function parseSetupAnswer(request: SetupRequest, data: unknown): SetupAnswer {
  const raw = isObject(data) ? data : {};
  const reply = clip(raw.reply, 400);
  if (request.task === 'command') {
    const templateIds = new Set(request.catalog.map((c) => c.id));
    const actions: CommandAction[] = [];
    for (const a of Array.isArray(raw.actions) ? raw.actions.filter(isObject) : []) {
      if (a.type === 'create_space') {
        const plan = parsePlan(a.space, templateIds);
        if (plan && !request.spaces.some((n) => n.toLowerCase() === plan.name.toLowerCase())) actions.push({ type: 'create_space', space: plan });
      } else if (a.type === 'switch_space') {
        const space = clip(a.space, 40);
        if (space) actions.push({ type: 'switch_space', space });
      } else if (a.type === 'play' || a.type === 'search') {
        const query = clip(a.query, 120);
        if (query) actions.push({ type: a.type, query });
      }
    }
    const answer: SetupCommandAnswer = { reply, actions: actions.slice(0, 6) };
    return answer;
  }
  if (request.task === 'pick') {
    const picks = request.items.map((it, i) => {
      const v = Array.isArray(raw.picks) ? raw.picks[i] : null;
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < it.candidates.length ? v : null;
    });
    const answer: SetupPickAnswer = { picks };
    return answer;
  }
  if (request.task === 'turn') {
    const templateIds = new Set(request.catalog.map((c) => c.id));
    const had = new Set(request.state.spaces.map((sp) => sp.name.toLowerCase()));
    const creating = new Set<string>();
    const actions: SetupAction[] = [];
    const later: SetupAction[] = [];
    for (const a of Array.isArray(raw.actions) ? raw.actions.filter(isObject) : []) {
      if (a.type === 'create_space') {
        const plan = parsePlan(a.space, templateIds);
        if (!plan || had.has(plan.name.toLowerCase()) || creating.has(plan.name.toLowerCase()) || creating.size >= MAX_SPACES) continue;
        creating.add(plan.name.toLowerCase());
        actions.push({ type: 'create_space', space: plan });
        // Creators said with the subject travel with it, then become an ordinary add once it exists.
        const names = strings(a.channels, MAX_CHANNELS, 80);
        if (names.length) later.push({ type: 'add_channels', space: plan.name, names });
        continue;
      }
      const space = clip(a.space, 40);
      if (!space) continue;
      if (a.type === 'add_channels' || a.type === 'remove_channels') {
        const names = strings(a.names, MAX_CHANNELS, 80);
        if (names.length) actions.push({ type: a.type, space, names });
      } else if (a.type === 'remove_space' || a.type === 'no_channels') {
        actions.push({ type: a.type, space });
      }
    }
    // Skip a carried creator the model also listed on its own, so nobody is looked up twice.
    const extra = later.filter((l) => l.type === 'add_channels' && !actions.some((a) => a.type === 'add_channels' && a.space.toLowerCase() === l.space.toLowerCase()));
    const all = [...actions, ...extra];
    const answer: SetupTurnAnswer = { reply: reply || (all.length ? 'Okay.' : 'What would you like to learn or watch?'), actions: all.slice(0, 20) };
    return answer;
  }
  if (request.task === 'channels') {
    const answer: SetupChannelsAnswer = { reply: reply || 'No problem.', channels: strings(raw.channels, MAX_CHANNELS, 80) };
    return answer;
  }
  const templateIds = new Set(request.catalog.map((c) => c.id));
  const had = new Set(request.existing.map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const spaces: SetupSpacePlan[] = [];
  for (const item of Array.isArray(raw.spaces) ? raw.spaces : []) {
    const plan = parsePlan(item, templateIds);
    if (!plan || had.has(plan.name.toLowerCase()) || seen.has(plan.name.toLowerCase())) continue;
    seen.add(plan.name.toLowerCase());
    spaces.push(plan);
    if (spaces.length >= MAX_SPACES) break;
  }
  const channels = (Array.isArray(raw.channels) ? raw.channels.filter(isObject) : [])
    .map((c) => ({ space: clip(c.space, 40), names: strings(c.names, MAX_CHANNELS, 80) }))
    .filter((c) => c.space && c.names.length)
    .slice(0, MAX_SPACES);
  const answer: SetupSpacesAnswer = {
    reply: reply || (spaces.length ? `Got it, I’ll set up ${spaces.map((s) => s.name).join(', ')}.` : 'What would you like to learn or watch?'),
    spaces,
    channels,
  };
  return answer;
}

/** One Space as the model described it, reduced to what the extension trusts; null when it isn't one. */
function parsePlan(value: unknown, templateIds: Set<string>): SetupSpacePlan | null {
  if (!isObject(value)) return null;
  const name = clip(value.name, 40);
  if (!name) return null;
  return {
    name,
    templateId: typeof value.templateId === 'string' && templateIds.has(value.templateId) ? value.templateId : null,
    icon: (SPACE_ICON_NAMES as readonly string[]).includes(String(value.icon)) ? String(value.icon) : 'book-open',
    kind: value.kind === 'media' || value.kind === 'general' ? value.kind : 'learning',
    description: clip(value.description, 200),
    topics: (Array.isArray(value.topics) ? value.topics.filter(isObject) : [])
      .map((t) => ({ name: clip(t.name, 50), keywords: strings(t.keywords, 4) }))
      .filter((t) => t.name)
      .slice(0, MAX_TOPICS),
    keywords: strings(value.keywords, 8),
    searchHint: clip(value.searchHint, 40) || name.toLowerCase(),
    avoid: strings(value.avoid, 8, 30),
  };
}

/** What the speech recogniser is told to expect, so "Telusko" is not heard as "telescope". */
export function transcriptionHint(context: string): string {
  return `A learner setting up FocusSpace, naming subjects and YouTube creators. ${context} Creators they often name: ${KNOWN_CREATORS.join(', ')}.`.slice(0, 900);
}
