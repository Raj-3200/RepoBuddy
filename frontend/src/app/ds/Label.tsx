import type { ReactNode, CSSProperties } from "react";

/** Eyebrow — small uppercase context label for sections / cards. */
export function Eyebrow({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: "var(--rs-text-eyebrow)",
        fontWeight: 600,
        color: "var(--rs-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "var(--rs-tracking-eyebrow)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** MetaText — small calm metadata, used inline in headers and footers. */
export function MetaText({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontSize: "var(--rs-text-meta)",
        color: "var(--rs-text-muted)",
        lineHeight: "var(--rs-leading-normal)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Kbd — small keyboard hint for shortcuts. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 5px",
        fontSize: 10,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        color: "var(--rs-text-secondary)",
        background: "var(--rs-surface-2)",
        border: "1px solid var(--rs-hairline-strong)",
        borderRadius: 4,
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
