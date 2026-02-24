/**
 * UI Component Library
 * Panel-based design system with Stone & Sage color palette.
 */

// Animation key definitions
export {
  ArtifactTabs,
  LogTabs,
  MainContentSlot,
  SidebarSlot,
  SubtaskSlot,
  TaskAccessorySlot,
  TaskDetailFooterSlot,
  TaskDetailTabs,
} from "./animationKeys";
export { Badge } from "./Badge";
// Interactive components
export { Button } from "./Button";
export { CollapsibleSection } from "./CollapsibleSection";
export { useContentAnimation, useContentSettled } from "./ContentAnimation";
export { Dropdown } from "./Dropdown";
export { EmptyState } from "./EmptyState";
export { ErrorState } from "./ErrorState";
export { IconButton } from "./IconButton";
export { Link } from "./Link";
export { LoadingState } from "./LoadingState";
export { ModalPanel } from "./ModalPanel";
// Visual Panel component (card-like container with Header/Body/Footer)
export { Panel } from "./Panel/Panel";
// Layout components for grid-based panel layout
export { FlexContainer, PanelContainerContext, PanelLayout, Slot } from "./PanelContainer";
export type { StageColorSet } from "./stageColors";
export { buildStageColorMap, STAGE_PALETTE } from "./stageColors";
export { TabbedPanel } from "./TabbedPanel";
export type { StateColorSet, TaskState } from "./taskStateColors";
export { taskStateColors } from "./taskStateColors";
