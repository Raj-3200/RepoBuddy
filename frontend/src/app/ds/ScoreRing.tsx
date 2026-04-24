import { motion } from "motion/react";
import { dur, ease } from "./tokens";

/** ScoreRing — small animated circular progress for dimension scores. */
export function ScoreRing({
  value,
  size = 56,
  stroke = 4,
  tone,
  label,
}: {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  tone?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - v / 100);
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
        position: "relative",
        width: size,
        height: size,
      }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--rs-surface-3)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: dur.slow, ease: ease.entrance }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--rs-text-primary)",
            lineHeight: 1,
            letterSpacing: "var(--rs-tracking-snug)",
          }}
        >
          {Math.round(v)}
        </div>
        {label && (
          <div
            style={{
              fontSize: 9,
              color: "var(--rs-text-muted)",
              marginTop: 2,
              letterSpacing: "var(--rs-tracking-eyebrow)",
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
