import * as React from "react";

/**
 * Official RepoBuddy logo: cyan git-branch style mark.
 * Three connected nodes — top-left, top-right, bottom-left — with a
 * vertical link and a hook connecting the branch.
 */
export function Logo({
  size = 28,
  color = "#22D3EE",
  strokeWidth = 2.25,
  className,
  style,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      style={style}
      aria-label="RepoBuddy"
      role="img"
    >
      {/* Vertical trunk: top-left node down to bottom-left node */}
      <path
        d="M8 11 L8 21"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Branch hook: top-right node curves left-down into the trunk */}
      <path
        d="M22 11 C 22 15, 18 15, 14 15 L 8 15"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Nodes */}
      <circle
        cx="8"
        cy="8"
        r="3"
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx="22"
        cy="8"
        r="3"
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx="8"
        cy="24"
        r="3"
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
      />
    </svg>
  );
}

export default Logo;
