/**
 * PanelSlot - Container that holds zero or one Panel, with animated transitions.
 *
 * Animation behavior:
 * - Open/close and panel switches both use collapse/grow animation
 * - mode="wait" ensures exit completes before enter (quick, snappy feel)
 * - Nested PanelSlots skip initial animation when mounting with parent (prevents double-animation)
 *
 * Shadow handling:
 * - Shadow is on the PanelSlot container (not clipped by its own overflow:hidden)
 * - Inner panels have shadows suppressed via PanelSlotContext
 *
 * Provides PanelSlotContext to children with:
 * - suppressShadow: true
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  Children,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";

/** Context for panels inside a PanelSlot to access slot configuration */
interface PanelSlotContextValue {
  suppressShadow: boolean;
}

export const PanelSlotContext = createContext<PanelSlotContextValue | null>(null);

/** Hook for Panel components to access PanelSlot configuration */
export const usePanelSlot = () => useContext(PanelSlotContext);

/** Separate context for nesting detection (not reset by Panel) */
const PanelSlotNestingContext = createContext<boolean>(false);
const useIsNestedInPanelSlot = () => useContext(PanelSlotNestingContext);

type SlotDirection = "horizontal" | "vertical";

interface PanelSlotProps {
  /** Which panel key is active. null = slot is empty/hidden */
  activeKey: string | null;
  children: ReactNode;
  /** Animation direction: horizontal (slide left/right) or vertical (slide up/down) */
  direction?: SlotDirection;
  className?: string;
}

interface PanelSlotPanelProps {
  /** Unique key to identify this panel within the slot */
  panelKey: string;
  children: ReactNode;
}

// Quick, snappy transition
const transitionConfig = {
  duration: 0.15,
  ease: "easeOut" as const,
};

/**
 * PanelSlot - Animated container for switching between panels.
 *
 * Usage:
 * ```tsx
 * <PanelSlot activeKey={selectedTask ? `task-${selectedTask.id}` : null}>
 *   <PanelSlot.Panel panelKey="create">
 *     <NewTaskPanel />
 *   </PanelSlot.Panel>
 *   <PanelSlot.Panel panelKey={`task-${selectedTask?.id}`}>
 *     <TaskDetailPanel task={selectedTask} />
 *   </PanelSlot.Panel>
 * </PanelSlot>
 * ```
 */
export function PanelSlot({
  activeKey,
  children,
  direction = "horizontal",
  className = "",
}: PanelSlotProps) {
  const isNestedInSlot = useIsNestedInPanelSlot();
  const isFirstRender = useRef(true);

  // Track first render to skip initial animation for nested slots
  useEffect(() => {
    isFirstRender.current = false;
  }, []);

  // Find the active panel child
  const childArray = Children.toArray(children);
  const activeChild = childArray.find((child): child is ReactElement<PanelSlotPanelProps> => {
    return isValidElement(child) && child.props.panelKey === activeKey;
  });

  const isHorizontal = direction === "horizontal";

  // Container collapses/grows for both open/close and panel switches
  const variants = {
    initial: isHorizontal ? { width: 0, opacity: 0 } : { height: 0, opacity: 0 },
    animate: isHorizontal ? { width: "auto", opacity: 1 } : { height: "auto", opacity: 1 },
    exit: isHorizontal ? { width: 0, opacity: 0 } : { height: 0, opacity: 0 },
  };

  // Skip animation if nested and this is the first render (parent is still animating)
  const skipInitialAnimation = isNestedInSlot && isFirstRender.current;

  const contextValue: PanelSlotContextValue = {
    suppressShadow: true, // Shadow is on PanelSlot, suppress on inner panels
  };

  return (
    <AnimatePresence mode="wait">
      {activeKey && activeChild && (
        <motion.div
          key={activeKey}
          initial={skipInitialAnimation ? "animate" : "initial"}
          animate="animate"
          exit="exit"
          variants={variants}
          transition={transitionConfig}
          className={`panel-slot-motion-div flex flex-col items-stretch shadow-panel rounded-panel overflow-hidden ${className}`}
          style={{ minWidth: 0 }}
        >
          <PanelSlotNestingContext.Provider value={true}>
            <PanelSlotContext.Provider value={contextValue}>
              {activeChild.props.children}
            </PanelSlotContext.Provider>
          </PanelSlotNestingContext.Provider>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * PanelSlot.Panel - Wrapper for individual panel content within a PanelSlot.
 * The panelKey prop is used by PanelSlot to determine which panel to display.
 */
function PanelSlotPanel({ children }: PanelSlotPanelProps) {
  // This component doesn't render directly - PanelSlot extracts its children
  return <>{children}</>;
}

// Attach Panel subcomponent
PanelSlot.Panel = PanelSlotPanel;
