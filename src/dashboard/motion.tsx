import type { ComponentProps } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';

/**
 * Lists on FocusSpace's own pages (Library, History): rows arrive one after another instead of all at
 * once, and lift slightly under the pointer. Nothing moves with reduced motion.
 */

const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } } };
const row: Variants = { hidden: { opacity: 0, y: 10 }, shown: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.2, 0, 0, 1] } } };

export function StaggerList(props: ComponentProps<typeof motion.div>) {
  const reduce = useReducedMotion();
  return <motion.div initial={reduce ? false : 'hidden'} animate="shown" variants={list} {...props} />;
}

export function StaggerItem(props: ComponentProps<typeof motion.button>) {
  const reduce = useReducedMotion();
  return <motion.button variants={reduce ? undefined : row} whileTap={reduce ? undefined : { scale: 0.99 }} {...props} />;
}
