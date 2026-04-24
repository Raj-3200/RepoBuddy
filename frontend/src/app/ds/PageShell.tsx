import type { ReactNode, CSSProperties } from "react";

type Width = "narrow" | "base" | "wide" | "full";

const widthMap: Record<Width, string> = {
  narrow: "var(--rs-content-narrow)",
  base: "var(--rs-content-base)",
  wide: "var(--rs-content-wide)",
  full: "100%",
};

/**
 * PageShell — outer scrollable container for any page rendered into the
 * AppShell <main> outlet. Provides a consistent base background, padding,
 * and centered content column. All redesigned pages should wrap their
 * content in this instead of hand-rolling overflow + padding.
 */
export function PageShell({
  children,
  width = "base",
  padded = true,
  style,
}: {
  children: ReactNode;
  width?: Width;
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ background: "var(--rs-base)", ...style }}
    >
      <div
        className="mx-auto"
        style={{
          maxWidth: widthMap[width],
          padding: padded ? "32px 36px 80px" : 0,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {children}
      </div>
    </div>
  );
}
