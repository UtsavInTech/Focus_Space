import type { ChannelRef, FilterConfig, FocusIntensity, LearningMode, Settings, TopicPlaylists } from '@/types/domain';
import type { SpaceAllowanceView, SpaceAuthorization } from '@/types/account';
import { sendMessage } from '@/messaging/runtime';
import { getItems, updateItem, setItems } from '@/storage/storage';
import { FILTER_PRESETS } from '@/storage/schema';
import { uniqueId } from '@/learning/text';
import { blankMode, DEFAULT_MODES } from './templates';
import { examInfo, type ExamId } from './exams';
import { isSpaceLocked, lockState } from './unlock';

/** All mode + focus state mutations live here so every surface behaves the same. */

/**
 * Raised when the plan's Space allowance is used up. Thrown by every creation path
 * (createMode/addMode/addTemplate) rather than checked in each UI, so no surface can
 * accidentally bypass it — the server decides, this is how its answer reaches the learner.
 */
export class SpaceLimitError extends Error {
  readonly allowance: SpaceAllowanceView | null;
  constructor(message: string, allowance: SpaceAllowanceView | null) {
    super(message);
    this.name = 'SpaceLimitError';
    this.allowance = allowance;
  }
}

/**
 * A new learner's other Spaces are locked until they have studied in their exam Space (modes/unlock.ts).
 * A SpaceLimitError, so every surface that already explains a full allowance explains this too.
 */
export class SpaceLockedError extends SpaceLimitError {
  constructor(message: string) {
    super(message, null);
    this.name = 'SpaceLockedError';
  }
}

async function authorizeSpace(id: string, name: string): Promise<void> {
  const { modes, settings, watchHistory } = await getItems(['modes', 'settings', 'watchHistory']);
  if (modes.some((m) => m.id === id)) return; // already exists locally: an update, not a new Space
  const lock = lockState(settings, watchHistory);
  if (isSpaceLocked(id, lock, modes)) {
    const exam = examInfo(lock.examId)?.label ?? 'your exam';
    throw new SpaceLockedError(`${name} is locked for now. Study ${lock.remaining} more min of ${exam} and every Space opens.`);
  }
  // If the background cannot answer, the allowance was not checked — so the Space is not created.
  const result = await sendMessage('spaces/authorize', { spaceId: id, name }).catch(
    (): SpaceAuthorization => ({ ok: false, code: 'error', error: 'FocusSpace couldn’t check your Space allowance. Reload the page and try again.', allowance: null }),
  );
  if (!result.ok) throw new SpaceLimitError(result.error, result.allowance);
}

/** Frees the Space's slot on the server. Best-effort — local deletion must never depend on it. */
const releaseSpace = (id: string) => void sendMessage('spaces/release', { spaceId: id }).catch(() => undefined);

export const findMode = (modes: LearningMode[], id: string | null | undefined) => (id ? modes.find((m) => m.id === id) ?? null : null);

export const activeModeOf = (settings: Settings, modes: LearningMode[]) => findMode(modes, settings.activeModeId);

/**
 * Focus Mode is on but there is no Space to focus on yet — a new install, or every Space deleted. The
 * home page then shows the picker ("What do you want to focus on?"); nothing else changes YouTube until
 * a Space exists.
 */
export const needsFirstSpace = (settings: Settings, modes: LearningMode[]) => settings.focusEnabled && !activeModeOf(settings, modes);

/** The distraction rules that actually apply right now. */
export function effectiveFilters(settings: Settings, mode: LearningMode | null): FilterConfig {
  return mode?.filterOverride ?? settings.focus;
}

export function presetConfig(intensity: Exclude<FocusIntensity, 'custom'>): FilterConfig {
  return { intensity, filters: { ...FILTER_PRESETS[intensity] } };
}

export async function selectMode(modeId: string): Promise<void> {
  await updateItem('settings', (s) => ({ ...s, activeModeId: modeId, focusEnabled: true }));
}

