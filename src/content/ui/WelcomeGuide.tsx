import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import type { LearningMode, Settings } from '@/types/domain';
import { activeModeOf } from '@/modes/service';
import { updateItem } from '@/storage/storage';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { openSignIn } from '@/ui/account/use-can-save';
import { FocusMark } from '@/ui/components/primitives';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT } from '@/billing/plans';
import { WELCOME_STEPS, welcomeStep } from './welcome-step';
import { SetupChat } from './SetupChat';

/**
 * The first thing a new learner sees beside "What do you want to focus on?": a short conversation that
 * walks them through signing in, setting up their Spaces — by picking, typing or just talking
 * (./SetupChat.tsx) — and bringing in the channels they already follow.
 *
 * Shown once per install (background/service-worker.ts switches it on), docked bottom-left so the
 * subjects on the page stay clickable. The step it is on follows the account, the Spaces and the
 * conversation (./welcome-step.ts), so signing in on the website or picking a subject on the page
 * moves it along by itself.
 */
export function WelcomeGuide(props: { settings: Settings; modes: LearningMode[] }) {
  // Whatever goes wrong in the guide stays in the guide: YouTube and the rest of FocusSpace carry on.
  return (
    <GuideBoundary>
      <Guide {...props} />
    </GuideBoundary>
  );
}

class GuideBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FocusSpace] The welcome guide hit an error and closed itself:', error, info.componentStack);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Guide({ settings, modes }: { settings: Settings; modes: LearningMode[] }) {
  const store = useStorage(['welcome', 'auth'] as const);
  const [collapsed, setCollapsed] = useState(false);
  const [waitingForSignIn, setWaitingForSignIn] = useState(false);
  const [spaceLimit, setSpaceLimit] = useState<number | null | undefined>(undefined);
  /** Their name from the account (Google gives one), so the guide says "Hey Utsav" — never their email. */
  const [name, setName] = useState<string | null>(null);
  const signedIn = !!store?.auth.user;

  useEffect(() => {
    if (!signedIn) {
      setSpaceLimit(undefined);
      setName(null);
      return;
    }
    sendMessage('spaces/allowance', {})
      .then((a) => setSpaceLimit(a ? a.limit : FREE_SPACE_LIMIT))
      .catch(() => setSpaceLimit(FREE_SPACE_LIMIT));
    sendMessage('account/profile', {})
      .then((user) => setName(user?.name?.trim() || null))
      .catch(() => setName(null));
  }, [signedIn]);

  if (!store) return null;
  const mode = activeModeOf(settings, modes);
  const step = welcomeStep(store.welcome, signedIn, settings.onboarded && !!mode);
  if (!step) return null;

  const finish = () => void updateItem('welcome', (w) => ({ ...w, active: false }));
  const stepIndex = WELCOME_STEPS.findIndex((s) => s.id === step);

  // Minimising hides the panel rather than unmounting it, so a conversation in progress survives.
  return (
    <>
      {collapsed && (
        <button type="button" className="fs-welcome-mini" onClick={() => setCollapsed(false)} aria-label="Open the FocusSpace guide">
          <FocusMark size={18} active />
          <span>
            Step {stepIndex + 1} of {WELCOME_STEPS.length} · {WELCOME_STEPS[stepIndex].label}
          </span>
        </button>
      )}
      <section className="fs-welcome" role="dialog" aria-label="Getting started with FocusSpace" hidden={collapsed}>
        <header className="fs-welcome-head">
          <FocusMark size={20} active />
          <strong>FocusSpace guide</strong>
          <button type="button" className="fs-icon-plain" aria-label="Minimise the guide" title="Minimise" onClick={() => setCollapsed(true)}>
            <ChevronDown size={16} aria-hidden />
          </button>
          <button type="button" className="fs-icon-plain" aria-label="Close the guide" title="Close the guide" onClick={finish}>
            <X size={16} aria-hidden />
          </button>
        </header>

        <ol className="fs-welcome-steps">
          {WELCOME_STEPS.map((s, i) => (
            <li key={s.id} data-state={i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'next'} aria-current={i === stepIndex ? 'step' : undefined}>
              <span className="fs-welcome-step-dot">{i < stepIndex ? <Check size={12} aria-hidden /> : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        <div className="fs-welcome-chat" aria-live="polite">
          {step === 'signin' && (
            <SignInStep
              waiting={waitingForSignIn}
              onSignIn={() => {
                setWaitingForSignIn(true);
                openSignIn();
              }}
              onLater={() => void updateItem('welcome', (w) => ({ ...w, signInSkipped: true }))}
            />
          )}
          {step === 'space' && (
            <SetupChat
              modes={modes}
              saved={store.welcome.chat}
              signedIn={signedIn}
              name={name ?? store.auth.user?.name ?? null}
              intro={<SpaceIntro signedIn={signedIn} name={name ?? store.auth.user?.name ?? null} spaceLimit={signedIn ? spaceLimit : GUEST_SPACE_LIMIT} />}
              onDone={() => void updateItem('welcome', (w) => ({ ...w, chat: w.chat ? { ...w.chat, finished: true } : w.chat }))}
            />
          )}
          {step === 'channels' && (
            <ChannelsStep
              spaceName={mode?.name ?? null}
              onImport={() => {
                void sendMessage('dashboard/open', { route: '/subscriptions' }).catch(() => undefined);
                finish();
              }}
              onDone={finish}
            />
          )}
        </div>
      </section>
    </>
  );
}

function Bot({ children }: { children: ReactNode }) {
  return <p className="fs-welcome-msg">{children}</p>;
}

function SignInStep({ waiting, onSignIn, onLater }: { waiting: boolean; onSignIn: () => void; onLater: () => void }) {
  return (
    <>
      <Bot>Hey, thank you for adding FocusSpace, I really appreciate it.</Bot>
      <Bot>I’ll walk you through the three steps above. It takes about a minute.</Bot>
      <Bot>
        <b>Step 1 is to sign in.</b> It’s free, and it unlocks everything: {FREE_SPACE_LIMIT} Spaces instead of {GUEST_SPACE_LIMIT}, a monthly AI allowance, and saving notes and mind
        maps to your Library. I recommend doing this first.
      </Bot>
      {waiting && <Bot>Finish on the FocusSpace tab. New here or not, it’s the same button. I’ll bring you straight back to this tab when you’re in.</Bot>}
      <div className="fs-welcome-actions">
        <button type="button" className="fs-pill-button" onClick={onSignIn}>
          {waiting ? 'Open sign-in again' : 'Sign in / Create account'}
        </button>
        <button type="button" className="fs-link" onClick={onLater}>
          Maybe later
        </button>
      </div>
    </>
  );
}

function SpaceIntro({ signedIn, name, spaceLimit }: { signedIn: boolean; name: string | null; spaceLimit: number | null | undefined }) {
  const allowance = spaceLimit === undefined ? null : spaceLimit === null ? 'unlimited Spaces' : `${spaceLimit} Spaces`;
  const first = name?.split(/\s+/)[0] ?? null;
  return (
    <>
      {signedIn ? (
        <Bot>
          {first ? `Hey ${first}, you’re signed in!` : 'You’re signed in!'} {allowance ? `Your account holds ${allowance}.` : ''}
        </Bot>
      ) : (
        <Bot>No problem, you can sign in any time from FocusSpace’s home. Without an account you can keep {GUEST_SPACE_LIMIT} Spaces.</Bot>
      )}
      <Bot>Okay, let’s set up your Spaces. Pick subjects on this page, or just tell me everything you want to learn, like “system design, Spanish and French”, and I’ll set each one up and ask about your favourite creators.</Bot>
      <Bot>Prefer talking? Tap the round button and just say it.</Bot>
    </>
  );
}

function ChannelsStep({ spaceName, onImport, onDone }: { spaceName: string | null; onImport: () => void; onDone: () => void }) {
  return (
    <>
      <Bot>
        <b>Last step: your channels.</b> Bring in the YouTube channels you already subscribe to. FocusSpace sorts them into your Spaces and uses them to recommend better videos
        {spaceName ? `, starting with ${spaceName}` : ''}.
      </Bot>
      <Bot>
        It opens FocusSpace home → <b>Subscribed channels</b>. Your Spaces, Library and history live there too, under <b>FocusSpace</b> in YouTube’s left sidebar.
      </Bot>
      <div className="fs-welcome-actions">
        <button type="button" className="fs-pill-button" onClick={onImport}>
          Import my subscriptions
        </button>
        <button type="button" className="fs-link" onClick={onDone}>
          I’ll do it later
        </button>
      </div>
    </>
  );
}
