/**
 * IconButton - Icon-only button with aria-label for accessibility.
 * Used for close buttons, action icons, etc.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonVariant = "ghost" | "secondary";
type IconButtonSize = "sm" | "md" | "lg";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon element to render */
  icon: ReactNode;
  /** Required for accessibility - describes the button action */
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const variantStyles: Record<IconButtonVariant, string> = {
  ghost:
    "bg-transparent text-text-tertiary hover:bg-canvas hover:text-text-secondary active:bg-canvas",
  secondary:
    "bg-canvas text-text-secondary hover:bg-canvas hover:text-text-secondary active:bg-canvas",
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: "p-1",
  md: "p-1.5",
  lg: "p-2",
};

const iconSizeStyles: Record<IconButtonSize, string> = {
  sm: "[&>svg]:w-4 [&>svg]:h-4",
  md: "[&>svg]:w-5 [&>svg]:h-5",
  lg: "[&>svg]:w-6 [&>svg]:h-6",
};

export function IconButton({
  icon,
  variant = "ghost",
  size = "md",
  className = "",
  ...props
}: IconButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center rounded-panel-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${iconSizeStyles[size]} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
}
