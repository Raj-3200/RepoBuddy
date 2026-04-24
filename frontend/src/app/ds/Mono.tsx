import type { ReactNode, CSSProperties } from "react";

/** Mono — inline monospace text for paths, identifiers, code fragments. */
export function Mono({
  children,
  style,
  size,
}: {
  children: ReactNode;
  style?: CSSProperties;
  size?: number;
}) {
  return (
    <span
      style={{
        fontFamily:
          "'Geist Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: size ?? 12,
        color: "var(--rs-text-secondary)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Path — formatted file path with subtle directory dimming. */
export function Path({
  value,
  style,
  size,
}: {
  value: string;
  style?: CSSProperties;
  size?: number;
}) {
  const idx = value.lastIndexOf("/");
  const dir = idx >= 0 ? value.slice(0, idx + 1) : "";
  const name = idx >= 0 ? value.slice(idx + 1) : value;
  return (
    <span
      style={{
        fontFamily:
          "'Geist Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: size ?? 12,
        ...style,
      }}
      title={value}
    >
      <span style={{ color: "var(--rs-text-muted)" }}>{dir}</span>
      <span style={{ color: "var(--rs-text-primary)" }}>{name}</span>
    </span>
  );
}
