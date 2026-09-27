import { sendMessage } from '@/messaging/runtime';
import { openSignIn, useCanSave } from '@/ui/account/use-can-save';

/**
 * What to do when the AI allowance runs out. Signed out, the way on is a free account (the server's
 * message says so) — the old "See plans" alone sent guests to paid plans when signing in was enough.
 * Signed in, it is the plans page.
 */
export function LimitActions() {
  const signedIn = useCanSave();
  return (
    <>
      {signedIn === false && (
        <button type="button" className="fs-link" onClick={openSignIn}>
          Sign in
        </button>
      )}
      <button type="button" className="fs-link" onClick={() => void sendMessage('site/open', { path: '/pricing' })}>
        See plans
      </button>
    </>
  );
}
