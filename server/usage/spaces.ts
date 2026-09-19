import { ApiError } from '../http';
import type { UsageDb } from './db';
import { planLabel } from '@/billing/plans';
import { limitsFor, resolvePlan } from './entitlements';

/**
 * Space allowance (Layer 2C). A Space is a product-level capability, so it is
 * enforced the same way AI usage is: the entitlement table decides the limit,
 * the server decides whether one more is allowed, and no `plan === 'free'`
 * check is scattered through the UI.
 *
 * The Spaces themselves stay exactly where they are — `chrome.storage.local`
 * in the extension. The server only records *how many* a signed-in account
 * has claimed (id and name, so the learner can recognise them), which is what
 * makes the limit real rather than a client-side suggestion.
 */

export interface SpaceAllowance {
  plan: string;
  used: number;
  limit: number;
}

export function spaceAllowance(db: UsageDb, userId: string): SpaceAllowance {
  const plan = resolvePlan(db.getEntitlement(userId));
  return { plan, used: db.countSpaces(userId), limit: limitsFor(plan).maxSpaces };
}

/**
 * The product explanation the learner actually sees when their plan runs out of Spaces. Names the plan
 * they are on — telling a Pro subscriber that "more spaces will come with a paid plan" was simply wrong.
 */
export function spaceLimitMessage(plan: string, limit: number): string {
  return `Your ${planLabel(plan)} includes ${limit} Spaces. Delete one you no longer use to make room, or upgrade for more.`;
}

/**
 * Claims one Space for this account. Idempotent: re-registering a Space the
 * account already has (a re-sync, a retry, the same Space on a second device)
 * returns the current allowance instead of consuming another slot.
 */
export function registerSpace(db: UsageDb, userId: string, spaceId: string, name: string | null, now = Date.now()): SpaceAllowance {
  const current = spaceAllowance(db, userId);
  if (db.findSpace(userId, spaceId)) {
    if (name) db.renameSpace(userId, spaceId, name, now);
    return current;
  }
  if (current.used >= current.limit) throw new ApiError(403, 'space_limit', spaceLimitMessage(current.plan, current.limit));
  db.insertSpace({ user_id: userId, space_id: spaceId, name, created_at: now });
  return { ...current, used: current.used + 1 };
}

/** Deleting a Space frees its slot immediately — the limit is "how many you keep", not "how many you ever made". */
export function unregisterSpace(db: UsageDb, userId: string, spaceId: string): SpaceAllowance {
  db.deleteSpace(userId, spaceId);
  return spaceAllowance(db, userId);
}
