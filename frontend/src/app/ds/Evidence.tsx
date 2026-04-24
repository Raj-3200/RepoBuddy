import type { ReactNode, CSSProperties } from "react";

/**
 * EvidenceBlock — quotes / data the engine used to support a claim.
 * Visually distinct from prose: tighter type, monospace anchors, left rule.
 */
export function EvidenceBlock({
  label = "Evidence",
  items,
  style,
}: {
  label?: string;
  items: ReactNode[];
  style?: CSSProperties;
}) {
  if (!items.length) return null;
  return (
    <div
      style={{
        borderLeft: "2px solid var(--rs-hairline-strong)",
        paddingLeft: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        ...style,
      }}
    >
      <div
        style={{
          fontSize: "var(--rs-text-eyebrow)",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "var(--rs-tracking-eyebrow)",
        }}
      >
        {label}
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {items.map((it, i) => (
          <li
            key={i}
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-secondary)",
              lineHeight: "var(--rs-leading-normal)",
            }}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
