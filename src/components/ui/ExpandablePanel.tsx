/**
 * ExpandablePanel - A panel that can expand to fill its nearest OverlayContainer.
 *
 * In collapsed mode, renders children in normal document flow.
 * In expanded mode, portals children into the OverlayContainer as an
 * absolutely-positioned overlay with `inset-0`, escaping any intermediate
 * overflow:hidden boundaries.
 *
 * Toggling between modes remounts children (different DOM locations). State
 * that needs to survive toggle should be lifted above the ExpandablePanel.
 *
 * The expand/collapse transition is animated with framer-motion and registers
 * with ContentAnimationContext so descendant content (like chunked HTML in
 * ArtifactView) can defer rendering during the animation.
 *
 * This is a reusable primitive — not specific to artifacts. Any content wrapped
 * in an ExpandablePanel inside an OverlayContainer can be expanded.
 */

import { AnimatePresence, motion } from "framer-motion";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { type AnimationPhase, ContentAnimationContext, useContentAnimation } from "./ContentAnimation";
import { useOverlayContainer } from "./OverlayContainer";

interface ExpandablePanelContextValue {
  isExpanded: boolean;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
}

const ExpandablePanelContext = createContext<ExpandablePanelContextValue | null>(null);

/** Read the expand/collapse state from the nearest ExpandablePanel. */
export function useExpandablePanel(): ExpandablePanelContextValue | null {
  return useContext(ExpandablePanelContext);
}

interface ExpandablePanelProps {
  children: ReactNode;
  className?: string;
}

const ANIMATION_KEY = "expandable-panel";

const overlayTransition = {
  type: "spring" as const,
  bounce: 0.1,
  duration: 0.3,
};

/**
 * ExpandablePanel - Wrap content to make it expandable.
 *
 * In collapsed mode: renders children as a normal flex child.
 * In expanded mode: portals children into the nearest OverlayContainer
 * as an absolute overlay with inset-0.
 *
 * Place an ExpandButton inside to give users a toggle control.
 */
export function ExpandablePanel({ children, className = "" }: ExpandablePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const overlay = useOverlayContainer();

  const expand = useCallback(() => setIsExpanded(true), []);
  const collapse = useCallback(() => setIsExpanded(false), []);
  const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);

  const contextValue = useMemo<ExpandablePanelContextValue>(
    () => ({ isExpanded, expand, collapse, toggle }),
    [isExpanded, expand, collapse, toggle],
  );

  // Animation phase tracking
  const parentAnimation = useContentAnimation();
  const [phase, setPhase] = useState<AnimationPhase>("settled");

  const mergedState = useMemo(() => {
    const phases = { ...parentAnimation.phases };
    if (isExpanded) {
      phases[ANIMATION_KEY] = phase;
    }
    return { phases };
  }, [parentAnimation, phase, isExpanded]);

  const portalTarget = overlay?.containerElement ?? null;

  // Wrap children with shared providers so context is available in both modes
  const wrappedChildren = (
    <ExpandablePanelContext.Provider value={contextValue}>
      <ContentAnimationContext.Provider value={mergedState}>{children}</ContentAnimationContext.Provider>
    </ExpandablePanelContext.Provider>
  );

  if (isExpanded && portalTarget) {
    return (
      <>
        {createPortal(
          <AnimatePresence>
            <motion.div
              key="expanded-panel"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={overlayTransition}
              onAnimationStart={() => setPhase("entering")}
              onAnimationComplete={() => setPhase("settled")}
              className={`absolute inset-0 z-30 flex flex-col rounded-panel shadow-panel bg-white dark:bg-stone-900 overflow-y-auto overflow-x-hidden ${className}`}
            >
              {wrappedChildren}
            </motion.div>
          </AnimatePresence>,
          portalTarget,
        )}
        {/* Placeholder preserves layout space in collapsed position */}
        <div className="grow shrink basis-0" />
      </>
    );
  }

  return (
    <div className={`grow shrink basis-0 flex flex-col overflow-y-auto overflow-x-hidden ${className}`}>
      {wrappedChildren}
    </div>
  );
}