export async function setFocusEnabled(enabled: boolean): Promise<void> {
  const { settings, modes } = await getItems(['settings', 'modes']);
  let activeModeId = settings.activeModeId;
  if (enabled && !findMode(modes, activeModeId)) activeModeId = findMode(modes, settings.defaultModeId)?.id ?? modes[0]?.id ?? null;
  // With no Space at all, "on" still means on: YouTube's home shows the picker to create the first one.
  await updateItem('settings', (s) => ({ ...s, focusEnabled: enabled && (!!activeModeId || modes.length === 0), activeModeId }));
}

export async function toggleFocus(): Promise<boolean> {
  const { settings } = await getItems(['settings']);
  await setFocusEnabled(!settings.focusEnabled);
  return !settings.focusEnabled;
}

export async function createMode(input: Partial<LearningMode> = {}): Promise<LearningMode> {
  const now = Date.now();
  await authorizeSpace(uniqueId(input.name || 'mode', (await getItems(['modes'])).modes.map((m) => m.id)), input.name ?? 'New space');
  let created!: LearningMode;
  await updateItem('modes', (modes) => {
    const id = uniqueId(input.name || 'mode', modes.map((m) => m.id));
    created = { ...blankMode(id, now), ...input, id, createdAt: now, updatedAt: now };
    return [...modes, created];
  });
  return created;
}

/** Store a fully-formed space (e.g. from intent inference) and make it active. */
export async function addMode(mode: LearningMode): Promise<void> {
  await authorizeSpace(mode.id, mode.name);
  await updateItem('modes', (modes) => [...modes.filter((m) => m.id !== mode.id), mode]);
}

export async function updateMode(id: string, patch: Partial<Omit<LearningMode, 'id' | 'createdAt'>>): Promise<void> {
  await updateItem('modes', (modes) => modes.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m)));
}

export async function deleteMode(id: string): Promise<void> {
  const { modes, settings, session } = await getItems(['modes', 'settings', 'session']);
  if (modes.length <= 1) throw new Error('Keep at least one mode.');
  const remaining = modes.filter((m) => m.id !== id);
  const fallback = findMode(remaining, settings.defaultModeId)?.id ?? remaining[0].id;
  await setItems({
    modes: remaining,
    settings: {
      ...settings,
      activeModeId: settings.activeModeId === id ? fallback : settings.activeModeId,
      defaultModeId: settings.defaultModeId === id ? remaining[0].id : settings.defaultModeId,
    },
    ...(session?.modeId === id ? { session: null } : {}),
  });
  releaseSpace(id);
}

/**
 * Schema 5 migration: before it, every install was seeded with all the templates as real Spaces. Those
 * the learner never touched (still `createdAt === 0`, exactly as seeded) are removed, unless they are
 * the active or default Space or hold saved videos — anything the learner used or changed is kept.
 * Removed ones stay one click away as suggestions.
 */
export function pruneUnusedTemplates(modes: LearningMode[], settings: Pick<Settings, 'activeModeId' | 'defaultModeId'>, topicPlaylists: TopicPlaylists): LearningMode[] {
  const used = (m: LearningMode) =>
    m.id === settings.activeModeId || m.id === settings.defaultModeId || Object.values(topicPlaylists[m.id] ?? {}).some((videos) => videos.length > 0);
  return modes.filter((m) => !(m.createdAt === 0 && m.updatedAt === 0 && DEFAULT_MODES.some((t) => t.id === m.id)) || used(m));
}

/** Built-in templates the user has deleted (or never had), available to re-add. */
export const missingTemplates = (modes: LearningMode[]) => DEFAULT_MODES.filter((t) => !modes.some((m) => m.id === t.id));

export async function addTemplate(templateId: string): Promise<LearningMode | null> {
  const template = DEFAULT_MODES.find((t) => t.id === templateId);
  if (!template) return null;
  const now = Date.now();
  const mode = { ...structuredClone(template), createdAt: now, updatedAt: now };
  await authorizeSpace(mode.id, mode.name);
  await updateItem('modes', (modes) => (modes.some((m) => m.id === mode.id) ? modes : [...modes, mode]));
  return mode;
}

