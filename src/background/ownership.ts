import { getItem, getItems, setItem, subscribe } from '@/storage/storage';
import { activeDataIsEmpty, claimActiveData, GUEST, hasVault, readOwnership, switchOwner } from '@/storage/ownership';
import { authorize } from './spaces';

/**
 * Keeps the data in use matched to whoever is signed in (storage/ownership.ts has the model).
 *
 *   signed out                → the guest's data (set aside earlier, or a clean start)
 *   signed in as A            → A's data (from a previous visit here, or a clean start)
 *   a guest with data signs in for the first time → they are asked: keep it with the account, or start
 *                               fresh. Until they answer, nothing is attached to the account.
 *
 * One account's data is never offered to, merged into, or shown to another. The only data that can
 * become an account's is the guest's, and only when the person says so.
 */

type Hooks = { onSwitch: () => void };
let hooks: Hooks = { onSwitch: () => undefined };

// Changes of ownership run one at a time, in order: two quick auth changes must not interleave their swaps.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.catch(() => undefined).then(task);
  queue = next;
  return next;
};

export function startOwnership(options: Hooks): void {
  hooks = options;
  subscribe(['auth'], () => void reconcileOwnership());
  void reconcileOwnership();
}

async function switchTo(owner: string): Promise<void> {
  await switchOwner(owner);
  hooks.onSwitch();
}

export function reconcileOwnership(): Promise<void> {
  return serial(async () => {
    const [{ auth, pendingClaim }, { owner }] = await Promise.all([getItems(['auth', 'pendingClaim']), readOwnership()]);
    const user = auth.user;
    const target = user?.id ?? GUEST;

    // An offer is only for the account it was made to, while it is still signed in and the data is still the guest's.
    if (pendingClaim && (pendingClaim.userId !== user?.id || owner !== GUEST)) await setItem('pendingClaim', null);
    if (owner === target) return;

    if (owner === GUEST && user) {
      if (pendingClaim?.userId === user.id) return; // still waiting for their answer
      if (await hasVault(user.id)) return switchTo(user.id); // their own data from an earlier visit; the guest's is set aside
      if (await activeDataIsEmpty()) return claimActiveData(user.id); // nothing here to ask about
      await setItem('pendingClaim', { userId: user.id, email: user.email ?? null });
      return;
    }

    // An account's data is in use and someone else (the guest, or another account) is now signed in.
    await switchTo(target);
  });
}

/**
 * The learner's answer to "keep this browser's data with your account?". `keep` makes the guest's data
 * theirs as it is, and registers its Spaces with the account; otherwise the guest's data is set aside
 * (it comes back if they sign out) and the account starts clean here.
 */
export function resolveClaim(keep: boolean): Promise<{ ok: boolean }> {
  return serial(async () => {
    const [{ auth, pendingClaim }, { owner }] = await Promise.all([getItems(['auth', 'pendingClaim']), readOwnership()]);
    const user = auth.user;
    if (!user || pendingClaim?.userId !== user.id || owner !== GUEST) return { ok: false };
    await setItem('pendingClaim', null);
    if (keep) {
      await claimActiveData(user.id);
      await registerLocalSpaces();
    } else {
      await switchTo(user.id);
    }
    return { ok: true };
  });
}

/**
 * Tells the account about the Spaces now in use, so its allowance counts what the learner really has.
 * Best-effort: a Space the plan has no room for stays in the browser — deleting someone's work because
 * of a limit would be worse than the count being briefly over.
 */
export async function registerLocalSpaces(): Promise<void> {
  const modes = await getItem('modes');
  for (const mode of modes.filter(m=>!m.source)) await authorize(mode.id, mode.name).catch(() => undefined);
}
