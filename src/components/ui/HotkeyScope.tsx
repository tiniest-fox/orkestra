//! Keyboard shortcut scope — collects hotkey registrations from child HotkeyButtons
//! and dispatches keypresses to the matching handler when active.
//!
//! Usage:
//!   <HotkeyScope active={isFocused}>
//!     <HotkeyButton hotkey="r" onClick={onReview}>Review</HotkeyButton>
//!     <HotkeyButton hotkey="a" onClick={onApprove}>Approve</HotkeyButton>
//!   </HotkeyScope>
//!
//! When active, pressing "r" or "a" fires the corresponding button's onClick.
//! When inactive, nothing dispatches and badges are hidden.
//!
//! Hotkey strings support modifier prefixes: "meta+Enter", "ctrl+k", "shift+a".
//! Modifier combos fire even from inputs/textareas (intentional global shortcuts).
//!
//! useNavHandler registers an arbitrary handler for a key with the nearest
//! HotkeyScope, using a ref so the handler is never stale. Use for scroll/nav
//! behavior that doesn't have a visible button badge:
//!
//!   useNavHandler("ArrowDown", () => containerRef.current?.scrollBy({ top: 56 }));

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";

// ============================================================================
// Hotkey matching
// ============================================================================

/** Returns true if a keyboard event matches the given hotkey string. */
export function hotkeyMatches(hotkey: string, e: KeyboardEvent): boolean {
  const parts = hotkey.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  if (e.key !== key) return false;
  if (mods.has("meta") !== e.metaKey) return false;
  if (mods.has("ctrl") !== e.ctrlKey) return false;
  if (mods.has("shift") !== e.shiftKey) return false;
  if (mods.has("alt") !== e.altKey) return false;
  return true;
}

// ============================================================================
// Context
// ============================================================================

interface HotkeyScopeValue {
  /** Whether this scope is currently active (dispatches keys, shows badges). */
  active: boolean;
  /** Register a handler for a key. Returns an unregister function. */
  register: (key: string, handler: () => void) => () => void;
}

export const HotkeyScopeContext = createContext<HotkeyScopeValue>({
  active: false,
  register: () => () => {},
});

export function useHotkeyScope(): HotkeyScopeValue {
  return useContext(HotkeyScopeContext);
}

// ============================================================================
// Component
// ============================================================================

interface HotkeyScopeProps {
  active: boolean;
  children: ReactNode;
}

export function HotkeyScope({ active, children }: HotkeyScopeProps) {
  const isMobile = useIsMobile();
  const effectiveActive = active && !isMobile;

  // Stack per key — last registered fires; unregistering restores the previous handler.
  const handlersRef = useRef<Map<string, Array<() => void>>>(new Map());

  const register = useCallback((key: string, handler: () => void) => {
    const stack = handlersRef.current.get(key) ?? [];
    handlersRef.current.set(key, [...stack, handler]);
    return () => {
      const current = handlersRef.current.get(key) ?? [];
      const next = current.filter((h) => h !== handler);
      if (next.length > 0) {
        handlersRef.current.set(key, next);
      } else {
        handlersRef.current.delete(key);
      }
    };
  }, []);

  useEffect(() => {
    if (!effectiveActive) return;

    function onKeyDown(e: KeyboardEvent) {
      const isFromInput =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      for (const [hotkey, stack] of handlersRef.current) {
        if (!stack || stack.length === 0) continue;
        if (!hotkeyMatches(hotkey, e)) continue;
        // Plain keys (no modifiers) skip input elements; modifier combos always fire.
        const hasModifier = hotkey.includes("+");
        if (isFromInput && !hasModifier) continue;
        e.preventDefault();
        stack[stack.length - 1]();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [effectiveActive]);

  return (
    <HotkeyScopeContext.Provider value={{ active: effectiveActive, register }}>
      {children}
    </HotkeyScopeContext.Provider>
  );
}

// ============================================================================
// useNavHandler
// ============================================================================

/**
 * Registers an arbitrary key handler with the nearest HotkeyScope.
 * Unlike HotkeyButton, this has no visible badge — use for scroll/nav
 * behavior that doesn't correspond to a button.
 *
 * The handler ref is updated every render so closures over state are
 * always fresh without needing to re-register.
 */
export function useNavHandler(key: string, handler: () => void): void {
  const { register } = useHotkeyScope();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => register(key, () => handlerRef.current()), [register, key]);
}
