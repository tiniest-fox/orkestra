import { motion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import {
  type SlotConfig,
  type PanelLayoutProps,
  SlotLayoutContext,
  PanelContainerContext,
  panelTransition,
} from "./types";

/**
 * PanelLayout - Grid-based layout container with coordinated animations.
 *
 * Slots self-register their config (type, size, visible) via context.
 * The layout builds the grid template and animates it when slots change.
 *
 * Supports horizontal (columns) and vertical (rows) layouts.
 *
 * Usage:
 * ```tsx
 * <PanelLayout>
 *   <Slot id="main" type="grow" visible={true}>
 *     <MainContent />
 *   </Slot>
 *   <Slot id="sidebar" type="fixed" size={480} visible={sidebarOpen}>
 *     <TaskDetails />
 *   </Slot>
 * </PanelLayout>
 * ```
 */
export function PanelLayout({ children, direction = "horizontal", gap = 8, className = "" }: PanelLayoutProps) {
  // Slots register themselves here
  const [slots, setSlots] = useState<Map<string, SlotConfig>>(new Map());

  const registerSlot = useCallback((config: SlotConfig) => {
    setSlots((prev) => {
      const next = new Map(prev);
      next.set(config.id, config);
      return next;
    });
  }, []);

  const unregisterSlot = useCallback((id: string) => {
    setSlots((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const contextValue = useMemo(
    () => ({ direction, gap, registerSlot, unregisterSlot }),
    [direction, gap, registerSlot, unregisterSlot]
  );

  // Build grid template from registered slots
  // Order is determined by render order in children
  const gridTemplate = useMemo(() => {
    const slotArray = Array.from(slots.values());

    return slotArray
      .map((slot) => {
        if (!slot.visible) {
          // Collapsed: use 0fr for grow/auto slots, 0px for fixed
          return slot.type === "fixed" ? "0px" : "0fr";
        }
        // Expanded: 1fr for grow, {size}px for fixed, auto for auto
        if (slot.type === "fixed") return `${slot.size}px`;
        if (slot.type === "auto") return "auto";
        return "1fr";
      })
      .join(" ");
  }, [slots]);

  // Use columns for horizontal, rows for vertical
  const animateStyle = direction === "horizontal"
    ? { gridTemplateColumns: gridTemplate }
    : { gridTemplateRows: gridTemplate };

  return (
    <SlotLayoutContext.Provider value={contextValue}>
      <PanelContainerContext.Provider value={{ inContainer: true }}>
        <motion.div
          className={`grid h-full w-full min-w-0 ${className}`}
          style={{ gap }}
          animate={animateStyle}
          transition={panelTransition}
        >
          {children}
        </motion.div>
      </PanelContainerContext.Provider>
    </SlotLayoutContext.Provider>
  );
}
