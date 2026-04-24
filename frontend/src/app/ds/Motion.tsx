import type { ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "./tokens";

/** FadeIn — calm entrance for any block. */
export function FadeIn({
  children,
  delay = 0,
  y = 6,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.base, delay, ease: ease.entrance }}
    >
      {children}
    </motion.div>
  );
}

/** Stagger — staggered reveal for lists of cards. */
export function Stagger({
  children,
  step = 0.04,
  initialDelay = 0,
}: {
  children: ReactNode[];
  step?: number;
  initialDelay?: number;
}) {
  return (
    <>
      {children.map((c, i) => (
        <FadeIn key={i} delay={initialDelay + i * step}>
          {c}
        </FadeIn>
      ))}
    </>
  );
}

/** PageTransition — fade-slide between routes. Wrap each page root. */
export function PageTransition({
  routeKey,
  children,
}: {
  routeKey: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: dur.page, ease: ease.entrance }}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
