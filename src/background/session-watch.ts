import { getItems } from '@/storage/storage';
import { endSession, extendSession, isLive, markLimitReached, remainingMs } from '@/learning/session';
import { findMode } from '@/modes/service';

/** Session end alarms, notifications and the toolbar badge. */

export const SESSION_END_ALARM = 'fs-session-end';
const NOTIFICATION_ID = 'fs-session-limit';

const COLORS = { accent: '#6D5DFC', done: '#16A34A', muted: '#71717A' };

async function setBadge(text: string, color: string) {
  await chrome.action.setBadgeText({ text });
  if (text) await chrome.action.setBadgeBackgroundColor({ color });
}

export async function refreshSessionState(): Promise<void> {
  const { session, settings, modes } = await getItems(['session', 'settings', 'modes']);

  if (!isLive(session)) {
    await chrome.alarms.clear(SESSION_END_ALARM);
    await setBadge(settings.focusEnabled ? '' : 'off', COLORS.muted);
    return;
  }

  const remaining = remainingMs(session);
  if (session.status === 'paused') {
    await chrome.alarms.clear(SESSION_END_ALARM);
    await setBadge('II', COLORS.muted);
    return;
  }

  if (remaining > 0) {
    const minutes = Math.ceil(remaining / 60_000);
    await setBadge(minutes > 99 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`, COLORS.accent);
    await chrome.alarms.create(SESSION_END_ALARM, { when: Date.now() + remaining + 250 });
    return;
  }

  await setBadge('✓', COLORS.done);
  if (!session.limitReachedAt && (await markLimitReached(session.id)) && settings.notifyOnSessionEnd) {
    const mode = findMode(modes, session.modeId);
    const topic = mode?.topics.find((t) => t.id === session.topicId)?.name ?? session.goal;
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: "You've reached your planned learning time",
      message: `${session.plannedMinutes} min${topic ? ` of ${topic}` : ''}${mode ? ` · ${mode.name}` : ''}. Wrap up, or keep going — your call.`,
      buttons: [{ title: 'Keep going (+15 min)' }, { title: 'End session' }],
      priority: 0,
    });
  }
}

export function registerSessionNotificationHandlers() {
  chrome.notifications.onButtonClicked.addListener(async (id, index) => {
    if (id !== NOTIFICATION_ID) return;
    if (index === 0) await extendSession(15);
    else await endSession();
    await chrome.notifications.clear(id);
  });
}
