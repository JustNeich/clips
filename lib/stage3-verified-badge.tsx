import React, { CSSProperties } from "react";

type Stage3VerifiedBadgeProps = {
  color: string;
  size: number;
  className?: string;
  style?: CSSProperties;
};

export function Stage3VerifiedBadge({
  color,
  size,
  className,
  style
}: Stage3VerifiedBadgeProps): React.JSX.Element {
  return (
    <span
      data-template-badge-kind="twitter-color"
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        ...style
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
        style={{ display: "block" }}
      >
        <path
          fill={color}
          d="M12 1.75 14.08 3.05 16.51 2.78 17.81 4.86 20.03 5.9 19.76 8.33 21.06 10.41 19.76 12.49 20.03 14.92 17.81 15.96 16.51 18.04 14.08 17.77 12 19.07 9.92 17.77 7.49 18.04 6.19 15.96 3.97 14.92 4.24 12.49 2.94 10.41 4.24 8.33 3.97 5.9 6.19 4.86 7.49 2.78 9.92 3.05Z"
        />
        <path
          fill="#ffffff"
          d="m10.32 14.91-2.48-2.48 1.28-1.28 1.2 1.2 4.61-4.61 1.28 1.28z"
        />
      </svg>
    </span>
  );
}
