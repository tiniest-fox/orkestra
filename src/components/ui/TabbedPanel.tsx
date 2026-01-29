/**
 * TabbedPanel - Panel variant with tab bar for switching between content sections.
 * Combines the Panel visual styling with built-in tab navigation.
 * Features animated highlight that moves between tabs on selection,
 * and directional slide transitions for tab content.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useId, useState, type ReactNode } from "react";
import { Panel } from "./Panel";

const contentTransition = {
  type: "spring" as const,
  bounce: 0.15,
  duration: 0.3,
};

const contentVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? "100%" : "-100%",
  }),
  center: {
    x: 0,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? "-100%" : "100%",
  }),
};

interface Tab {
  id: string;
  label: string;
  /** Optional indicator (e.g., badge, pulse dot) */
  indicator?: ReactNode;
}

interface TabbedPanelProps {
  /** Panel header content (rendered before tabs, e.g., title, close button) */
  header?: ReactNode;
  /** List of tabs to render */
  tabs: Tab[];
  /** Currently active tab ID */
  activeTab: string;
  /** Callback when tab is clicked */
  onTabChange: (tabId: string) => void;
  /** Content to render for the active tab */
  children: ReactNode;
  /** Panel variant */
  variant?: "default" | "elevated";
  className?: string;
}

/**
 * TabbedPanel - Panel with integrated tab navigation.
 *
 * Usage:
 * ```tsx
 * <TabbedPanel
 *   header={<Panel.Title>Task Details</Panel.Title>}
 *   tabs={[
 *     { id: "details", label: "Details" },
 *     { id: "logs", label: "Logs", indicator: <PulseDot /> },
 *   ]}
 *   activeTab={activeTab}
 *   onTabChange={setActiveTab}
 * >
 *   {activeTab === "details" && <DetailsContent />}
 *   {activeTab === "logs" && <LogsContent />}
 * </TabbedPanel>
 * ```
 */
export function TabbedPanel({
  header,
  tabs,
  activeTab,
  onTabChange,
  children,
  variant = "default",
  className = "",
}: TabbedPanelProps) {
  // Direction is set in click handler BEFORE activeTab changes,
  // so AnimatePresence sees the correct direction when processing the key change.
  const layoutId = useId();
  const [direction, setDirection] = useState(1);

  function handleTabChange(tabId: string) {
    const currentIndex = tabs.findIndex((t) => t.id === activeTab);
    const nextIndex = tabs.findIndex((t) => t.id === tabId);
    setDirection(nextIndex > currentIndex ? 1 : -1);
    onTabChange(tabId);
  }

  return (
    <>
      {/* Optional header (title, close button, etc.) */}
      {header && <Panel.Header>{header}</Panel.Header>}

      {/* Tab bar */}
      <Panel autoFill={false} className="tabs flex items-center px-px py-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`relative px-3 mx-px py-1.5 text-sm rounded-panel font-medium whitespace-nowrap flex items-center gap-1.5 ${
              activeTab !== tab.id ? "hover:bg-stone-100" : ""
            }`}
          >
            {/* Animated highlight - only rendered in active tab */}
            {activeTab === tab.id && (
              <motion.div
                layoutId={`${layoutId}-tab-highlight`}
                className="absolute inset-0 bg-sage-500 rounded-panel"
                transition={{ type: "spring", bounce: 0.15, duration: 0.25 }}
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                activeTab === tab.id ? "text-white" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {tab.label}
            </span>
            {tab.indicator && <span className="relative z-10">{tab.indicator}</span>}
          </button>
        ))}
      </Panel>

      {/* Tab content area - scrollable with directional slide animation */}
      <Panel padded={false} scrollable={false} className="tab-content overflow-hidden">
        <div className="grid h-full" style={{ gridTemplate: "1fr / 1fr" }}>
          <AnimatePresence initial={false} mode="sync" custom={direction}>
            <motion.div
              key={activeTab}
              custom={direction}
              variants={contentVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={contentTransition}
              className="overflow-y-auto overflow-x-hidden flex flex-col items-stretch"
              style={{ gridArea: "1 / 1" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </Panel>
    </>
  );
}