/**
 * Creates a template Space and, optionally, seeds its allowed channels — the same write `CreateSpace.tsx`
 * already does for a custom Space (`setChannelRule` + a best-effort `channel/add` so the channel is added
 * to the library, not just the Space's rule). `channels` is deliberately optional and defaults to none:
 * skipping creator preference is a first-class choice, not an incomplete one — FocusSpace still discovers
 * relevant channels on its own (src/learning/discovery.ts).
 */
export async function addTemplateWithChannels(templateId: string, channels: ChannelRef[] = []): Promise<LearningMode | null> {
  const created = await addTemplate(templateId);
  if (!created) return null;
  for (const channel of channels) {
    await setChannelRule(created.id, channel, 'allowed');
    void sendMessage('channel/add', { input: channel.id }).catch(() => undefined);
  }
  return created;
}

const sameChannel = (a: ChannelRef, b: ChannelRef) =>
  (!!a.id && a.id === b.id) || (!!a.handle && !!b.handle && a.handle.toLowerCase() === b.handle.toLowerCase());

export async function setChannelRule(modeId: string, channel: ChannelRef, rule: 'allowed' | 'blocked' | null): Promise<void> {
  await updateItem('modes', (modes) =>
    modes.map((m) => {
      if (m.id !== modeId) return m;
      const allowedChannels = m.allowedChannels.filter((c) => !sameChannel(c, channel));
      const blockedChannels = m.blockedChannels.filter((c) => !sameChannel(c, channel));
      if (rule === 'allowed') allowedChannels.push(channel);
      if (rule === 'blocked') blockedChannels.push(channel);
      return { ...m, allowedChannels, blockedChannels, updatedAt: Date.now() };
    }),
  );
}

export function channelRuleOf(mode: LearningMode | null, channel: ChannelRef): 'allowed' | 'blocked' | null {
  if (!mode) return null;
  if (mode.allowedChannels.some((c) => sameChannel(c, channel))) return 'allowed';
  if (mode.blockedChannels.some((c) => sameChannel(c, channel))) return 'blocked';
  return null;
}

/* ─── Exams (modes/exams.ts) ──────────────────────────────────────────────── */

/**
 * "I'm preparing for UPSC": creates the exam's Space (or reuses it), makes it the one YouTube shows, and
 * records the exam — which is what locks the other Spaces for now (modes/unlock.ts). The exam is
 * recorded first, so the Space being created is the one Space the lock lets through.
 */
export async function chooseExam(examId: ExamId): Promise<LearningMode | null> {
  const before = await getItems(['settings', 'modes']);
  // Locking is for a fresh start only: someone who already has Spaces keeps every door open.
  const hadSpaces = before.modes.some((m) => m.id !== examId);
  await updateItem('settings', (s) => ({ ...s, exam: examId, spacesUnlocked: s.spacesUnlocked || hadSpaces }));
  let mode: LearningMode | null;
  try {
    mode = await addTemplate(examId);
  } catch (err) {
    await updateItem('settings', (s) => ({ ...s, exam: before.settings.exam, spacesUnlocked: before.settings.spacesUnlocked }));
    throw err;
  }
  if (!mode) return null;
  await updateItem('settings', (s) => ({ ...s, activeModeId: examId, focusEnabled: true, onboarded: true, defaultModeId: s.defaultModeId ?? examId }));
  return mode;
}

/** "Not preparing for an exam": nothing is locked, and setup carries on as before. */
export async function skipExam(): Promise<void> {
  await updateItem('settings', (s) => ({ ...s, exam: s.exam && s.exam !== 'none' ? s.exam : 'none' }));
}

/** Settings → "Open every Space now". */
export async function unlockAllSpaces(): Promise<void> {
  await updateItem('settings', (s) => ({ ...s, spacesUnlocked: true }));
}
