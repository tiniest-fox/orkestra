//! Navigation scope — keeps the active item scrolled into view within a container.
//!
//! Items register a stable DOM ref by ID; when activeId changes the scope
//! scrolls that element into view with a configurable buffer on both edges.
//!
//! Mirrors the HotkeyScope / HotkeyButton pattern: the scope holds a registry,
//! items self-register via useNavItem. No data attributes, no manual querySelector.
//!
//! Usage:
//!   const bodyRef = useRef<HTMLDivElement>(null);
//!
//!   <div ref={bodyRef}>
//!     <NavigationScope activeId={focusedId} containerRef={bodyRef}>
//!       <Row id={task.id} ... />   // calls useNavItem(task.id, rowRef) internally
//!     </NavigationScope>
//!   </div>

import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

// ============================================================================
// Context
// ============================================================================

interface NavigationScopeValue {
  register: (id: string, ref: RefObject<HTMLElement | null>) => () => void;
}

const NavigationScopeContext = createContext<NavigationScopeValue>({
  register: () => () => {},
});

// ============================================================================
// NavigationScope
// ============================================================================

interface NavigationScopeProps {
  /** The currently active item ID. Changing this updates visual focus; may also trigger scroll. */
  activeId: string | null | undefined;
  /** The scrollable container to scroll within. */
  containerRef: RefObject<HTMLElement | null>;
  /** Buffer (px) to preserve between the active element and the container edge. */
  buffer?: number;
  /**
   * When provided, scroll-into-view fires only when this counter changes, not on every
   * activeId change. Increment it on keyboard navigation; leave it unchanged on hover.
   * This prevents hover from triggering jarring auto-scrolls.
   */
  scrollSeq?: number;
  children: ReactNode;
}

export function NavigationScope({
  activeId,
  containerRef,
  buffer = 72,
  scrollSeq,
  children,
}: NavigationScopeProps) {
  const itemsRef = useRef<Map<string, RefObject<HTMLElement | null>>>(new Map());

  const register = useCallback((id: string, ref: RefObject<HTMLElement | null>) => {
    itemsRef.current.set(id, ref);
    return () => {
      itemsRef.current.delete(id);
    };
  }, []);

  // When scrollSeq is provided, scroll only when the counter increments (keyboard nav).
  // When absent, scroll on every activeId change.
  // activeId is read inside the effect but intentionally not in the dep array when
  // scrollSeq controls triggering — the effect fires at the right moment and reads
  // the current activeId from the closure.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollSeq ?? activeId is intentional composite trigger
  useEffect(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const container = containerRef.current;
    const el = itemsRef.current.get(id)?.current;
    if (!container || !el) return;

    const cr = container.getBoundingClientRect();
    const ar = el.getBoundingClientRect();

    const needsScroll = ar.top < cr.top + buffer || ar.bottom > cr.bottom - buffer;
    if (!needsScroll) return;

    if (ar.top < cr.top + buffer) {
      container.scrollBy({ top: ar.top - cr.top - buffer, behavior: "smooth" });
    } else {
      container.scrollBy({ top: ar.bottom - cr.bottom + buffer, behavior: "smooth" });
    }

    // Suppress hover effects on the container until the mouse physically moves.
    // Without this, elements scrolling under a stationary cursor fire mouseenter.
    container.style.pointerEvents = "none";
    const restore = () => {
      container.style.pointerEvents = "";
    };
    window.addEventListener("pointermove", restore, { once: true });
    return () => {
      window.removeEventListener("pointermove", restore);
      container.style.pointerEvents = "";
    };
  }, [scrollSeq !== undefined ? scrollSeq : activeId, containerRef, buffer]);

  return (
    <NavigationScopeContext.Provider value={{ register }}>
      {children}
    </NavigationScopeContext.Provider>
  );
}

// ============================================================================
// useNavItem
// ============================================================================

/**
 * Registers a DOM element ref with the nearest NavigationScope under the given ID.
 * Call this inside any item that should be scrolled into view when it becomes active.
 *
 * The ref must be stable (created with useRef) — it is read by the scope at scroll
 * time, not at registration time, so the current element is always up to date.
 */
export function useNavItem(id: string, ref: RefObject<HTMLElement | null>): void {
  const { register } = useContext(NavigationScopeContext);
  // register is stable (useCallback []); re-register only if id changes.
  useEffect(() => register(id, ref), [id, ref, register]);
}
