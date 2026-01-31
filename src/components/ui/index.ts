/**
 * UI Component Library
 * Panel-based design system with Stone & Sage color palette.
 */

// Animation key definitions
export {
  ArtifactTabs,
  LogTabs,
  SidebarSlot,
  SubtaskSlot,
  TaskDetailFooterSlot,
  TaskDetailTabs,
} from "./animationKeys";
export { Badge } from "./Badge";
// Interactive components
export { Button } from "./Button";
export { useContentAnimation, useContentSettled } from "./ContentAnimation";
export { IconButton } from "./IconButton";
export { Link } from "./Link";
// Layout components
export { Panel } from "./Panel/Panel";
export { PanelContainer } from "./PanelContainer";
export { PanelSlot } from "./PanelSlot";
export { TabbedPanel } from "./TabbedPanel";
export { buildStageColorMap, STAGE_PALETTE } from "./stageColors";
export type { StageColorSet } from "./stageColors";
export { taskStateColors } from "./taskStateColors";
export type { StateColorSet, TaskState } from "./taskStateColors";
