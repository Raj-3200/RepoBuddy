import { useId } from "react";

/** Subtle structural grid — suggests architecture without decoration noise */
export function SystemGrid({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const pid = `rs-grid-${id}`;

  return (
    <svg
      className={`pointer-events-none text-foreground/[0.035] ${className}`}
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <pattern
          id={pid}
          width="56"
          height="56"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 56 0 L 0 0 0 56"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.45"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${pid})`} />
    </svg>
  );
}
