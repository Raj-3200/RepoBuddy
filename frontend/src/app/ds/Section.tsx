import type { ReactNode, CSSProperties } from "react";

/**
 * Section — top-level content group with editorial heading rhythm.
 * No card chrome by default; pages compose Sections that may contain Cards.
 */
export function Section({
  id,
  title,
  description,
  aside,
  children,
  spacing = "base",
  style,
}: {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  spacing?: "tight" | "base" | "loose";
  style?: CSSProperties;
}) {
  const gap = spacing === "tight" ? 12 : spacing === "loose" ? 24 : 16;
  return (
    <section
      id={id}
      style={{
        display: "flex",
        flexDirection: "column",
        gap,
        scrollMarginTop: 80,
        ...style,
      }}
    >
      {(title || description || aside) && (
        <header className="flex items-end justify-between gap-6">
          <div style={{ minWidth: 0, flex: 1 }}>
            {title && (
              <h2
                style={{
                  fontSize: "var(--rs-text-title)",
                  fontWeight: 500,
                  lineHeight: "var(--rs-leading-snug)",
                  letterSpacing: "var(--rs-tracking-snug)",
                  color: "var(--rs-text-primary)",
                  margin: 0,
                }}
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                style={{
                  marginTop: 4,
                  fontSize: "var(--rs-text-body)",
                  lineHeight: "var(--rs-leading-relaxed)",
                  color: "var(--rs-text-secondary)",
                  maxWidth: "62ch",
                }}
              >
                {description}
              </p>
            )}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** SubSection — smaller heading rhythm inside a Section. */
export function SubSection({
  title,
  description,
  children,
  style,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 10, ...style }}
    >
      {(title || description) && (
        <div>
          {title && (
            <h3
              style={{
                fontSize: "var(--rs-text-heading)",
                fontWeight: 500,
                lineHeight: "var(--rs-leading-snug)",
                color: "var(--rs-text-primary)",
                margin: 0,
              }}
            >
              {title}
            </h3>
          )}
          {description && (
            <p
              style={{
                marginTop: 2,
                fontSize: "var(--rs-text-meta)",
                lineHeight: "var(--rs-leading-normal)",
                color: "var(--rs-text-secondary)",
              }}
            >
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
