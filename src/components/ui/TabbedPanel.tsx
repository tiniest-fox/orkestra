/**
 * TabbedPanel - Panel variant with tab bar for switching between content sections.
 * Combines the Panel visual styling with built-in tab navigation.
 * Features animated highlight that moves between tabs on selection.
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Panel } from "./Panel";

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
  padded?: boolean;
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
  padded = false,
  className = "",
}: TabbedPanelProps) {
  return (
    <>
      {/* Optional header (title, close button, etc.) */}
      {header && <Panel.Header>{header}</Panel.Header>}

      {/* Tab bar */}
      <Panel autoFill={false} className="flex items-center px-px py-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative px-3 mx-px py-1.5 text-sm rounded-panel font-medium whitespace-nowrap flex items-center gap-1.5 ${
              activeTab !== tab.id ? "hover:bg-stone-100" : ""
            }`}
          >
            {/* Animated highlight - only rendered in active tab */}
            {activeTab === tab.id && (
              <motion.div
                layoutId="tab-highlight"
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

      {/* Tab content area - scrollable */}
      <Panel padded={true} scrollable={true}>
        {children}
      </Panel>
    </>
  );
}
