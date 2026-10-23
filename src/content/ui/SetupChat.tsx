import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard, Mic, Square, Undo2, X } from 'lucide-react';
import type { ChannelRef, LearningMode } from '@/types/domain';
import type { SetupAction, SetupPickAnswer, SetupTurnAnswer, SetupTurnState } from '@/types/setup';
import { WELCOME_CHAT_MAX_LINES, type WelcomeChat, type WelcomeLine } from '@/storage/schema';
import { addMode, chooseExam, deleteMode, setChannelRule, SpaceLimitError } from '@/modes/service';
import { examInfo } from '@/modes/exams';
import { examFromText } from '@/modes/exam-intent';
import { ExamPicker } from './ExamPicker';
import { DEFAULT_MODES } from '@/modes/templates';
import { inferSubjects } from '@/modes/subjects';
import { getItem, updateItem } from '@/storage/storage';
import { sendMessage } from '@/messaging/runtime';
import { OverlayRootContext } from '@/ui/components/Modal';
import { FocusMark } from '@/ui/components/primitives';
import { findChannel, modeFromPlan, offlineTurn, pickByName, planFromSuggestion, spokenList } from './setup-plan';
import { audioContext, blobToBase64, MicrophoneBlockedError, prepareFillers, VoiceConversation, type VoiceState } from './voice';
import { Composer } from './Composer';
import { openSignIn } from '@/ui/account/use-can-save';

/**
 * The setup assistant: say or type what you want to learn — one subject or five — and it sets the
 * Spaces up with their subtopics, asks about favourite creators for each one, and reports what it did.
 *
 * Every message is one *turn*, read by the server against the whole conversation (every Space and the
 * creators already in it, and the question that is open) and answered with actions: create a Space,
 * add or remove creators, drop a Space, "no creators for this one". That is what lets someone go back —
 * "wait, in DSA I said Telusko" swaps the wrong channel out of DSA and leaves the open question about
 * System Design still open. Creator questions are a queue, so a correction never answers one by
 * accident; every "Added …" line also has an Undo.
 *
 * It keeps its words few: the AI's reply is one short sentence, results are shown rather than read out,
 * and questions are brief. Talk opens a hands-free spoken conversation (./voice.ts) — the page blurs
 * behind one orb; you can talk over it; when setup is done it closes by itself and points at Next.
 * The conversation is saved (storage `welcome.chat`), so a refresh or another tab carries on.
 */

type Phase = WelcomeChat['phase'];
type Made = WelcomeChat['made'][number];

/** "let's talk", "can we talk?", "voice", "baat karte hain" — asking to switch to voice. */
const WANTS_TO_TALK = /^\s*(let'?s|lets|can we|could we|i want to|i'd like to|wanna)?\s*(talk|speak|chat by voice|use (my )?voice|voice( mode)?|baat karte hain|baat karo)\b[\s?!.]*$/i;

/** "Hey Utsav! Okay, let's start." — by name when the account has one, never by email address. */
const greeting = (name: string | null) =>
  `${name ? `Hi ${name.split(/\s+/)[0]}!` : 'Hi!'} Let’s go quick. Tell me your Spaces, and the creators you like for each, all in one go. Like: DSA with Love Babbar and Apna College, and Spanish.`;

/** The guide's first question on a new install (modes/exams.ts). */
const EXAM_QUESTION = 'First, which exam are you preparing for? UPSC, SSC, banking, railways, JEE, NEET, GATE or CAT? Or tell me what else you want to learn.';

/** Asked once creators come Space by Space ("Go one by one"). */
const FIRST_SPACE = 'Sure, one at a time. What’s your first Space?';

const synthesize = async (text: string) => {
  const res = await sendMessage('voice/speak', { text, purpose: 'setup' }).catch(() => null);
  return res?.ok ? res.audio : null;
};

