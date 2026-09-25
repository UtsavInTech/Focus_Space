import { useEffect, useRef, useState } from 'react';
import { SUGGESTIONS, answer, type AssistantReply } from '../assistant';
import { navigate } from '../router';
import { Logo } from './Logo';

/**
 * The floating assistant.
 *
 * The launcher pulses until the visitor has opened it once, then settles down
 * permanently — a glow that never stops is an animation you learn to ignore,
 * and one that stops the moment it has been acknowledged is the behaviour
 * people actually described wanting. "Seen" is remembered per browser; if
 * storage is unavailable the bubble simply pulses again next visit, which is
 * harmless.
 *
 * Answers come from the site's own content (assistant.ts) — instant, free, and
 * accurate about our own pricing in a way a general model would not be.
 */

interface Turn {
  id: number;
  role: 'visitor' | 'guide';
  text: string;
  actions?: AssistantReply['actions'];
}

const SEEN_KEY = 'fs.assistant.seen';
const GREETING =
  'Hi — I am the FocusSpace guide. Ask me what this does, what it costs in dollars or rupees, or how to get started.';

export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(true); // assume seen until storage says otherwise, so the page never flashes a pulse
  const [turns, setTurns] = useState<Turn[]>([{ id: 0, role: 'guide', text: GREETING }]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    try {
      setSeen(localStorage.getItem(SEEN_KEY) === '1');
    } catch {
      setSeen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ block: 'end' });
      inputRef.current?.focus();
    }
  }, [open, turns]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function toggle() {
    setOpen((v) => !v);
    if (!seen) {
      setSeen(true);
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* the pulse coming back next visit is an acceptable failure */
      }
    }
  }

  function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    const reply = answer(text);
    setTurns((prev) => [
      ...prev,
      { id: nextId.current++, role: 'visitor', text },
      { id: nextId.current++, role: 'guide', text: reply.text, actions: reply.actions },
    ]);
    setDraft('');
  }

  return (
    <div className="fsw-assistant">
      {open && (
        <section className="fsw-assistant-panel" aria-label="FocusSpace guide">
          <header>
            <span className="fsw-assistant-mark">
              <Logo size={20} />
            </span>
            <div>
              <strong>FocusSpace guide</strong>
              <span>Answers about this page · free</span>
            </div>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="fsw-assistant-log" role="log" aria-live="polite">
            {turns.map((turn) => (
              <div key={turn.id} className={`fsw-turn is-${turn.role}`}>
                <p>{turn.text}</p>
                {!!turn.actions?.length && (
                  <div className="fsw-turn-actions">
                    {turn.actions.map((action) => (
                      <button
                        key={action.href + action.label}
                        type="button"
                        onClick={() => {
                          navigate(action.href);
                          setOpen(false);
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {turns.length === 1 && (
              <div className="fsw-assistant-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="fsw-assistant-input"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about FocusSpace…"
              aria-label="Ask about FocusSpace"
            />
            <button type="submit" aria-label="Send" disabled={!draft.trim()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className={`fsw-assistant-launcher${seen ? '' : ' is-pulsing'}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={open ? 'Close the FocusSpace guide' : 'Ask the FocusSpace guide'}
        onClick={toggle}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          // Its rings turn, so the guide reads as something alive to ask, not a decoration in the corner.
          <Logo size={24} animated />
        )}
        {!seen && !open && <span className="fsw-assistant-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
