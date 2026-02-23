//! Button that self-registers its keyboard shortcut with the enclosing HotkeyScope.
//! Shows an animated badge when the scope is active (row focused / panel open).

import { AnimatePresence, motion } from "framer-motion";
import { type ButtonHTMLAttributes, forwardRef, useEffect, useRef } from "react";
import { useHotkeyScope } from "./HotkeyScope";

interface HotkeyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Keyboard key that triggers this button (matched against KeyboardEvent.key). */
  hotkey: string;
  /** Badge display override — single chars are uppercased by default. */
  label?: string;
  /** Light badge for buttons with a solid coloured background (e.g. accent fill). */
  onAccent?: boolean;
}

export const HotkeyButton = forwardRef<HTMLButtonElement, HotkeyButtonProps>(function HotkeyButton(
  { hotkey, label, onAccent = false, children, onClick, ...props },
  ref,
) {
  const { active, register } = useHotkeyScope();
  const btnRef = useRef<HTMLButtonElement>(null);

  // Merge forwarded ref with internal ref so callers can focus the button.
  const setRef = (el: HTMLButtonElement | null) => {
    (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = el;
  };

  // Register into the scope. Uses a button ref so the handler is never stale
  // and disabled state is always read from the live DOM element.
  useEffect(() => {
    return register(hotkey, () => {
      const btn = btnRef.current;
      if (btn && !btn.disabled) btn.click();
    });
  }, [register, hotkey]);

  const display = label ?? (hotkey.length === 1 ? hotkey.toUpperCase() : hotkey);

  return (
    <button ref={setRef} onClick={onClick} {...props}>
      <AnimatePresence>
        {active && (
          <motion.span
            className={`font-forge-mono text-[10px] rounded leading-none overflow-hidden inline-flex items-center ${onAccent ? "bg-white/20" : "bg-black/5"}`}
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
            {display}
          </motion.span>
        )}
      </AnimatePresence>
      {children}
    </button>
  );
});
