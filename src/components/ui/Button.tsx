//! Standard button with semantic variants, optional hotkey badge, and loading state.
//! Merges the former HotkeyButton — every button can register a hotkey when inside a HotkeyScope.

import { AnimatePresence, motion } from "framer-motion";
import { type ButtonHTMLAttributes, forwardRef, type ReactNode, useEffect, useRef } from "react";
import { useHotkeyScope } from "./HotkeyScope";

// ============================================================================
// Types
// ============================================================================

export type ButtonVariant =
  | "primary" // accent (purple) fill — default action
  | "secondary" // bordered ghost — secondary action
  | "ghost" // borderless ghost — low-emphasis
  | "submit" // blue fill — submit / confirm
  | "destructive" // red fill — irreversible delete
  | "custom"; // base layout only — caller provides colors via className

type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keyboard key that triggers this button within the enclosing HotkeyScope. */
  hotkey?: string;
  /** Badge label override — single chars are uppercased by default. */
  hotkeyLabel?: string;
  /** Light badge for buttons with a solid coloured background. */
  onAccent?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
}

// ============================================================================
// Styles
// ============================================================================

const base =
  "inline-flex items-center font-sans text-[13px] font-semibold px-4 py-[7px] rounded-md border cursor-pointer transition-colors whitespace-nowrap leading-snug disabled:opacity-40 disabled:cursor-not-allowed";

const variantStyles: Record<ButtonVariant, string> = {
  primary: `${base} bg-accent border-accent text-white hover:bg-accent-hover`,
  secondary: `${base} bg-transparent border-border text-text-secondary hover:bg-[#F5F2F8] hover:border-text-quaternary`,
  ghost: `${base} bg-transparent border-transparent text-text-secondary hover:bg-[#F5F2F8]`,
  submit: `${base} bg-[#2563EB] hover:bg-[#1D4FD8] text-white border-transparent`,
  destructive: `${base} bg-[#DC2626] hover:bg-[#B91C1C] text-white border-transparent`,
  custom: base,
};

const sizeOverrides: Partial<Record<ButtonSize, string>> = {
  sm: "text-[12px] px-2.5 py-1",
  lg: "text-[14px] px-5 py-2.5",
};

// ============================================================================
// Component
// ============================================================================

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    hotkey,
    hotkeyLabel,
    onAccent = false,
    fullWidth = false,
    loading = false,
    disabled,
    className = "",
    onClick,
    ...props
  },
  ref,
) {
  const { active, register } = useHotkeyScope();
  const btnRef = useRef<HTMLButtonElement>(null);

  const setRef = (el: HTMLButtonElement | null) => {
    (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = el;
  };

  useEffect(() => {
    if (!hotkey) return;
    return register(hotkey, () => {
      const btn = btnRef.current;
      if (btn && !btn.disabled) btn.click();
    });
  }, [register, hotkey]);

  const badge = hotkeyLabel ?? (hotkey && hotkey.length === 1 ? hotkey.toUpperCase() : hotkey);
  const sizeClass = sizeOverrides[size] ?? "";

  return (
    <button
      ref={setRef}
      className={`${variantStyles[variant]} ${sizeClass} ${fullWidth ? "w-full justify-center" : ""} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      <AnimatePresence>
        {hotkey && active && (
          <motion.span
            className={`font-mono text-[10px] rounded leading-none overflow-hidden inline-flex items-center ${onAccent ? "bg-white/20" : "bg-black/5"}`}
            initial={{ opacity: 0, maxWidth: 0, paddingLeft: 0, paddingRight: 0, marginRight: 0 }}
            animate={{
              opacity: onAccent ? 0.75 : 0.55,
              maxWidth: 28,
              paddingLeft: 2,
              paddingRight: 2,
              marginRight: 6,
            }}
            exit={{ opacity: 0, maxWidth: 0, paddingLeft: 0, paddingRight: 0, marginRight: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            {badge}
          </motion.span>
        )}
      </AnimatePresence>
      {loading ? (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
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
      ) : (
        children
      )}
    </button>
  );
});
