import type { ReactNode, CSSProperties } from "react";
import { motion } from "motion/react";
import { dur, ease } from "./tokens";
import { Search, Inbox, FileQuestion } from "lucide-react";

type Tone = "neutral" | "danger" | "success";
type Variant = "neutral" | "no-results" | "no-data";

const toneFor: Record<Tone, string> = {
  neutral: "var(--rs-text-muted)",
  danger: "var(--rs-sev-critical)",
  success: "var(--rs-conf-deterministic)",
};

/**
 * EmptyState — calm zero-state. Use `whatChecked` to honor the rule that
 * we never just say "everything is fine" — show what was looked at.
 */
export function EmptyState({
  variant = "neutral",
  tone = "neutral",
  title,
  detail,
  whatChecked,
  action,
  icon,
  style,
}: {
  variant?: Variant;
  tone?: Tone;
  title: ReactNode;
  detail?: ReactNode;
  whatChecked?: ReactNode[];
  action?: ReactNode;
  icon?: ReactNode;
  style?: CSSProperties;
}) {
  const Icon =
    variant === "no-results"
      ? Search
      : variant === "no-data"
        ? FileQuestion
        : Inbox;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.base, ease: ease.entrance }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "32px 28px",
        background: "var(--rs-surface-1)",
        border: "1px solid var(--rs-hairline)",
        borderRadius: "var(--rs-radius-lg)",
        ...style,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "var(--rs-radius-md)",
          background: "var(--rs-surface-2)",
          color: toneFor[tone],
        }}
      >
        {icon ?? <Icon size={16} />}
      </div>
      <div>
        <div
          style={{
            fontSize: "var(--rs-text-heading)",
            fontWeight: 500,
            color: "var(--rs-text-primary)",
          }}
        >
          {title}
        </div>
        {detail && (
          <p
            style={{
              marginTop: 4,
              fontSize: "var(--rs-text-body)",
              lineHeight: "var(--rs-leading-relaxed)",
              color: "var(--rs-text-secondary)",
              maxWidth: "60ch",
            }}
          >
            {detail}
          </p>
        )}
      </div>
      {whatChecked && whatChecked.length > 0 && (
        <div
          style={{
            borderLeft: "2px solid var(--rs-hairline-strong)",
            paddingLeft: 10,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: "var(--rs-text-eyebrow)",
              fontWeight: 600,
              color: "var(--rs-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "var(--rs-tracking-eyebrow)",
              marginBottom: 2,
            }}
          >
            What we checked
          </div>
          {whatChecked.map((it, i) => (
            <div
              key={i}
              style={{
                fontSize: "var(--rs-text-meta)",
                color: "var(--rs-text-secondary)",
                lineHeight: "var(--rs-leading-normal)",
              }}
            >
              {it}
            </div>
          ))}
        </div>
      )}
      {action && <div>{action}</div>}
    </motion.div>
  );
}
