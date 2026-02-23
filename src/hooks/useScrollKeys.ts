//! Keyboard scrolling for a ref'd container — arrow keys and j/k.

import { type RefObject, useEffect } from "react";

/**
 * Binds j/k and arrow keys to scroll a container while `enabled` is true.
 */
export function useScrollKeys(ref: RefObject<HTMLElement | null>, enabled: boolean, delta = 56) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) return;
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const amount = e.key === "ArrowDown" || e.key === "j" ? delta : -delta;
      el.scrollBy({ top: amount, behavior: "smooth" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ref, enabled, delta]);
}
