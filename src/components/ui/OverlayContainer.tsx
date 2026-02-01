/**
 * OverlayContainer - Establishes a positioning boundary for expandable panels.
 *
 * Any descendant ExpandablePanel will expand to fill the nearest OverlayContainer
 * using absolute positioning with an inset. This is a reusable primitive — wrap
 * any section of UI to make it an expansion boundary.
 *
 * Stores its DOM element in context so descendant ExpandablePanels can portal
 * their expanded content directly into this container, escaping any intermediate
 * overflow:hidden boundaries.
 */

import { createContext, type ReactNode, useCallback, useContext, useId, useState } from "react";

interface OverlayContainerContextValue {
  /** Unique ID of the overlay container, used to scope animations. */
  containerId: string;
  /** The container DOM element for portal rendering. Null before mount. */
  containerElement: HTMLDivElement | null;
}

const OverlayContainerContext = createContext<OverlayContainerContextValue | null>(null);

/** Read the nearest OverlayContainer context. Returns null if none exists. */
export function useOverlayContainer(): OverlayContainerContextValue | null {
  return useContext(OverlayContainerContext);
}

interface OverlayContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * OverlayContainer - Wrap content to create an expansion boundary.
 *
 * Renders a div with `position: relative` and provides context so
 * descendant ExpandablePanels can portal expanded content into it.
 */
export function OverlayContainer({ children, className = "" }: OverlayContainerProps) {
  const containerId = useId();
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const callbackRef = useCallback((node: HTMLDivElement | null) => {
    setContainerElement(node);
  }, []);

  return (
    <OverlayContainerContext.Provider value={{ containerId, containerElement }}>
      <div ref={callbackRef} className={`relative ${className}`}>
        {children}
      </div>
    </OverlayContainerContext.Provider>
  );
}
