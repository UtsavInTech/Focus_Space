import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { canSave } from './save-gate';

/** The website's own sign-in, which hands the session back to the extension (web/src/connect.ts). */
export const openSignIn = () => void sendMessage('site/open', { path: '/connect' }).catch(() => undefined);

/**
 * Whether saving is allowed right now (see ./save-gate.ts); undefined while storage is first read.
 * Follows `auth` live, so finishing sign-in in the website tab turns the prompt back into a Save
 * button without a reload.
 */
export function useCanSave(): boolean | undefined {
  const store = useStorage(['auth'] as const);
  return store ? canSave(store.auth) : undefined;
}
