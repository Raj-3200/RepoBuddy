import type { ReactNode, CSSProperties } from "react";
import { Info, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";

type Tone = "info" | "warn" | "danger" | "success" | "neutral";

const toneMap: Record<
  Tone,
  { color: string; bg: string; border: string; Icon: typeof Info }
> = {
  info: {
    color: "var(--rs-sev-low)",
    bg: "rgba(91, 156, 246, 0.06)",
    border: "rgba(91, 156, 246, 0.18)",
    Icon: Info,
  },
  warn: {
    color: "var(--rs-sev-high)",
    bg: "rgba(245, 160, 81, 0.06)",
    border: "rgba(245, 160, 81, 0.2)",
    Icon: AlertTriangle,
  },
  danger: {
    color: "var(--rs-sev-critical)",
    bg: "rgba(242, 83, 83, 0.06)",
    border: "rgba(242, 83, 83, 0.2)",
    Icon: AlertCircle,
  },
  success: {
    color: "var(--rs-conf-deterministic)",
    bg: "rgba(61, 214, 140, 0.06)",
    border: "rgba(61, 214, 140, 0.18)",
    Icon: CheckCircle2,
  },
  neutral: {
    color: "var(--rs-text-secondary)",
    bg: "var(--rs-surface-1)",
    border: "var(--rs-hairline)",
    Icon: Info,
  },
};

/** Callout — restrained inline note. Use sparingly for caveats / cautions. */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  style,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  style?: CSSProperties;
}) {
  const t = toneMap[tone];
  const Icon = t.Icon;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 12px",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: "var(--rs-radius-md)",
        ...style,
      }}
    >
      <div style={{ paddingTop: 1, color: t.color }}>
        {icon ?? <Icon size={14} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontSize: "var(--rs-text-meta)",
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              marginBottom: children ? 2 : 0,
            }}
          >
            {title}
          </div>
        )}
        {children && (
          <div
            style={{
              fontSize: "var(--rs-text-meta)",
              color: "var(--rs-text-secondary)",
              lineHeight: "var(--rs-leading-normal)",
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
