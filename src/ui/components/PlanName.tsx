import { planById, PLANS, type PlanId } from '@/billing/plans';

/** Paid plans are the ones worth marking: they get the premium treatment wherever the plan is named. */
export const isPaidPlan = (plan: string): plan is Exclude<PlanId, 'free'> => plan !== 'free' && PLANS.some((p) => p.id === plan);

/**
 * "Pro", "Unlimited", "Max" with a soft glow in the accent colour — a text-shadow, not a gradient, so it
 * stays within the FocusSpace look in both themes. Free is plain text.
 */
export function PlanName({ plan, suffix = true }: { plan: string; suffix?: boolean }) {
  const paid = isPaidPlan(plan);
  const name = paid ? planById(plan).name : 'Free';
  return (
    <span className="fs-plan-name">
      <span className={paid ? 'fs-plan-premium' : undefined} data-plan={plan}>
        {name}
      </span>
      {suffix ? ' plan' : ''}
    </span>
  );
}
