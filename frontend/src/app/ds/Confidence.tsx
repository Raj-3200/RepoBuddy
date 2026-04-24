import type { CSSProperties, ReactNode } from "react";
import { confidenceColor, confidenceLabel, type Confidence } from "./tokens";

/**
 * ConfidenceBadge — calm pill with a colored leader bar. Hover surface
 * shows the rationale via title attribute (cards can use a richer popover).
 */
export function ConfidenceBadge({
  confidence,
  rationale,
  showLabel = true,
  style,
}: {
  confidence: Confidence;
  rationale?: string;
  showLabel?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      title={rationale}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px 2px 6px",
        fontSize: "var(--rs-text-meta)",
        color: "var(--rs-text-secondary)",
        background: "var(--rs-surface-2)",
        border: "1px solid var(--rs-hairline)",
        borderRadius: "var(--rs-radius-pill)",
        lineHeight: 1.5,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: confidenceColor[confidence],
        }}
      />
      {showLabel && (
        <>
          <span style={{ color: "var(--rs-text-muted)" }}>Confidence</span>
          <span style={{ color: "var(--rs-text-primary)" }}>
            {confidenceLabel[confidence]}
          </span>
        </>
      )}
    </span>
  );
}

/** ConfidenceNote — italic line for inline confidence rationale. */
export function ConfidenceNote({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: "var(--rs-text-meta)",
        fontStyle: "italic",
        color: "var(--rs-text-muted)",
        lineHeight: "var(--rs-leading-normal)",
        ...style,
      }}
    >
      {children}
    </p>
  );
}
