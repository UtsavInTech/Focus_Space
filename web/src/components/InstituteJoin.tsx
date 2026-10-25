import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { request } from '../api';
import { instituteRequest } from '../institute-api';
import { InstallCta } from './InstallCta';
import { onLinkClick } from '../router';
import { TOOLS } from '../content/institute-tools';
import { CONSENT_VERSION } from '../../../server/institutes/types';
import './institute-tools.css';

/** A public course (`/learn/:course`) or a batch's join landing (`/join/:code`) — the batch has `course_id`. */
type Landing = { org_id: string; org_name: string; title: string; id?: string; course_id?: string };
type Kind = 'join' | 'learn';

/** The course or batch behind this page, loaded without a session (both lookups are public). */
function useLanding(kind: Kind, identifier: string) {
  const [course, setCourse] = useState<Landing | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setCourse(null);
    setError('');
    const route = kind === 'join' ? `/v1/join/${encodeURIComponent(identifier)}` : `/v1/courses/${encodeURIComponent(identifier)}`;
    void request<{ course?: Landing | null; batch?: Landing | null }>(route)
      .then((data) => {
        if (live) setCourse(data.course ?? data.batch ?? null);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [kind, identifier]);

  return { course, error, setError };
}

interface Choices {
  progress: boolean;
  contact: boolean;
  verified: boolean;
}

/**
 * Whether this account is already in the course — then the page edits sharing instead of enrolling, and
 * starts from the learner's current choices rather than both off.
 */
function useExistingEnrolment(course: Landing | null, onChoices: (choices: Choices) => void, onError: (message: string) => void) {
  const auth = useAuth();
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    if (!auth.user || !course) return;
    let live = true;
    const load = async (token: string | null) => {
      if (!token) return;
      const data = await instituteRequest<{ courses: { orgId: string; courseId: string }[] }>(token, '/v1/me/institutes');
      if (!live) return;
      const exists = data.courses.some((c) => c.orgId === course.org_id && c.courseId === (course.course_id ?? course.id));
      setEnrolled(exists);
      if (!exists) return;
      const current = await instituteRequest<{ consents: { progress: boolean; contact: boolean } }>(token, `/v1/consents?orgId=${encodeURIComponent(course.org_id)}`);
      if (live) onChoices({ progress: current.consents.progress, contact: current.consents.contact, verified: current.consents.contact });
    };
    void auth
      .token()
      .then(load)
      .catch((e) => live && onError(e.message));
    return () => {
      live = false;
    };
  }, [auth.user?.id, course]); // eslint-disable-line react-hooks/exhaustive-deps

  return enrolled;
}

function JoinedNotice() {
  return (
    <div role="status">
      <h2>You’re enrolled</h2>
      <p>{TOOLS.joined}</p>
      <a className="fsw-btn fsw-btn-primary" href="/connect" onClick={onLinkClick('/connect')}>
        Connect this account to the extension
      </a>
      <a href="https://www.youtube.com/" target="_blank" rel="noreferrer">
        Open YouTube
      </a>
    </div>
  );
}

/** Progress sharing and "contact me": both start off; each says what the institute gets and what the student gets. */
function SharingChoices({ progress, contact, onProgress, onContact }: { progress: boolean; contact: boolean; onProgress: (v: boolean) => void; onContact: (v: boolean) => void }) {
  return (
    <fieldset className="fsw-join-step">
      <legend><span>3</span> {TOOLS.consentTitle}</legend>
      <label className="fsw-join-choice">
        <input type="checkbox" checked={progress} onChange={(e) => onProgress(e.target.checked)} />
        <span><b>{TOOLS.progress}</b><small>{TOOLS.progressHelp}</small></span>
      </label>
      <label className="fsw-join-choice is-priority">
        <input type="checkbox" checked={contact} onChange={(e) => onContact(e.target.checked)} />
        <span><b>{TOOLS.contact}</b><small>{TOOLS.contactHelp}</small></span>
      </label>
      <p className="fsw-join-fine">{TOOLS.notice}</p>
    </fieldset>
  );
}

