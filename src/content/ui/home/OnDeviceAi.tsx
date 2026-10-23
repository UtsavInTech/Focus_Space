import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Cpu, Infinity as InfinityIcon, Lock, WifiOff, X, Zap } from 'lucide-react';
import { sendMessage } from '@/messaging/runtime';
import { updateItem } from '@/storage/storage';
import { useStorage } from '@/ui/hooks';

/**
 * On-device AI, said plainly: Chrome ships a small AI model that runs on the learner's own computer.
 * FocusSpace can use it for explanations, quizzes and chat with no credits at all, and nothing leaves
 * the device. Most people never find that setting, so the home page shows it once, with its state:
 * already running, a one-time download away, or not available in this browser (then it says nothing).
 */

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export function useOnDeviceAi(): { availability: Availability; inUse: boolean } | null {
  const [state, setState] = useState<{ availability: Availability; inUse: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    sendMessage('ai/on-device', {})
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ availability: 'unavailable', inUse: false }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** A small badge for anywhere an AI answer appears: "On-device · Free". */
export function OnDeviceBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`fs-ondevice-badge${compact ? ' is-compact' : ''}`} title="Runs on this device with Chrome’s built-in AI. No credits, nothing leaves your computer.">
      <Cpu size={12} aria-hidden />
      On-device{compact ? '' : ' AI'} · <b>Free</b>
    </span>
  );
}

const PERKS = [
  { icon: InfinityIcon, label: 'No credits, ever' },
  { icon: Lock, label: 'Private: stays on your device' },
  { icon: WifiOff, label: 'Works even offline' },
  { icon: Zap, label: 'Instant answers' },
];

export function OnDeviceAiBanner() {
  const reduce = useReducedMotion();
  const ai = useOnDeviceAi();
  const store = useStorage(['ui'] as const);
  if (!ai || !store || store.ui.dismissedOnDeviceAi || ai.availability === 'unavailable') return null;

  const ready = ai.availability === 'available';
  const openSettings = () => void sendMessage('dashboard/open', { route: '/settings' }).catch(() => undefined);
  const dismiss = () => void updateItem('ui', (u) => ({ ...u, dismissedOnDeviceAi: true }));

  return (
    <motion.aside
      className="fs-ondevice"
      aria-label="On-device AI"
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.2, 0, 0, 1], delay: 0.15 }}
    >
      <div className="fs-ondevice-glow" aria-hidden />
      <div className="fs-ondevice-chip" aria-hidden>
        <Cpu size={30} />
      </div>
      <div className="fs-ondevice-copy">
        <span className="fs-ondevice-eyebrow">
          On-device AI <b>Free</b>
        </span>
        <h3>{ready ? 'Your AI tutor runs right on this computer.' : 'Get an AI tutor that never asks for credits.'}</h3>
        <p>
          Chrome has a built-in AI model. FocusSpace uses it to explain, quiz you and answer questions about any video, with <b>zero credits</b> and nothing sent to a server.
        </p>
        <ul className="fs-ondevice-perks">
          {PERKS.map(({ icon: Icon, label }) => (
            <li key={label}>
              <Icon size={14} aria-hidden /> {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="fs-ondevice-actions">
        {ready ? (
          <span className="fs-ondevice-ready">
            <Check size={16} aria-hidden /> {ai.inUse ? 'Active now' : 'Ready on this device'}
          </span>
        ) : (
          <button type="button" className="fs-cta fs-cta-play" onClick={openSettings}>
            {ai.availability === 'downloading' ? 'Downloading… see progress' : 'Turn it on (one-time download)'}
          </button>
        )}
        {ready && !ai.inUse && (
          <button type="button" className="fs-link" onClick={openSettings}>
            Use it for every answer
          </button>
        )}
      </div>
      <button type="button" className="fs-icon-plain fs-ondevice-close" aria-label="Got it, hide this" onClick={dismiss}>
        <X size={16} aria-hidden />
      </button>
    </motion.aside>
  );
}