export function SetupChat({
  modes,
  saved,
  intro,
  onDone,
  onSkip,
  signedIn,
  name,
  oneByOne,
  talked,
  exam,
}: {
  /** settings.exam: `null` while the guide still has to ask which exam they prepare for. */
  exam: string | null;
  modes: LearningMode[];
  saved: WelcomeChat | null;
  intro: ReactNode;
  onDone: () => void;
  /** "Skip, I’ll set up myself". */
  onSkip: () => void;
  signedIn: boolean;
  name: string | null;
  /** Creators Space by Space; otherwise the guide asks once and moves on. */
  oneByOne: boolean;
  /** They have talked to the guide: the Talk button stops glowing. */
  talked: boolean;
}) {
  const [lines, setLines] = useState<WelcomeLine[]>(saved?.lines ?? []);
  const [phase, setPhaseState] = useState<Phase>(saved?.phase ?? 'subjects');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [text, setText] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  /** Setup is finished: Next glows until it is pressed. */
  const [pointAtNext, setPointAtNext] = useState(false);
  const overlayRoot = useContext(OverlayRootContext);

  // The conversation runs across awaits and voice callbacks, so what it reads lives in refs.
  const phaseRef = useRef<Phase>(phase);
  const modesRef = useRef(modes);
  modesRef.current = modes;
  const made = useRef<Made[]>(saved?.made ?? []);
  /** Spaces still to be asked about creators; the first one is the open question. */
  const pending = useRef<string[]>(saved?.pending ?? []);
  const nextId = useRef(Math.max(0, ...(saved?.lines ?? []).map((l) => l.id)) + 1);
  const convo = useRef<VoiceConversation | null>(null);
  const filler = useRef<() => string | null>(() => null);
  const orb = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const alive = useRef(true);
  /** The Space YouTube is showing — the latest one created here or picked on the page. */
  const activeId = useRef<string | null>(null);
  /** Spaces the conversation already knows about — anything new that appears was picked on the page. */
  const known = useRef<Set<string>>(new Set([...modes.map((m) => m.id), ...(saved?.made ?? []).map((m) => m.id)]));

  /** The exam question is still open: nothing made yet, and the learner hasn't answered it. */
  const askingExam = exam === null && modes.length === 0 && made.current.length === 0;

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // Keep the newest line in view — by scrolling the chat itself, never YouTube's page. (The braces
  // matter: in Chrome, scrollIntoView now returns a Promise, and an effect must return nothing.)
  useEffect(() => {
    const chat = end.current?.parentElement;
    if (chat) chat.scrollTop = chat.scrollHeight;
  }, [lines, busy, pointAtNext]);

  // Saved on every change — and once as soon as step 2 opens, so a Space picked on the page instead of
  // here keeps the guide on this step (welcome-step.ts) rather than jumping past the creator question.
  useEffect(() => {
    const chat: WelcomeChat = { phase, made: made.current, pending: pending.current, lines: lines.slice(-WELCOME_CHAT_MAX_LINES), finished: false };
    void updateItem('welcome', (w) => ({ ...w, chat: w.chat?.finished ? w.chat : chat }));
  }, [lines, phase]);

  useEffect(
    () => () => {
      alive.current = false;
      convo.current?.close();
    },
    [],
  );

  // A Space picked on the page ("What do you want to focus on?", or "Something else"): acknowledge it,
  // and carry on from there — ask about creators unless the page's own creator step already added some.
  useEffect(() => {
    if (busy) return;
    const fresh = modes.filter((m) => !known.current.has(m.id));
    if (!fresh.length) return;
    fresh.forEach((m) => known.current.add(m.id));
    activeId.current = fresh[fresh.length - 1].id;
    made.current = [...made.current, ...fresh.map((m) => ({ id: m.id, name: m.name, channels: m.allowedChannels.map((c) => c.title) }))];
    for (const m of fresh) {
      const creators = m.allowedChannels.map((c) => c.title);
      say(creators.length ? `Nice, ${m.name} is ready, with ${spokenList(creators)}.` : `Nice, ${m.name} is ready, with ${m.topics.length} subtopics.`);
    }
    const toAsk = fresh.filter((m) => !m.allowedChannels.length).map((m) => m.id);
    pending.current = [...pending.current, ...toAsk.filter((id) => !pending.current.includes(id))];
    if (phaseRef.current !== 'channels') {
      if (pending.current.length) next(false, true);
      else ask('Another Space, or a creator for one of these? Or tap Next.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modes, busy]);

  const add = (from: WelcomeLine['from'], said: string, undo?: WelcomeLine['undo']) => {
    const id = nextId.current++;
    setLines((l) => [...l, { id, from, text: said, ...(undo ? { undo } : {}) }]);
    return id;
  };
  const replace = (id: number, said: string) => setLines((l) => l.map((line) => (line.id === id ? { id: line.id, from: line.from, text: said } : line)));

  /** Shown and, in a spoken conversation, said. */
  const say = (said: string, undo?: WelcomeLine['undo']) => {
    add('bot', said, undo);
    void convo.current?.say(said);
  };
  /** Shown only — results ("Added Telusko to DSA") are there to read, not to be read out. */
  const note = (said: string, undo?: WelcomeLine['undo']) => add('bot', said, undo);
  /** Says something that needs an answer — and, in a spoken conversation, listens once it has said it. */
  const ask = (said: string) => {
    say(said);
    convo.current?.listenAfterSpeaking();
  };

  const nameOf = (id: string) => made.current.find((m) => m.id === id)?.name ?? modesRef.current.find((m) => m.id === id)?.name ?? id;
  const openQuestion = (): SetupTurnState['asking'] =>
    phaseRef.current === 'channels' && pending.current[0] ? { kind: 'channels', space: nameOf(pending.current[0]) } : phaseRef.current === 'subjects' ? { kind: 'subjects' } : null;

  /* ── Talking ───────────────────────────────────────────────────────────── */

  const openVoice = async () => {
    if (convo.current) return;
    if (!talked) void updateItem('welcome', (w) => ({ ...w, talked: true }));
    audioContext(); // unlocked by this click or keypress, so replies can be heard
    const conversation = new VoiceConversation({
      synthesize,
      transcribe: async (audio, mime) => {
        const q = openQuestion();
        const hint = `${q?.kind === 'channels' ? `They were asked for a favourite creator for ${q.space}.` : 'They are naming subjects to learn.'} Their Spaces: ${modesRef.current.map((m) => m.name).join(', ')}.`;
        const res = await sendMessage('voice/transcribe', { audio: await blobToBase64(audio), mime, hint, purpose: 'setup' }).catch(() => null);
        if (res && !res.ok) note(res.error);
        return res?.ok ? res.text : null;
      },
      onState: setVoiceState,
      onLevel: (l) => orb.current?.style.setProperty('--fs-level', l.toFixed(3)),
      onHeard: (said) => void respond(said),
      onMissed: () => undefined, // the orb says "Tap to talk"; nothing to apologise for
    });
    try {
      await conversation.start();
    } catch (err) {
      say(err instanceof MicrophoneBlockedError ? 'I can’t hear you. The microphone is blocked for YouTube. Allow it from the icon at the left of the address bar, or just type.' : 'Your browser won’t let me listen right now, you can type instead.');
      return;
    }
    convo.current = conversation;
    filler.current = prepareFillers(synthesize);
    setVoiceOpen(true);
    setPointAtNext(false);
    // Pick the conversation up where it is: a greeting at the start, otherwise the open question again.
    const q = openQuestion();
    if (q?.kind === 'channels') ask(`So, ${q.space}. Any teacher or channel you like? Or skip.`);
    else if (phaseRef.current === 'done') ask('Another Space, or a different creator? Just tell me.');
    else ask(made.current.length ? 'What else would you like to learn or watch?' : askingExam ? EXAM_QUESTION : oneByOne ? FIRST_SPACE : greeting(name));
  };

  const closeVoice = () => {
    convo.current?.close();
    convo.current = null;
    setVoiceOpen(false);
    setVoiceState('idle');
  };

  useEffect(() => {
    if (!voiceOpen) return;
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeVoice();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOpen]);

  /** The orb: tap to talk, tap again when done (it notices on its own when you stop), tap to interrupt it. */
  const tapOrb = () => {
    const c = convo.current;
    if (!c) return;
    if (voiceState === 'listening') c.stopListening();
    else if (!busy && voiceState !== 'hearing') c.listen();
  };

  /* ── One turn ──────────────────────────────────────────────────────────── */

  const respond = async (said: string) => {
    add('you', said);
    if (WANTS_TO_TALK.test(said)) return void openVoice();
    setBusy(true);
    // No dead air: a short "Okay…" the moment they stop, while the answer is worked out.
    convo.current?.sayPrepared(filler.current());
    convo.current?.thinking();
    try {
      await turn(said);
    } finally {
      if (alive.current) {
        setBusy(false);
        setSlow(false);
      }
      convo.current?.idle();
    }
  };

  const turn = async (said: string) => {
    // "I'm preparing for UPSC": build the exam's Space here, exactly as tapping it would. The page's
    // new-Space effect above then acknowledges it and carries on to creators.
    const examId = askingExam ? examFromText(said) : null;
    if (examId) {
      try {
        await chooseExam(examId);
      } catch (err) {
        say(err instanceof SpaceLimitError ? err.message : 'I couldn’t set that up just now. Try again?');
      }
      return;
    }
    const asking = openQuestion();
    const slowTimer = window.setTimeout(() => setSlow(true), 3000);
    const state: SetupTurnState = {
      spaces: modesRef.current.map((m) => ({ name: m.name, channels: m.allowedChannels.map((c) => c.title), isNew: made.current.some((x) => x.id === m.id) })),
      asking,
    };
    const res = await sendMessage('setup/understand', { task: 'turn', text: said, state, catalog: DEFAULT_MODES.map((m) => ({ id: m.id, name: m.name })) }).catch(() => null);
    window.clearTimeout(slowTimer);
    const answer: SetupTurnAnswer = res?.ok && 'actions' in res.answer ? (res.answer as SetupTurnAnswer) : offlineTurn(said, asking, (t) => inferSubjects(t).map(planFromSuggestion));
    say(answer.reply);

    const created = await createSpaces(answer.actions.filter((a): a is Extract<SetupAction, { type: 'create_space' }> => a.type === 'create_space'));
    const settled = new Set<string>(); // Spaces whose creator question this turn answered
    for (const action of answer.actions) {
      if (action.type === 'create_space') continue;
      const mode = findMode(action.space);
      if (!mode) {
        if (action.type !== 'no_channels') say(`Which Space is ${action.space}? I couldn’t find it.`);
        continue;
      }
      if (action.type === 'no_channels') settled.add(mode.id);
      else if (action.type === 'remove_channels') await removeChannels(mode, action.names);
      else if (action.type === 'add_channels') {
        if (await addChannels(mode, action.names, said)) settled.add(mode.id);
      } else if (action.type === 'remove_space') await removeSpace(mode);
    }

    if (created.length) {
      const first = created[0];
      const topics = first.topics.slice(0, 3).map((t) => t.name);
      note(created.length === 1 ? `${first.name} is ready with ${first.topics.length} subtopics, like ${spokenList(topics)}.` : `Created ${spokenList(created.map((m) => m.name))}, each with its own subtopics.`);
    }
    if (!answer.actions.length) return convo.current?.listenAfterSpeaking(); // the reply already asked what they'd like

    // The question queue: settled Spaces leave it, new Spaces join its end.
    const openId = asking?.kind === 'channels' ? pending.current[0] : undefined;
    pending.current = [
      ...pending.current.filter((id) => !settled.has(id) && modesRef.current.some((m) => m.id === id)),
      ...created.map((m) => m.id).filter((id) => !settled.has(id) && !pending.current.includes(id)),
    ];
    // Going quick: one invitation to name creators in the summary, not a question per Space.
    if (!oneByOne) pending.current = [];
    next(!!openId && pending.current[0] === openId, created.length > 0);
  };

  /** What to ask after a turn: the same creator question again, the next one, or the report. */
  const next = (stillOpen: boolean, justCreated: boolean) => {
    const id = pending.current[0];
    if (!id) {
      if (phaseRef.current === 'done') return finish(false);
      return finish(true);
    }
    const firstTime = phaseRef.current !== 'channels';
    setPhase('channels');
    const name = nameOf(id);
    if (firstTime || (justCreated && !stillOpen)) ask(`Any favourite creators? Let’s start with ${name}. A name, or skip?`);
    else if (stillOpen) ask(`And for ${name}, anyone you like? Or skip.`);
    else ask(`${name} next, any creator you like? Or skip.`);
  };

  const findMode = (name: string): LearningMode | null => {
    const key = name.trim().toLowerCase();
    return modesRef.current.find((m) => m.name.toLowerCase() === key || m.id === key) ?? null;
  };

  /* ── Actions ───────────────────────────────────────────────────────────── */

  const createSpaces = async (actions: Extract<SetupAction, { type: 'create_space' }>[]): Promise<LearningMode[]> => {
    const created: LearningMode[] = [];
    for (const { space: plan } of actions) {
      const mode = modeFromPlan(plan, [...modesRef.current.map((m) => m.id), ...created.map((m) => m.id)]);
      try {
        known.current.add(mode.id);
        await addMode(mode);
        created.push(mode);
      } catch (err) {
        if (err instanceof SpaceLimitError) {
          say(`${err.message}${created.length ? ` I set up the first ${created.length}.` : ''}`);
          break;
        }
        say(`I couldn’t create ${plan.name}. Carrying on with the rest.`);
      }
    }
    if (!created.length) return created;
    // The first new Space is where they land, exactly as picking one on the page would do.
    await updateItem('settings', (s) => ({ ...s, activeModeId: created[0].id, focusEnabled: true, onboarded: true, defaultModeId: s.defaultModeId ?? created[0].id }));
    activeId.current = created[0].id;
    made.current = [...made.current, ...created.map((m) => ({ id: m.id, name: m.name, channels: [] }))];
    // Later actions in this turn ("DSA with Striver") must see the new Spaces before storage echoes back.
    modesRef.current = [...modesRef.current, ...created];
    return created;
  };

  /** Search YouTube for each name, let the AI choose the channel they mean, add it. True when every name was found. */
  const addChannels = async (mode: LearningMode, names: string[], said: string): Promise<boolean> => {
    const searched = await Promise.all(names.map((name) => sendMessage('youtube/search-channels', { query: name }).catch(() => null)));
    const items = names.map((name, i) => {
      const found = searched[i];
      return { name, results: found?.ok ? found.channels.slice(0, 5) : [] };
    });
    const askable = items.filter((it) => it.results.length);
    let picks: (number | null)[] = items.map(() => null);
    if (askable.length) {
      const res = await sendMessage('setup/understand', {
        task: 'pick',
        text: said,
        space: mode.name,
        items: askable.map((it) => ({ name: it.name, candidates: it.results.map((c) => ({ title: c.title, handle: c.handle, subscribers: c.subscribersText, description: c.description })) })),
      }).catch(() => null);
      const chosen = res?.ok && 'picks' in res.answer ? (res.answer as SetupPickAnswer).picks : askable.map((it) => pickByName(it.name, it.results.map((c) => c.title)));
      picks = items.map((it) => (it.results.length ? (chosen[askable.indexOf(it)] ?? null) : null));
    }

    const added: ChannelRef[] = [];
    const missed: string[] = [];
    for (const [i, it] of items.entries()) {
      const pick = picks[i];
      const channel = pick === null ? undefined : it.results[pick];
      if (!channel) {
        missed.push(it.name);
        continue;
      }
      const ref: ChannelRef = { id: channel.id, title: channel.title, handle: channel.handle ?? undefined };
      await setChannelRule(mode.id, ref, 'allowed');
      void sendMessage('channel/add', { input: channel.id }).catch(() => undefined);
      added.push(ref);
    }
    const entry = made.current.find((m) => m.id === mode.id);
    if (entry) entry.channels = [...new Set([...entry.channels, ...added.map((c) => c.title)])];
    if (added.length) note(`Added ${spokenList(added.map((c) => c.title))} to ${mode.name}.`, { modeId: mode.id, channels: added.map((c) => ({ id: c.id, title: c.title, ...(c.handle ? { handle: c.handle } : {}) })) });
    if (missed.length) say(`I couldn’t find ${spokenList(missed)} on YouTube. Could you spell ${missed.length === 1 ? 'it' : 'them'}?`);
    return added.length > 0 && !missed.length;
  };

  const removeChannels = async (mode: LearningMode, names: string[]) => {
    const current = (await getItem('modes')).find((m) => m.id === mode.id)?.allowedChannels ?? mode.allowedChannels;
    const removed: string[] = [];
    for (const name of names) {
      const i = findChannel(
        current.map((c) => c.title),
        name,
      );
      if (i === -1) continue;
      await setChannelRule(mode.id, current[i], null);
      removed.push(current[i].title);
    }
    const entry = made.current.find((m) => m.id === mode.id);
    if (entry) entry.channels = entry.channels.filter((c) => !removed.includes(c));
    note(removed.length ? `Removed ${spokenList(removed)} from ${mode.name}.` : `${spokenList(names)} wasn’t in ${mode.name}.`);
  };

  /** Only Spaces made in this conversation — anything older is theirs to delete from FocusSpace home. */
  const removeSpace = async (mode: LearningMode) => {
    if (!made.current.some((m) => m.id === mode.id)) return say(`${mode.name} was there before we started. You can delete it from FocusSpace home.`);
    await deleteMode(mode.id);
    made.current = made.current.filter((m) => m.id !== mode.id);
    modesRef.current = modesRef.current.filter((m) => m.id !== mode.id);
    note(`Removed the ${mode.name} Space.`);
  };

  /** Undo on an "Added …" line: take those creators back out and ask again for that Space. */
  const undo = async (line: WelcomeLine) => {
    if (!line.undo || busy) return;
    const { modeId, channels } = line.undo;
    for (const c of channels) await setChannelRule(modeId, { id: c.id, title: c.title, handle: c.handle }, null);
    const entry = made.current.find((m) => m.id === modeId);
    if (entry) entry.channels = entry.channels.filter((t) => !channels.some((c) => c.title === t));
    replace(line.id, `Removed ${spokenList(channels.map((c) => c.title))} from ${nameOf(modeId)}.`);
    pending.current = [modeId, ...pending.current.filter((id) => id !== modeId)];
    setPointAtNext(false);
    setPhase('channels');
    ask(`Who did you mean for ${nameOf(modeId)}? Spelling it helps, or say skip.`);
  };

  /* ── Report ────────────────────────────────────────────────────────────── */

  /** Setup is done: one short summary, then Next glows — and a spoken conversation ends by itself. */
  const finish = (firstTime: boolean) => {
    setPhase('done');
    const summary = made.current.map((s) => (s.channels.length ? `${s.name} with ${spokenList(s.channels)}` : s.name));
    const active = modesRef.current.find((m) => m.id === activeId.current)?.name ?? made.current[made.current.length - 1]?.name;
    const noCreators = !oneByOne && made.current.some((s) => !s.channels.length);
    const said =
      firstTime && summary.length
        ? `Done! ${spokenList(summary)}. You’re on ${active} now.${noCreators ? ' Want creators in them? Just say it, like “Love Babbar for DSA”.' : ''} Otherwise tap Next and we’ll import your subscriptions, so recommendations start from channels you already trust.`
        : 'Done. Tap Next when you’re happy.';
    add('bot', said);
    setPointAtNext(true);
    const c = convo.current;
    if (!c) return;
    void c.say(said).then(() => {
      if (convo.current === c) closeVoice();
    });
  };

  /* ── Input ─────────────────────────────────────────────────────────────── */

  const send = () => {
    const said = text.trim();
    if (!said || busy) return;
    setText('');
    convo.current?.interrupt();
    void respond(said);
  };

  const lastYou = [...lines].reverse().find((l) => l.from === 'you');
  const lastBot = [...lines].reverse().find((l) => l.from === 'bot');
  const shown: VoiceState = busy && (voiceState === 'idle' || voiceState === 'thinking') ? 'thinking' : voiceState;
  const status =
    shown === 'listening' ? 'Listening… just talk. I’ll know when you’re done' : shown === 'hearing' || shown === 'thinking' ? 'Thinking…' : shown === 'speaking' ? 'Talk over me any time' : 'Tap the orb to talk';
  const showNext = phase === 'done' || (phase === 'subjects' && made.current.length > 0 && !busy);

  return (
    <>
      {intro}
      {lines.map((line, i) => (
        <div key={line.id} className={`fs-welcome-line${line.from === 'you' ? ' is-you' : ''}`}>
          {/* Who is speaking, once per run — the intro above is the guide's, so its first reply needs no label. */}
          {line.from !== (i === 0 ? 'bot' : lines[i - 1].from) && <span className="fs-welcome-who">{line.from === 'you' ? 'You' : 'FocusSpace'}</span>}
          <p className={`fs-welcome-msg${line.from === 'you' ? ' fs-welcome-msg-you' : ''}`}>{line.text}</p>
          {line.undo && (
            <button type="button" className="fs-welcome-undo" onClick={() => void undo(line)} disabled={busy}>
              <Undo2 size={13} aria-hidden /> Undo
            </button>
          )}
        </div>
      ))}
      {busy && (
        <div className="fs-welcome-typing" aria-label="Working on it">
          <span />
          <span />
          <span />
          {slow && <em>Still working on it…</em>}
        </div>
      )}

      {askingExam && !busy && (
        <ExamPicker
          compact
          onPick={(id) => add('you', `I’m preparing for ${examInfo(id)?.label ?? id}`)}
          onSkip={() => add('bot', oneByOne ? FIRST_SPACE : 'No problem! Tell me your Spaces and the creators you like for each, like: DSA with Love Babbar, and Spanish.')}
        />
      )}

      {!askingExam && !lines.length && !made.current.length && !busy && (
        <div className="fs-welcome-actions">
          {!oneByOne && (
            <button
              type="button"
              className="fs-link"
              onClick={() => {
                void updateItem('welcome', (w) => ({ ...w, oneByOne: true }));
                add('bot', FIRST_SPACE);
              }}
            >
              Go one by one
            </button>
          )}
          <button type="button" className="fs-link" onClick={onSkip}>
            Skip, I’ll set up myself
          </button>
        </div>
      )}

      {showNext && (
        <div className="fs-welcome-actions">
          <button
            type="button"
            className={`fs-pill-button${pointAtNext ? ' is-pointed' : ''}`}
            onClick={() => {
              closeVoice();
              onDone();
            }}
          >
            Next: your channels
          </button>
        </div>
      )}
      <div ref={end} />

      {signedIn && !talked && !voiceOpen && (
        <p className="fs-welcome-talk-hint" aria-hidden>
          Stuck? Let’s talk it out
        </p>
      )}
      <Composer
        glowTalk={signedIn && !talked}
        className="fs-welcome-input"
        inputRef={input}
        value={text}
        onChange={setText}
        onSend={send}
        onTalk={() => void openVoice()}
        placeholder={phase === 'channels' ? 'A name, “skip”, or a correction' : askingExam ? 'Type your exam, like UPSC or SSC CGL' : 'Type, like DSA and Spanish'}
        label="Type to the FocusSpace guide"
        disabled={busy}
        purpose="setup"
        // Signed out, voice is for setting up only; once that's done, talking needs an account.
        voiceAllowed={signedIn || phase !== 'done'}
        onNeedSignIn={() => {
          note('Talking after setup needs a free account. It includes voice minutes every month. Opening sign-in…');
          openSignIn();
        }}
        hint={`Setting up FocusSpace. Their Spaces: ${modes.map((m) => m.name).join(', ')}.`}
        onError={note}
      />

      {voiceOpen &&
        createPortal(
          <div className="fs-voice-mode" role="dialog" aria-modal="true" aria-label="Talking with the FocusSpace guide">
            <div className="fs-voice-card">
              <header className="fs-voice-head">
                <FocusMark size={18} active />
                <span>FocusSpace guide</span>
                <button type="button" className="fs-icon-plain" aria-label="End the conversation" title="End (Esc)" onClick={closeVoice}>
                  <X size={16} aria-hidden />
                </button>
              </header>

              <button type="button" className="fs-voice-stage" data-state={shown === 'hearing' ? 'thinking' : shown} onClick={tapOrb} aria-label={shown === 'listening' ? 'Done talking' : 'Talk'}>
                <span className="fs-voice-ring" aria-hidden />
                <span className="fs-voice-spinner" aria-hidden />
                <div className="fs-voice-orb" ref={orb} aria-hidden>
                  {shown === 'speaking' ? (
                    <span className="fs-voice-bars">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : shown === 'listening' ? (
                    <Square size={18} aria-hidden />
                  ) : (
                    <Mic size={22} aria-hidden />
                  )}
                </div>
              </button>
              <p className="fs-voice-status" role="status">
                {status}
              </p>

              <div className="fs-voice-captions" aria-live="polite">
                {/* The last thing each of you said, in order, as chat bubbles. */}
                {[lastBot, lastYou]
                  .filter((l): l is WelcomeLine => !!l)
                  .sort((a, b) => a.id - b.id)
                  .map((l) => (
                    <p key={l.id} className={l.from === 'you' ? 'fs-voice-you' : 'fs-voice-bot'}>
                      <small>{l.from === 'you' ? 'You' : 'FocusSpace'}</small>
                      {l.text}
                    </p>
                  ))}
              </div>

              <div className="fs-voice-actions">
                <button
                  type="button"
                  className="fs-link"
                  onClick={() => {
                    closeVoice();
                    window.setTimeout(() => input.current?.focus(), 0);
                  }}
                >
                  <Keyboard size={14} aria-hidden /> Type instead
                </button>
              </div>
            </div>
          </div>,
          overlayRoot ?? document.body,
        )}
    </>
  );
}
