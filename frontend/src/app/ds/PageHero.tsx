import type { ReactNode } from "react";
import { motion } from "motion/react";
import { dur, ease } from "./tokens";

/**
 * PageHero — the editorial header for every page. Replaces the small
 * "title + subtitle + chip row" pattern with a stronger, calmer block.
 *
 * eyebrow:    short uppercase context label (e.g. "Insights")
 * title:      the strong page promise — full sentence allowed
 * lede:       one short paragraph under the title, plain language
 * meta:       optional inline meta (timestamps, scope) — small, muted
 * actions:    optional action cluster, right-aligned on wide screens
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  meta,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.base, ease: ease.entrance }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        paddingBottom: 4,
      }}
    >
      <div className="flex items-start gap-6">
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow && (
            <div
              style={{
                fontSize: "var(--rs-text-eyebrow)",
                fontWeight: 600,
                color: "var(--rs-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "var(--rs-tracking-eyebrow)",
                marginBottom: 8,
              }}
            >
              {eyebrow}
            </div>
          )}
          <h1
            style={{
              fontSize: "var(--rs-text-display)",
              fontWeight: 600,
              lineHeight: "var(--rs-leading-tight)",
              letterSpacing: "var(--rs-tracking-tight)",
              color: "var(--rs-text-primary)",
              margin: 0,
              maxWidth: "44ch",
            }}
          >
            {title}
          </h1>
          {lede && (
            <p
              style={{
                marginTop: 12,
                fontSize: "var(--rs-text-body)",
                lineHeight: "var(--rs-leading-relaxed)",
                color: "var(--rs-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              {lede}
            </p>
          )}
        </div>
        {actions && (
          <div className="shrink-0 flex items-center gap-2">{actions}</div>
        )}
      </div>
      {meta && (
        <div
          className="flex items-center gap-3 flex-wrap"
          style={{
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-muted)",
          }}
        >
          {meta}
        </div>
      )}
    </motion.header>
  );
}
