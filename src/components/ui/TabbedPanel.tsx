/**
 * TabbedPanel - Panel variant with tab bar for switching between content sections.
 * Combines the Panel visual styling with built-in tab navigation.
 * Features animated highlight that moves between tabs on selection,
 * and directional slide transitions for tab content.
 */

import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useId, useState } from "react";
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

type TabSize = "default" | "small";

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
  /** Tab size - "small" for nested/secondary tab bars */
  size?: TabSize;
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
const tabSizeStyles: Record<TabSize, { button: string; highlight: string; text: string }> = {
  default: {
    button: "px-3 mx-px py-1.5 text-sm",
    highlight: "bg-orange-500",
    text: "text-white",
  },
  small: {
    button: "px-2.5 mx-px py-1 text-xs",
    highlight: "bg-orange-200",
    text: "text-stone-800",
  },
};

export function TabbedPanel({
  header,
  tabs,
  activeTab,
  onTabChange,
  children,
  size = "default",
}: TabbedPanelProps) {
  const sizeStyles = tabSizeStyles[size];
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
            className={`relative ${sizeStyles.button} rounded-panel font-medium whitespace-nowrap flex items-center gap-1.5 ${
              activeTab !== tab.id ? "hover:bg-stone-100" : ""
            }`}
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId={`${layoutId}-tab-highlight`}
                className={`absolute inset-0 ${sizeStyles.highlight} rounded-panel`}
                transition={{ type: "spring", bounce: 0.15, duration: 0.25 }}
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                activeTab === tab.id ? sizeStyles.text : "text-stone-600 hover:text-stone-900"
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
