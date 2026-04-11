/** Shared landing layout — one width, one vertical rhythm */
export const LAND = {
  /** Max content width aligned to Tailwind max-w-7xl (80rem) */
  shell: "mx-auto w-full max-w-7xl px-6 sm:px-8",
  /** Major section vertical padding */
  sectionY: "py-24 sm:py-28 lg:py-32",
  /** Slightly tighter block (e.g. process inner) */
  sectionYDense: "py-20 sm:py-24 lg:py-28",
  /** Eyebrow / kicker */
  eyebrow:
    "font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/65 sm:text-[11px]",
  /** Secondary body */
  body: "text-[14px] sm:text-[15px] leading-relaxed text-muted-foreground",
  /** Display heading after eyebrow */
  h2: "font-display font-semibold tracking-[-0.03em] text-foreground",
  /** Card / panel radius */
  radius: "rounded-2xl",
  /** Hairline section rule */
  rule: "border-border/20",
} as const;
