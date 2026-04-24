import type { CSSProperties } from "react";

/** Skeleton — shimmer block. Use for loading states instead of spinners
 * inside content areas; reserve spinners for actions. */
export function Skeleton({
  width = "100%",
  height = 14,
  radius = 4,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, var(--rs-surface-2) 0%, var(--rs-surface-3) 50%, var(--rs-surface-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "rs-shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

// Inject the keyframes once.
if (
  typeof document !== "undefined" &&
  !document.getElementById("rs-shimmer-kf")
) {
  const s = document.createElement("style");
  s.id = "rs-shimmer-kf";
  s.textContent = `@keyframes rs-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`;
  document.head.appendChild(s);
}
