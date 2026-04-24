import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { dur, ease } from "./tokens";

/** MetricBar — animated horizontal score bar (0-100). */
export function MetricBar({
  value,
  tone,
  thickness = 4,
  trackTone = "var(--rs-surface-3)",
  style,
}: {
  value: number; // 0..100
  tone?: string;
  thickness?: number;
  trackTone?: string;
  style?: CSSProperties;
}) {
  const v = Math.max(0, Math.min(100, value));
  const fill =
    tone ??
    (v >= 80
      ? "var(--rs-conf-deterministic)"
      : v >= 60
        ? "var(--rs-conf-strong)"
        : v >= 40
          ? "var(--rs-conf-moderate)"
          : "var(--rs-conf-weak)");
  return (
    <div
      style={{
        width: "100%",
        height: thickness,
        background: trackTone,
        borderRadius: thickness,
        overflow: "hidden",
        ...style,
      }}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${v}%` }}
        transition={{ duration: dur.slow, ease: ease.entrance }}
        style={{
          height: "100%",
          background: fill,
          borderRadius: thickness,
        }}
      />
    </div>
  );
}
