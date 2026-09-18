import type { ChannelRef, FilterConfig, FocusIntensity, LearningMode, Settings } from '@/types/domain';
import type { SpaceAllowanceView } from '@/types/account';
import { sendMessage } from '@/messaging/runtime';
import { getItems, updateItem, setItems } from '@/storage/storage';
import { FILTER_PRESETS } from '@/storage/schema';
import { uniqueId } from '@/learning/text';
import { blankMode, DEFAULT_MODES } from './templates';

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

async function authorizeSpace(id: string, name: string): Promise<void> {
  const modes = await getItems(['modes']).then((s) => s.modes);
  if (modes.some((m) => m.id === id)) return; // already exists locally: an update, not a new Space
  const result = await sendMessage('spaces/authorize', { spaceId: id, name }).catch(() => ({ ok: true as const, allowance: null }));
  if (!result.ok) throw new SpaceLimitError(result.error, result.allowance);
}

/** Frees the Space's slot on the server. Best-effort — local deletion must never depend on it. */
const releaseSpace = (id: string) => void sendMessage('spaces/release', { spaceId: id }).catch(() => undefined);

export const findMode = (modes: LearningMode[], id: string | null | undefined) => (id ? modes.find((m) => m.id === id) ?? null : null);

export const activeModeOf = (settings: Settings, modes: LearningMode[]) => findMode(modes, settings.activeModeId);

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
  await updateItem('settings', (s) => ({ ...s, focusEnabled: enabled && !!activeModeId, activeModeId }));
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
