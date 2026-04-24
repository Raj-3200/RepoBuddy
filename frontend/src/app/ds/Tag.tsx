import type { ReactNode, CSSProperties } from "react";

type Tone = "neutral" | "info" | "warn" | "danger" | "success";

const toneMap: Record<Tone, { color: string; bg: string; border: string }> = {
  neutral: {
    color: "var(--rs-text-secondary)",
    bg: "var(--rs-surface-1)",
    border: "var(--rs-hairline)",
  },
  info: {
    color: "var(--rs-sev-low)",
    bg: "var(--rs-surface-1)",
    border: "var(--rs-hairline)",
  },
  warn: {
    color: "var(--rs-sev-high)",
    bg: "var(--rs-surface-1)",
    border: "var(--rs-hairline)",
  },
  danger: {
    color: "var(--rs-sev-critical)",
    bg: "var(--rs-surface-1)",
    border: "var(--rs-hairline)",
  },
  success: {
    color: "var(--rs-conf-deterministic)",
    bg: "var(--rs-surface-1)",
    border: "var(--rs-hairline)",
  },
};

/**
 * Tag — restrained metadata pill. Default style is plain; use `tone` only
 * when the value is semantic. Replaces ad-hoc colored chips scattered in
 * pages.
 */
export function Tag({
  children,
  tone = "neutral",
  size = "md",
  style,
  onClick,
  active,
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
  style?: CSSProperties;
  onClick?: () => void;
  active?: boolean;
  icon?: ReactNode;
}) {
  const t = toneMap[tone];
  const sz =
    size === "sm" ? { fs: 10, py: 1, px: 6 } : { fs: 11, py: 2, px: 8 };
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: `${sz.py}px ${sz.px}px`,
        fontSize: sz.fs,
        fontWeight: 500,
        color: active ? "var(--rs-text-primary)" : t.color,
        background: active ? "var(--rs-surface-3)" : t.bg,
        border: `1px solid ${active ? "var(--rs-hairline-strong)" : t.border}`,
        borderRadius: "var(--rs-radius-pill)",
        lineHeight: 1.4,
        cursor: onClick ? "pointer" : undefined,
        transition: "all var(--rs-dur-fast) var(--rs-ease-standard)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon}
      {children}
    </span>
  );
}
