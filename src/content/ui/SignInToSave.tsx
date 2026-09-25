import { LogIn } from 'lucide-react';
import { SAVE_PROMPT } from '@/ui/account/save-gate';
import { openSignIn } from '@/ui/account/use-can-save';

/**
 * The inline "sign in to save" prompt for YouTube's panels — see src/ui/account/save-gate.ts. Built
 * from the classes the panels already use, so it reads as part of the answer, not as an alert.
 */
export function SignInToSave({ kind, onDismiss }: { kind: 'note' | 'chat'; onDismiss?: () => void }) {
  const copy = SAVE_PROMPT[kind];
  return (
    <div className="fs-answer-note" role="note" style={{ marginTop: 10 }}>
      <strong>{copy.title}</strong> {copy.body}
      <div className="fs-ai-actions" style={{ marginTop: 8, alignItems: 'center' }}>
        <button type="button" className="fs-ai-chip" onClick={openSignIn}>
          <LogIn size={14} aria-hidden /> {SAVE_PROMPT.action}
        </button>
        {onDismiss && (
          <button type="button" className="fs-link" onClick={onDismiss}>
            {SAVE_PROMPT.dismiss}
          </button>
        )}
      </div>
    </div>
  );
}
