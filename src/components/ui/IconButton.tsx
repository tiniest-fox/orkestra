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
    "bg-transparent text-stone-500 hover:bg-stone-100 hover:text-stone-700 active:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 dark:active:bg-stone-700",
  secondary:
    "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-700 active:bg-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-200 dark:active:bg-stone-600",
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
    "inline-flex items-center justify-center rounded-panel-sm transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-stone-900 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${iconSizeStyles[size]} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
}
