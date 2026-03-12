//! Shared tab bar for all task drawers. Divides width equally across tabs.
//! Registers , and . hotkeys for prev/next tab navigation automatically.

import { useIsMobile } from "../../hooks/useIsMobile";
import { useNavHandler } from "../ui/HotkeyScope";
import { Kbd } from "../ui/Kbd";

export interface DrawerTab {
  id: string;
  label: string;
  /** Single character hotkey shown as a Kbd hint inside the tab. */
  hotkey?: string;
}

interface DrawerTabBarProps {
  tabs: DrawerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** CSS color value for the active indicator, e.g. "#9333ea" */
  accent: string;
}

export function DrawerTabBar({ tabs, activeTab, onTabChange, accent }: DrawerTabBarProps) {
  const isMobile = useIsMobile();
  useNavHandler(",", () => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    const prev = tabs[Math.max(0, idx - 1)];
    if (prev) onTabChange(prev.id);
  });
  useNavHandler(".", () => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    const next = tabs[Math.min(tabs.length - 1, idx + 1)];
    if (next) onTabChange(next.id);
  });

  return (
    <div className="flex shrink-0 h-[36px] border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[11px] tracking-[0.05em] uppercase transition-colors duration-100 border-b-2 ${
              isActive
                ? "font-medium border-transparent"
                : "text-text-tertiary border-transparent hover:bg-canvas hover:text-text-secondary"
            }`}
            style={isActive ? { color: accent, borderBottomColor: accent } : {}}
          >
            {tab.label}
            {tab.hotkey && !isMobile && <Kbd>{tab.hotkey}</Kbd>}
          </button>
        );
      })}
    </div>
  );
}
