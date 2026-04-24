import type { ReactNode, CSSProperties, MouseEventHandler } from "react";

type Variant = "flat" | "raised" | "outline" | "feature";
type Tone = "neutral" | "accent" | "warn" | "danger" | "success" | "info";

const surfaceFor: Record<Variant, string> = {
  flat: "var(--rs-surface-1)",
  raised: "var(--rs-surface-2)",
  outline: "transparent",
  feature: "var(--rs-surface-2)",
};

const toneAccent: Record<Tone, string> = {
  neutral: "transparent",
  accent: "var(--rs-accent)",
  warn: "var(--rs-sev-high)",
  danger: "var(--rs-sev-critical)",
  success: "var(--rs-conf-deterministic)",
  info: "var(--rs-sev-low)",
};

/**
 * Card — editorial container. Variants vary visual weight; pages should
 * mix variants instead of stacking 20 identical cards.
 *
 * variant=feature paints a thin left accent bar in the tone color, used
 * for the most-important cards (top priority, hero risk, etc).
 */
export function Card({
  variant = "flat",
  tone = "neutral",
  padding = 18,
  children,
  onClick,
  interactive,
  style,
}: {
  variant?: Variant;
  tone?: Tone;
  padding?: number;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
  interactive?: boolean;
  style?: CSSProperties;
}) {
  const isFeature = variant === "feature";
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        background: surfaceFor[variant],
        border:
          variant === "outline"
            ? "1px solid var(--rs-hairline-strong)"
            : "1px solid var(--rs-hairline)",
        borderRadius: "var(--rs-radius-lg)",
        padding,
        cursor: interactive || onClick ? "pointer" : undefined,
        transition: `background var(--rs-dur-fast) var(--rs-ease-standard), border-color var(--rs-dur-fast) var(--rs-ease-standard)`,
        ...(isFeature && tone !== "neutral"
          ? { paddingLeft: padding + 4 }
          : {}),
        ...style,
      }}
      onMouseEnter={(e) => {
        if (interactive || onClick) {
          (e.currentTarget as HTMLDivElement).style.background =
            "var(--rs-surface-2)";
        }
      }}
      onMouseLeave={(e) => {
        if (interactive || onClick) {
          (e.currentTarget as HTMLDivElement).style.background =
            surfaceFor[variant];
        }
      }}
    >
      {isFeature && tone !== "neutral" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 14,
            bottom: 14,
            width: 2,
            borderRadius: 2,
            background: toneAccent[tone],
            opacity: 0.85,
          }}
        />
      )}
      {children}
    </div>
  );
}

/** CardHeader — small header rhythm for cards. */
export function CardHeader({
  title,
  meta,
  subtitle,
  trailing,
  style,
}: {
  title: ReactNode;
  meta?: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  style?: CSSProperties;
}) {
  const metaContent = meta ?? subtitle;
  return (
    <div className="flex items-start gap-3" style={style}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--rs-text-heading)",
            fontWeight: 500,
            lineHeight: "var(--rs-leading-snug)",
            color: "var(--rs-text-primary)",
          }}
        >
          {title}
        </div>
        {metaContent && (
          <div
            style={{
              marginTop: 4,
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-muted)",
              lineHeight: "var(--rs-leading-normal)",
            }}
          >
            {metaContent}
          </div>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