/** Step 2: the number, proven by an SMS code. Skipped when the account already signed in with this phone. */
function PhoneStep({ orgName, busy, phone, code, codeSent, verified, demoCode, onPhone, onCode, onSend, onVerify }: {
  orgName: string; busy: boolean; phone: string; code: string; codeSent: boolean; verified: boolean; demoCode: string | null;
  onPhone: (v: string) => void; onCode: (v: string) => void; onSend: () => void; onVerify: () => void;
}) {
  return (
    <fieldset className="fsw-join-step">
      <legend><span>2</span> {TOOLS.phoneTitle}</legend>
      <p className="fsw-join-shared">{TOOLS.phoneShared(orgName)}</p>
      <div className="fsw-join-row">
        <input type="tel" autoComplete="tel" required value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="+91 98765 43210" aria-label="Indian mobile number" disabled={verified} />
        {!verified && <button type="button" disabled={busy || phone.replace(/\D/g, '').length < 10} onClick={onSend}>{codeSent ? 'Send again' : 'Send code'}</button>}
      </div>
      {codeSent && !verified && (
        <div className="fsw-join-row">
          <input value={code} onChange={(e) => onCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Six-digit code" aria-label="SMS code" />
          <button type="button" disabled={busy || code.length !== 6} onClick={onVerify}>Verify</button>
        </div>
      )}
      {demoCode && !verified && <p className="fsw-join-fine">Demo only: no SMS is sent. The code is {demoCode}.</p>}
      {verified ? <p role="status" className="fsw-join-ok">✓ Number verified</p> : <p className="fsw-join-fine">{TOOLS.phoneHelp}</p>}
    </fieldset>
  );
}

/** The join (or change-choices) form, for a signed-in learner. */
function JoinForm({ kind, identifier, course, enrolled, choices, setChoices, onJoined, setError }: { kind: Kind; identifier: string; course: Landing; enrolled: boolean; choices: Choices; setChoices: (update: (c: Choices) => Choices) => void; onJoined: () => void; setError: (message: string) => void }) {
  const auth = useAuth();
  const signedInPhone = auth.user?.phone ?? '';
  const [phone, setPhone] = useState(signedInPhone);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { progress, contact } = choices;
  // Signed in with this very phone: it is already proven.
  const verified = choices.verified || (!!signedInPhone && normalise(phone) === signedInPhone);

  const call = async <T,>(route: string, body: unknown) => {
    const token = await auth.token();
    if (!token) throw new Error('Sign in first.');
    return instituteRequest<T>(token, route, body);
  };

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const consents = { textVersion: CONSENT_VERSION, progress, contact };
      if (enrolled) {
        await call('/v1/consents', { orgId: course.org_id, consents });
        onJoined();
        return;
      }
      await call('/v1/enroll', { ...(kind === 'join' ? { joinCode: identifier } : { courseId: identifier }), phone: normalise(phone), consents });
      onJoined();
    });
  };

  const changePhone = (value: string) => {
    setPhone(value);
    setChoices((c) => ({ ...c, verified: false }));
    setCodeSent(false);
  };

  const sendCode = () =>
    void act(async () => {
      const sent = await call<{ demoCode?: string }>('/v1/institutes/phone/start', { phone: normalise(phone) });
      setDemoCode(sent.demoCode ?? null);
      setCodeSent(true);
    });

  const verify = () =>
    void act(async () => {
      await call('/v1/institutes/phone/verify', { phone: normalise(phone), code });
      setChoices((c) => ({ ...c, verified: true }));
    });

  return (
    <form onSubmit={submit} className="fsw-join-form">
      <div className="fsw-join-step is-done"><span>1</span> Signed in{auth.user?.name ? ` as ${auth.user.name}` : ''}</div>
      {!enrolled && (
        <PhoneStep orgName={course.org_name} busy={busy} phone={phone} code={code} codeSent={codeSent} verified={verified} demoCode={demoCode}
          onPhone={changePhone} onCode={setCode} onSend={sendCode} onVerify={verify} />
      )}
      <SharingChoices
        progress={progress}
        contact={contact}
        onProgress={(value) => setChoices((c) => ({ ...c, progress: value }))}
        onContact={(value) => setChoices((c) => ({ ...c, contact: value }))}
      />
      <button className="fsw-btn fsw-btn-primary fsw-join-go" disabled={busy || (!enrolled && !verified)}>
        {busy ? 'Saving…' : enrolled ? 'Save my choices' : `Join ${course.title}`}
      </button>
      {!enrolled && !verified && <p className="fsw-join-fine">Verify your number to join.</p>}
    </form>
  );
}

/** "98765 43210", "+91 98765-43210" → "+919876543210". */
function normalise(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? `+91${digits}` : digits.length === 12 && digits.startsWith('91') ? `+${digits}` : value.trim();
}

export default function InstituteJoin({ kind, identifier }: { kind: Kind; identifier: string }) {
  const auth = useAuth();
  const { course, error, setError } = useLanding(kind, identifier);
  const [choices, setChoices] = useState<Choices>({ progress: false, contact: false, verified: false });
  const [joined, setJoined] = useState(false);
  const enrolled = useExistingEnrolment(course, setChoices, setError);
  const path = `/${kind}/${encodeURIComponent(identifier)}`;
  const signIn = `/signin?next=${encodeURIComponent(path)}`;

  const account = () => {
    if (!auth.ready) return <p>Checking sign-in…</p>;
    if (!auth.user) {
      return (
        <a className="fsw-btn fsw-btn-primary" href={signIn} onClick={onLinkClick(signIn)}>
          {TOOLS.signin}
        </a>
      );
    }
    if (joined) return <JoinedNotice />;
    return <JoinForm kind={kind} identifier={identifier} course={course!} enrolled={enrolled} choices={choices} setChoices={setChoices} onJoined={() => setJoined(true)} setError={setError} />;
  };

  return (
    <section className="fsw-tools fsw-institute-join">
      <header>
        <p>{course?.org_name ?? 'FOCUSSPACE FOR INSTITUTES'}</p>
        <h1>{course?.title ?? TOOLS.join}</h1>
        <p>Lectures organised by {course?.org_name ?? 'the institute'}, on YouTube, in their order. Joining is free.</p>
      </header>
      {error && (
        <p role="alert" className="fsw-tool-error">
          {error}
        </p>
      )}
      {!course ? (
        <p>Course details are unavailable until the server can load this course.</p>
      ) : (
        <>
          <InstallCta />
          <p>Install FocusSpace in desktop Chrome to use the institute Space on YouTube.</p>
          {account()}
        </>
      )}
    </section>
  );
}
