/**
 * Shared analysis semantics: severity, confidence, score → severity, tones.
 *
 * Every page that surfaces risk, blast radius, health, or evidence MUST go
 * through these helpers so labels, colors, and language stay in sync.
 *
 * Vocabulary:
 *  - severity:   critical | high | medium | low | info     (operational urgency)
 *  - confidence: deterministic | strong | moderate | weak | unknown
 *                                                          (how sure we are)
 *  - tone:       danger | warn | accent | info | success | neutral
 *                                                          (Card/Callout color cue)
 */

import type { Severity, Confidence } from "./tokens";

// ── severity ────────────────────────────────────────────────────────────────

/** Coerce arbitrary backend severity strings to the canonical 5-tier scale. */
export function toSeverity(value: string | undefined | null): Severity {
  switch ((value ?? "").toLowerCase().trim()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
    case "moderate":
      return "medium";
    case "low":
    case "isolated":
      return "low";
    default:
      return "info";
  }
}

/**
 * Derive severity from a 0..1 risk/blast/pressure score using the same
 * thresholds the rest of the product uses. This keeps "score 0.62" and
 * "severity high" from disagreeing across pages.
 *
 *   >= 0.80  critical
 *   >= 0.55  high
 *   >= 0.30  medium
 *   >= 0.10  low
 *   <  0.10  info
 */
export function severityFromScore(score: number | null | undefined): Severity {
  const s = typeof score === "number" && Number.isFinite(score) ? score : 0;
  if (s >= 0.8) return "critical";
  if (s >= 0.55) return "high";
  if (s >= 0.3) return "medium";
  if (s >= 0.1) return "low";
  return "info";
}

// ── confidence ──────────────────────────────────────────────────────────────

/** Coerce arbitrary backend confidence strings to the canonical 5-tier scale. */
export function toConfidence(value: string | undefined | null): Confidence {
  switch ((value ?? "").toLowerCase().trim()) {
    case "deterministic":
    case "verified":
    case "exact":
      return "deterministic";
    case "strong":
    case "high":
      return "strong";
    case "moderate":
    case "medium":
      return "moderate";
    case "weak":
    case "low":
      return "weak";
    default:
      return "unknown";
  }
}

// ── tone ────────────────────────────────────────────────────────────────────

export type Tone =
  | "danger"
  | "warn"
  | "accent"
  | "info"
  | "success"
  | "neutral";

/** Severity → Card/Callout tone. Single source of truth for surface color. */
export function toneFor(severity: Severity): Tone {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "warn";
    case "medium":
      return "accent";
    case "low":
      return "info";
    case "info":
    default:
      return "neutral";
  }
}

// ── verdict (Impact analysis) ───────────────────────────────────────────────

/**
 * Map a backend verdict slug ("isolated" | "low_risk" | ...) to severity.
 * Use this so Impact's verdict line and the underlying severity badge agree.
 */
export function verdictSeverity(verdict: string | null | undefined): Severity {
  switch ((verdict ?? "").toLowerCase()) {
    case "high_risk":
      return "high";
    case "moderate_risk":
      return "medium";
    case "low_risk":
      return "low";
    case "isolated":
      return "info";
    default:
      return "info";
  }
}

export function verdictLabel(verdict: string | null | undefined): string {
  switch ((verdict ?? "").toLowerCase()) {
    case "high_risk":
      return "High risk change";
    case "moderate_risk":
      return "Moderate risk change";
    case "low_risk":
      return "Low risk change";
    case "isolated":
      return "Isolated change";
    default:
      return "Unscored";
  }
}
