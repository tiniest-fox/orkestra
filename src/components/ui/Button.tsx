//! Standard button with semantic variants, optional hotkey badge, and loading state.
//! Merges the former HotkeyButton — every button can register a hotkey when inside a HotkeyScope.

import { AnimatePresence, motion } from "framer-motion";
import { type ButtonHTMLAttributes, forwardRef, type ReactNode, useEffect, useRef } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useHotkeyScope } from "./HotkeyScope";

// ============================================================================
// Types
// ============================================================================

export type ButtonVariant =
  | "primary" // accent (purple) fill — default action
  | "secondary" // bordered ghost — secondary action
  | "ghost" // borderless ghost — low-emphasis
  | "submit" // blue fill — submit / confirm
  | "outline-submit" // blue outline — answer / inline submit
  | "destructive" // red fill — irreversible delete
  | "outline-destructive" // red outline — inline destructive (retry)
  | "violet" // violet fill — approve (standard stage)
  | "outline-violet" // violet outline — inline review (standard stage)
  | "teal" // teal fill — approve (subtask stage)
  | "outline-teal" // teal outline — inline review (subtask stage)
  | "merge" // terracotta fill — merge / address comments
  | "merge-outline" // terracotta outline — open/view PR
  | "warning"; // amber fill — fix conflicts

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

// Sizing is separate from base so size classes never conflict with each other.
const base =
  "inline-flex items-center font-sans font-semibold rounded-md border cursor-pointer transition-colors whitespace-nowrap leading-snug disabled:opacity-40 disabled:cursor-not-allowed";

const variantStyles: Record<ButtonVariant, string> = {
  primary: `${base} bg-accent border-accent text-white hover:bg-accent-hover`,
  secondary: `${base} bg-surface border-border text-text-secondary hover:bg-surface-hover hover:border-text-quaternary`,
  ghost: `${base} bg-transparent border-transparent text-text-secondary hover:bg-surface-hover`,
  submit: `${base} bg-status-info hover:bg-status-info-hover text-white border-transparent`,
  "outline-submit": `${base} bg-surface border-status-info/40 text-status-info hover:bg-surface-hover`,
  destructive: `${base} bg-status-error hover:bg-status-error-hover text-white border-transparent`,
  "outline-destructive": `${base} bg-surface border-status-error/40 text-status-error hover:bg-surface-hover`,
  violet: `${base} bg-violet hover:bg-violet-hover text-white border-transparent`,
  "outline-violet": `${base} bg-surface border-violet/40 text-violet hover:bg-surface-hover`,
  teal: `${base} bg-teal hover:bg-teal-hover text-white border-transparent`,
  "outline-teal": `${base} bg-surface border-teal/40 text-teal hover:bg-surface-hover`,
  merge: `${base} bg-merge hover:bg-merge-hover text-white border-transparent`,
  "merge-outline": `${base} bg-surface border-merge/30 text-merge hover:bg-surface-hover`,
  warning: `${base} bg-status-warning hover:opacity-90 text-white border-transparent`,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "text-[12px] px-2.5 py-1",
  md: "text-[13px] px-4 py-[7px]",
  lg: "text-[14px] px-5 py-2.5",
};

// ============================================================================
// Helpers
// ============================================================================

const MODIFIER_SYMBOLS: Record<string, string> = {
  meta: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
};

const KEY_SYMBOLS: Record<string, string> = {
  enter: "↵",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backspace: "⌫",
  escape: "⎋",
  tab: "⇥",
};

function formatHotkeyBadge(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      return (
        MODIFIER_SYMBOLS[lower] ??
        KEY_SYMBOLS[lower] ??
        (part.length === 1 ? part.toUpperCase() : part)
      );
    })
    .join("");
}

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
  const isMobile = useIsMobile();
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

  const badge = hotkeyLabel ?? (hotkey ? formatHotkeyBadge(hotkey) : undefined);
  const sizeClass = sizeStyles[size];
  const mobileSizeOverride = isMobile ? " min-h-[36px]" : "";

  return (
    <button
      ref={setRef}
      className={`${variantStyles[variant]} ${sizeClass}${mobileSizeOverride} ${fullWidth ? "w-full justify-center" : ""} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      <AnimatePresence>
        {hotkey && active && (
          <motion.span
            className={`font-mono text-[10px] rounded leading-none overflow-hidden inline-flex items-center ${onAccent ? "bg-white/20" : "bg-surface-3"}`}
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
