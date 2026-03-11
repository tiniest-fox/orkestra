// Shared startup data slots bridging Tauri events to React providers.
import type { WorkflowConfig, WorkflowTaskView } from "./types/workflow";

export interface StartupData {
  config: WorkflowConfig;
  tasks: WorkflowTaskView[];
}

/**
 * Module-level slot for startup data pushed from Tauri before React mounts.
 * Providers consume this on first render to skip IPC calls.
 * Only populated in the Tauri fast path.
 */
export const startupData: { value: StartupData | null } = { value: null };

/**
 * Module-level slot for a startup error emitted before React's provider mounts.
 * WorkflowConfigProvider checks this on mount and surfaces it as a retryable error.
 * Only populated in the Tauri fast path.
 */
export const startupError: { value: string | null } = { value: null };
