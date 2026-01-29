/**
 * Button - Styled button component with variants.
 * Supports primary, secondary, ghost, and destructive variants in sm, md, lg sizes.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width button */
  fullWidth?: boolean;
  /** Loading state - shows spinner and disables button */
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700 disabled:bg-orange-300",
  secondary:
    "bg-stone-100 text-stone-700 hover:bg-stone-200 active:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400",
  ghost:
    "bg-transparent text-stone-700 hover:bg-stone-100 active:bg-stone-200 disabled:text-stone-400",
  destructive:
    "bg-error-500 text-white hover:bg-error-600 active:bg-error-700 disabled:bg-error-300",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium rounded-panel-sm transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:cursor-not-allowed";

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
