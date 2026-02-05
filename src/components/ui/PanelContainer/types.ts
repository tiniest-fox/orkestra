import { createContext, type ReactNode } from "react";

// Animation timing - shared by all slots for coordinated movement
export const ANIMATION_CONFIG = {
  duration: 0.3,
  ease: [0.32, 0.72, 0, 1] as const, // Custom ease for natural feel
};

export const panelTransition = {
  duration: ANIMATION_CONFIG.duration,
  ease: ANIMATION_CONFIG.ease,
};

/** Slot sizing: grow (1fr), fixed (px), or auto (content-sized) */
export type SlotType = "grow" | "fixed" | "auto";
export type LayoutDirection = "horizontal" | "vertical";

export interface SlotConfig {
  id: string;
  type: SlotType;
  /** Size in pixels for "fixed" type (width for horizontal, height for vertical) */
  size?: number;
  visible: boolean;
}

export interface SlotLayoutContextValue {
  direction: LayoutDirection;
  gap: number;
  registerSlot: (config: SlotConfig) => void;
  unregisterSlot: (id: string) => void;
}

export const SlotLayoutContext = createContext<SlotLayoutContextValue | null>(null);

// Context to suppress shadows on nested Panels
export const PanelContainerContext = createContext<{ inContainer: boolean }>({
  inContainer: false,
});

export interface PanelLayoutProps {
  children: ReactNode;
  /** Layout direction: horizontal (columns) or vertical (rows). Default: horizontal */
  direction?: LayoutDirection;
  gap?: number;
  className?: string;
}

export interface SlotProps {
  children: ReactNode;
  /** Unique identifier for this slot */
  id: string;
  /** "grow" fills remaining space, "fixed" uses specified size */
  type: SlotType;
  /** Size in pixels for type="fixed" (width for horizontal layout, height for vertical) */
  size?: number;
  /** Whether the slot is visible */
  visible: boolean;
  /** When this changes, slot closes then reopens with new content */
  contentKey?: string | null;
  /** If true, slot is just a layout container (no shadow/bg). Use for nested PanelLayouts. */
  plain?: boolean;
  className?: string;
}
