/**
 * TabbedPanel - Panel variant with tab bar for switching between content sections.
 * Combines the Panel visual styling with built-in tab navigation.
 */

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
  return (
    <Panel variant={variant} className={className}>
      {/* Optional header (title, close button, etc.) */}
      {header && <Panel.Header>{header}</Panel.Header>}

      {/* Tab bar */}
      <div className="flex-shrink-0 flex overflow-x-auto bg-stone-100">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === tab.id
                ? "bg-stone-100 text-stone-900 border-b-2 border-sage-500"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"
            }`}
          >
            {tab.label}
            {tab.indicator}
          </button>
        ))}
      </div>

      {/* Tab content area - scrollable */}
      <div className="flex-1 overflow-auto">{children}</div>
    </Panel>
  );
}
