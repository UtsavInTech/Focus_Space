import { useState, type FormEvent } from 'react';
import type { LearningMode } from '@/types/domain';
import { sendMessage } from '@/messaging/runtime';
import { siteUrl } from '@/config';

/**
 * The two student controls shared by YouTube and the dashboard: joining a course (which happens on the
 * website, where consent is given) and withdrawing sharing or leaving one.
 */

/** A bare join code, or a FocusSpace `/learn/…` or `/join/…` link — anything else is refused, never opened. */
function joinPath(input: string): string {
  if (/^[\w-]{10,100}$/.test(input)) return `/join/${input}`;
  const url = new URL(input);
  if (url.origin !== new URL(siteUrl('/')).origin || !/^\/(learn|join)\/[\w-]+$/.test(url.pathname)) {
    throw new Error('Use your institute’s FocusSpace course link or join code.');
  }
  return url.pathname;
}

export function InstituteJoinControl() {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      void sendMessage('site/open', { path: joinPath(input) });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="fs-row-wrap" onSubmit={submit}>
      <label>
        Institute code or course link <input className="fs-input" value={input} onChange={(e) => setInput(e.target.value)} required />
      </label>
      <button type="submit" className="fs-cta">
        Join course
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

/** Withdrawing sharing never removes the course; leaving does. Neither locks any feature. */
export function InstituteManage({ mode }: { mode: LearningMode }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!mode.source) return null;
  const orgId = mode.source.orgId;

  const run = async (action: 'leave' | 'withdraw') => {
    setBusy(true);
    try {
      if (action === 'leave') await sendMessage('institutes/leave', { modeId: mode.id });
      else await sendMessage('institutes/withdraw', { orgId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fs-row-wrap">
      <button className="fs-link" disabled={busy} onClick={() => void run('withdraw')}>
        Withdraw institute sharing
      </button>
      <button className="fs-link" disabled={busy} onClick={() => void run('leave')}>
        Leave course
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
