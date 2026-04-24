import type { ReactNode, CSSProperties } from "react";

/**
 * Stat — a single key metric. Use Stat.Strip for top-of-page metric rails.
 * Avoid the dashboard "8 identical boxes" feel: use sparingly, prefer Strip.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  align = "left",
  style,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string; // CSS color for the value
  align?: "left" | "center";
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        alignItems: align === "center" ? "center" : "flex-start",
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
      <div
        style={{
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: "var(--rs-tracking-snug)",
          color: tone ?? "var(--rs-text-primary)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            fontSize: "var(--rs-text-meta)",
            color: "var(--rs-text-secondary)",
            lineHeight: "var(--rs-leading-normal)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * StatStrip — a horizontal rail of stats separated by hairlines.
 * Replaces grids of generic stat cards.
 */
export function StatStrip({
  items,
  style,
}: {
  items: {
    label: ReactNode;
    value: ReactNode;
    hint?: ReactNode;
    tone?: string;
  }[];
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        background: "var(--rs-surface-1)",
        border: "1px solid var(--rs-hairline)",
        borderRadius: "var(--rs-radius-lg)",
        overflow: "hidden",
        ...style,
      }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            padding: "16px 18px",
            borderLeft: i > 0 ? "1px solid var(--rs-hairline)" : "none",
          }}
        >
          <Stat
            label={it.label}
            value={it.value}
            hint={it.hint}
            tone={it.tone}
          />
        </div>
      ))}
    </div>
  );
}
