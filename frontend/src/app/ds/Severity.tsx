import type { CSSProperties, ReactNode } from "react";
import { severityColor, severityLabel, type Severity } from "./tokens";

/** SeverityDot — quiet 6px dot. Use as the *primary* severity indicator. */
export function SeverityDot({
  severity,
  style,
  size = 6,
}: {
  severity: Severity;
  style?: CSSProperties;
  size?: number;
}) {
  return (
    <span
      aria-label={severityLabel[severity]}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: severityColor[severity],
        boxShadow: `0 0 0 3px ${severityColor[severity]}1f`,
        ...style,
      }}
    />
  );
}

/** SeverityBadge — text + dot. Use only when severity needs a name. */
export function SeverityBadge({
  severity,
  children,
  style,
}: {
  severity: Severity;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: "var(--rs-text-meta)",
        color: severityColor[severity],
        fontWeight: 500,
        letterSpacing: "var(--rs-tracking-snug)",
        ...style,
      }}
    >
      <SeverityDot severity={severity} />
      {children ?? severityLabel[severity]}
    </span>
  );
}
