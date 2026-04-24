import type { CSSProperties } from "react";

/** Divider — single hairline. Use sparingly. */
export function Divider({
  vertical,
  style,
}: {
  vertical?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        background: "var(--rs-hairline)",
        ...(vertical
          ? { width: 1, alignSelf: "stretch" }
          : { height: 1, width: "100%" }),
        ...style,
      }}
    />
  );
}

/** DotSep — calm middle-dot separator for inline meta. */
export function DotSep() {
  return (
    <span
      aria-hidden
      style={{ color: "var(--rs-text-muted)", margin: "0 6px" }}
    >
      ·
    </span>
  );
}
