// Token re-exports for use in TS code (style props, motion configs).
// CSS values still live in styles/theme.css — keep these in sync.

export const space = {
  0: 0,
  1: 2,
  2: 4,
  3: 8,
  4: 12,
  5: 16,
  6: 20,
  7: 24,
  8: 32,
  9: 40,
  10: 56,
  11: 72,
  12: 96,
} as const;

export const text = {
  display: 28,
  title: 20,
  heading: 15,
  body: 13,
  meta: 11.5,
  micro: 10.5,
  eyebrow: 10,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 10,
  xl: 14,
  pill: 999,
} as const;

export const dur = {
  instant: 0.08,
  fast: 0.16,
  base: 0.24,
  slow: 0.36,
  page: 0.32,
} as const;

export const ease = {
  standard: [0.32, 0.72, 0, 1] as [number, number, number, number],
  entrance: [0.16, 1, 0.3, 1] as [number, number, number, number],
  exit: [0.7, 0, 0.84, 0] as [number, number, number, number],
};

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence =
  | "deterministic"
  | "strong"
  | "moderate"
  | "weak"
  | "unknown";

export const severityColor: Record<Severity, string> = {
  critical: "var(--rs-sev-critical)",
  high: "var(--rs-sev-high)",
  medium: "var(--rs-sev-medium)",
  low: "var(--rs-sev-low)",
  info: "var(--rs-sev-info)",
};

export const severityLabel: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const confidenceColor: Record<Confidence, string> = {
  deterministic: "var(--rs-conf-deterministic)",
  strong: "var(--rs-conf-strong)",
  moderate: "var(--rs-conf-moderate)",
  weak: "var(--rs-conf-weak)",
  unknown: "var(--rs-conf-unknown)",
};

export const confidenceLabel: Record<Confidence, string> = {
  deterministic: "Deterministic",
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
  unknown: "Unknown",
};
