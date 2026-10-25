import type { LearningMode } from '@/types/domain';
import type { CommandAction, SetupCommandAnswer, SetupSpacePlan } from '@/types/setup';
import { inferModeIntent } from '@/modes/intent';
import { uniqueId } from '@/learning/text';
import { addMode, selectMode, SpaceLimitError, updateMode } from '@/modes/service';
import { DEFAULT_MODES } from '@/modes/templates';
import { getItems, updateItem } from '@/storage/storage';
import { sendMessage } from '@/messaging/runtime';
import { pageYouTube } from '../data/youtube';
import { spaNavigate } from '../youtube/spa';
import { modeFromPlan } from './setup-plan';
import { ALLOW_VIDEO_EVENT } from '../allow-video';

/**
 * FocusSpace AI doing things, not only answering: "change the mode to system design and play
 * Harkirat building an app", "create a music mood and play Karan Aujla's Winning Speech".
 *
 * The server's AI turns the sentence into actions (server/setup "command"); this carries them out on
 * the page — create or switch the Space, find the video on YouTube and play it. Only a message that
 * reads like an instruction is sent to be interpreted (`looksLikeCommand`); questions go to the
 * ordinary chat untouched, so asking about a video never costs an extra round trip.
 */


// Speech recognition turns "create a mode" into "creative mode", "crate a space", "great a mode": all count.
const VERB = /\b(change|switch|swap|go to|move to|take me to|open|create|creative|crate|great a|make|build|add|start|set up|generate|play|put on|search|find me|show me|i want to (watch|listen|hear)|let me (watch|listen)|badlo|chalao|lagao|banao)\b/i;
const OBJECT = /\b(mode|mod|mood|space|video|videos|song|songs|music|playlist|lecture|tutorial|course|search|results|channel|subtopics?|topics?)\b|\bplay\b/i;
const QUESTION = /^\s*(what|why|how|when|where|who|which|explain|summari[sz]e|is|are|does|do|can you explain|tell me about)\b/i;

export function looksLikeCommand(text: string): boolean {
  return VERB.test(text) && OBJECT.test(text) && !QUESTION.test(text);
}

export interface CommandResult {
  /** What to show in the chat. */
  reply: string;
  /** A video is opening — the panel should close itself. */
  navigating: boolean;
}

/** null when it isn't a command after all — the caller asks the ordinary chat instead. */
export async function runCommand(text: string): Promise<CommandResult | null> {
  const { modes, settings } = await getItems(['modes', 'settings']);
  const active = modes.find((m) => m.id === settings.activeModeId) ?? null;
  const res = await sendMessage('setup/understand', {
    task: 'command',
    text,
    spaces: modes.map((m) => m.name),
    active: active?.name ?? null,
    catalog: DEFAULT_MODES.map((m) => ({ id: m.id, name: m.name })),
  }).catch(() => null);
  const answer = res?.ok && 'actions' in res.answer ? (res.answer as SetupCommandAnswer) : null;
  if (answer?.actions.length) return perform(answer, modes);
  // The AI couldn't be reached (or found nothing to do): "create a Space for X" still works, from the
  // built-in catalogue — languages, subjects, exams — with that subject's own subtopics.
  const local = localCreate(text, modes);
  return local ? perform(local, modes) : null;
}

const CREATE_SPACE =
  /\b(?:create|creative|crate|great|make|build|generate|set up|start|new|banao)\b.*?\b(?:mode|mod|mood|space)\b(?:\s+(?:for|of|to|on|about|called|named))?\s+(?:me\s+)?(?:learning|to learn|learn|studying)?\s*(.+)$/i;
const TRAILING = /[\s,]+(?:(?:and|with|plus|also)\s+)?(?:add|adds|adding|include|includes|having)?\s*(?:some\s+|the\s+|its\s+)?(?:sub\s*-?\s*topics?|topics?)\b.*$/i;
const FILLER_END = /\s*(?:please|now|for me|thanks)\s*$/i;

/** "Create a mode for learning Japanese and add subtopics" → a ready Space plan, without the AI. */
export function localCreate(text: string, modes: Pick<LearningMode, 'id' | 'name'>[]): SetupCommandAnswer | null {
  const match = CREATE_SPACE.exec(text);
  const subject = match?.[1]?.replace(/[.!?]+$/, '').replace(TRAILING, '').replace(FILLER_END, '').trim();
  if (!subject) return null;
  const suggestion = inferModeIntent(subject) ?? inferModeIntent(`learn ${subject}`);
  if (!suggestion || !suggestion.topics.length) return null;
  const existing = modes.find((m) => m.name.toLowerCase() === suggestion.name.toLowerCase());
  if (existing) return { reply: `Switching to ${existing.name}.`, actions: [{ type: 'switch_space', space: existing.name }] };
  const space: SetupSpacePlan = {
    name: suggestion.name,
    templateId: suggestion.templateId,
    icon: suggestion.icon,
    kind: suggestion.kind === 'institute' ? 'learning' : suggestion.kind,
    description: suggestion.description,
    topics: suggestion.topics.map((t) => ({ name: t.name, keywords: t.keywords })),
    keywords: suggestion.keywords,
    searchHint: suggestion.searchHint,
    avoid: [],
  };
  return { reply: `Creating ${suggestion.name} with ${suggestion.topics.length} subtopics.`, actions: [{ type: 'create_space', space }] };
}

