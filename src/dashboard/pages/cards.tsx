import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronRight } from 'lucide-react';

/**
 * Quick-action cards for Settings and Account: the things people come to these pages to do, each one a
 * card that says what it is, where it stands right now, and does it in one tap. The detailed sections
 * below stay for everything else.
 */

export function CardGrid({ children, label }: { children: ReactNode; label: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="fs-qcards"
      role="group"
      aria-label={label}
      initial={reduce ? false : 'hidden'}
      animate="shown"
      variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.05 } } }}
    >
      {children}
    </motion.div>
  );
}

export function ActionCard({
  icon,
  title,
  value,
  hint,
  tone = 'default',
  onClick,
  control,
  wide,
}: {
  icon: ReactNode;
  title: string;
  /** Where it stands now: "On", "UPSC CSE", "3 of 5". */
  value?: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'accent' | 'violet' | 'green';
  /** The whole card is the button. Omit when `control` does the work. */
  onClick?: () => void;
  /** An inline control (switch, select, segmented) instead of a click-through. */
  control?: ReactNode;
  wide?: boolean;
}) {
  const reduce = useReducedMotion();
  const body = (
    <>
      <span className={`fs-qcard-icon is-${tone}`} aria-hidden>
        {icon}
      </span>
      <span className="fs-qcard-text">
        <span className="fs-qcard-title">{title}</span>
        {value !== undefined && <span className="fs-qcard-value">{value}</span>}
        {hint && <span className="fs-qcard-hint">{hint}</span>}
      </span>
      {control ? <span className="fs-qcard-control">{control}</span> : onClick ? <ChevronRight className="fs-qcard-go" size={18} aria-hidden /> : null}
    </>
  );
  const motionProps = {
    variants: reduce ? undefined : { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } },
    whileHover: reduce ? undefined : { y: -3 },
    transition: { type: 'spring' as const, stiffness: 380, damping: 30 },
  };
  return onClick && !control ? (
    <motion.button type="button" className={`fs-qcard${wide ? ' is-wide' : ''}`} onClick={onClick} {...motionProps}>
      {body}
    </motion.button>
  ) : (
    <motion.div className={`fs-qcard${wide ? ' is-wide' : ''}`} {...motionProps}>
      {body}
    </motion.div>
  );
}

/** Scrolls to a section on the same page (its `id`), for cards that open the detailed settings. */
export const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
