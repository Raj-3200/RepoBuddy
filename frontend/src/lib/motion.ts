import type { Variants, Transition } from "framer-motion";

// Shared easing — smooth deceleration curve
export const ease = [0.16, 1, 0.3, 1] as const;

// Softer spring for large surfaces / panels
export const springSoft = {
  type: "spring" as const,
  stiffness: 80,
  damping: 28,
  mass: 1,
};

// Spring config for interactive elements
export const spring = {
  type: "spring" as const,
  stiffness: 120,
  damping: 24,
  mass: 0.8,
};

// Standard reveal transition
export const revealTransition = (delay = 0): Transition => ({
  duration: 0.9,
  delay,
  ease,
});

// Fade + lift reveal
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0 },
};

// Fade only
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

// Scale fade (for cards, panels)
export const scaleFade: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1 },
};

// Stagger container
export const stagger = (staggerMs = 0.1): Variants => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: staggerMs,
    },
  },
});

// Viewport config for scroll-triggered animations
export const viewport = {
  once: true,
  margin: "-80px" as const,
};

export const viewportSoft = {
  once: true,
  margin: "-40px 0px -12% 0px" as const,
  amount: 0.2,
} as const;

/** Standard section headline + block */
export const sectionFadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.85, ease },
  },
};

export const sectionTransition = (delay = 0): Transition => ({
  duration: 0.85,
  delay,
  ease,
});

/** Subtle horizontal slide for panels */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.75, ease },
  },
};