async function perform(answer: SetupCommandAnswer, startingModes: LearningMode[]): Promise<CommandResult> {
  let modes = startingModes;
  const notes: string[] = [];
  let navigating = false;

  const find = (name: string) => {
    const key = name.trim().toLowerCase();
    return modes.find((m) => m.name.toLowerCase() === key || m.id === key) ?? modes.find((m) => m.name.toLowerCase().includes(key) || key.includes(m.name.toLowerCase())) ?? null;
  };

  for (const action of answer.actions as CommandAction[]) {
    if (action.type === 'create_space') {
      const mode = modeFromPlan(action.space, modes.map((m) => m.id));
      try {
        await addMode(mode);
        modes = [...modes, mode];
        await updateItem('settings', (s) => ({ ...s, onboarded: true }));
        notes.push(`Created your ${mode.name} Space.`);
        // Asking for a Space means wanting to be in it, whether or not the AI also said "switch".
        if (!answer.actions.some((a) => a.type === 'switch_space')) {
          await selectMode(mode.id);
          if (!answer.actions.some((a) => a.type === 'play' || a.type === 'search')) {
            spaNavigate('/');
            navigating = true;
          }
        }
      } catch (err) {
        return { reply: err instanceof SpaceLimitError ? err.message : `I couldn’t create ${action.space.name}.`, navigating: false };
      }
    } else if (action.type === 'switch_space') {
      const mode = find(action.space);
      if (!mode) {
        notes.push(`You don’t have a Space called ${action.space}. Say “create ${action.space}” and I’ll make it.`);
        continue;
      }
      await selectMode(mode.id);
      // Home is where a Space shows; a later "play" moves on from there.
      if (!answer.actions.some((a) => a.type === 'play' || a.type === 'search')) {
        spaNavigate('/');
        navigating = true;
      }
    } else if (action.type === 'add_topics') {
      const mode = find(action.space);
      if (!mode) {
        notes.push(`You don’t have a Space called ${action.space} yet.`);
        continue;
      }
      const have = new Set(mode.topics.map((t) => t.name.toLowerCase()));
      const fresh = action.topics.filter((t) => !have.has(t.name.toLowerCase()));
      if (!fresh.length) {
        notes.push(`${mode.name} already has those subtopics.`);
        continue;
      }
      const taken = mode.topics.map((t) => t.id);
      const added = fresh.map((t) => {
        const id = uniqueId(t.name, taken);
        taken.push(id);
        return { id, name: t.name, keywords: t.keywords };
      });
      const topics = [...mode.topics, ...added];
      await updateMode(mode.id, { topics });
      modes = modes.map((m) => (m.id === mode.id ? { ...m, topics } : m));
      notes.push(`Added ${fresh.map((t) => t.name).join(', ')} to ${mode.name}.`);
    } else if (action.type === 'search') {
      spaNavigate(`/results?search_query=${encodeURIComponent(action.query)}`);
      navigating = true;
    } else if (action.type === 'play') {
      const found = await pageYouTube.searchVideos(action.query).catch(() => null);
      const video = found?.videos.find((v) => v.id);
      if (!video) {
        notes.push(`I couldn’t find “${action.query}” on YouTube. Here are the results instead.`);
        spaNavigate(`/results?search_query=${encodeURIComponent(action.query)}`);
        navigating = true;
        continue;
      }
      window.dispatchEvent(new CustomEvent(ALLOW_VIDEO_EVENT, { detail: video.id }));
      openVideo(video.id);
      notes.push(`Playing “${video.title}”.`);
      navigating = true;
    }
  }
  return { reply: [answer.reply, ...notes].filter(Boolean).join(' '), navigating };
}

/**
 * Opens a video, and makes sure it opened. Right after a Space switch YouTube's home is rebuilding, and
 * its router can drop an in-page navigation; if the watch page isn't there shortly after, load it
 * directly instead.
 */
function openVideo(videoId: string) {
  const path = `/watch?v=${encodeURIComponent(videoId)}`;
  spaNavigate(path);
  window.setTimeout(() => {
    if (new URLSearchParams(location.search).get('v') !== videoId) location.assign(path);
  }, 3500);
}

