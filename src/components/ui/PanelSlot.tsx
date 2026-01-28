/**
 * PanelSlot - Container that holds zero or one Panel, with animated transitions.
 * Uses Framer Motion for smooth enter/exit animations.
 *
 * Key behaviors:
 * - activeKey: string | null - which panel to show (null = empty/hidden)
 * - When activeKey changes from panel A → panel B: cross-fade transition
 * - When activeKey changes from panel → null: slide out
 * - When activeKey changes from null → panel: slide in
 */

import { AnimatePresence, motion } from "framer-motion";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

type SlotDirection = "horizontal" | "vertical";

interface PanelSlotProps {
  /** Which panel key is active. null = slot is empty/hidden */
  activeKey: string | null;
  children: ReactNode;
  /** Animation direction: horizontal (slide left/right) or vertical (slide up/down) */
  direction?: SlotDirection;
  /** Width when expanded (for horizontal slots), default 480px */
  width?: number;
  className?: string;
}

interface PanelSlotPanelProps {
  /** Unique key to identify this panel within the slot */
  panelKey: string;
  children: ReactNode;
}

// Fast transition configuration
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
  width = 480,
  className = "",
}: PanelSlotProps) {
  // Find the active panel child
  const childArray = Children.toArray(children);
  const activeChild = childArray.find((child): child is ReactElement<PanelSlotPanelProps> => {
    return isValidElement(child) && child.props.panelKey === activeKey;
  });

  // Animation variants based on direction
  const isHorizontal = direction === "horizontal";

  const variants = {
    initial: isHorizontal ? { width: 0, opacity: 0 } : { height: 0, opacity: 0 },
    animate: isHorizontal ? { width, opacity: 1 } : { height: "auto", opacity: 1 },
    exit: isHorizontal ? { width: 0, opacity: 0 } : { height: 0, opacity: 0 },
  };

  return (
    <AnimatePresence mode="sync">
      {activeKey && activeChild && (
        <motion.div
          key={activeKey}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={variants}
          transition={transitionConfig}
          className={`overflow-hidden flex-shrink-0 ${className}`}
          style={isHorizontal ? { minWidth: 0 } : { minHeight: 0 }}
        >
          <div className="h-full" style={isHorizontal ? { width: `${width}px` } : undefined}>
            {activeChild.props.children}
          </div>
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
