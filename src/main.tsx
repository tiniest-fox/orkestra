import { listen } from "@tauri-apps/api/event";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ProjectPicker } from "./components/ProjectPicker";
import "./index.css";
import type { WorkflowConfig, WorkflowTaskView } from "./types/workflow";

interface StartupData {
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

/**
 * Extract the project path from URL query parameters.
 */
function getProjectPath(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("project");
}

/**
 * Mount the project picker for selecting a project.
 */
function mountPicker() {
  const params = new URLSearchParams(window.location.search);
  const errorMessage = params.get("error") ?? undefined;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ProjectPicker errorMessage={errorMessage} />
    </React.StrictMode>,
  );
}

/**
 * Mount the main app with all providers for a specific project.
 */
function mountApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

/**
 * Main entry point: bifurcate Tauri and PWA startup paths.
 *
 * Tauri: uses the ?project= query param to decide between the picker and the
 * main app. Registers Tauri event listeners before React mounts to capture
 * startup data that arrives during bundle evaluation.
 *
 * PWA: skips the project param check and always mounts the app. The connection
 * gate inside AppContent handles the no-credentials and connecting states.
 */
function main() {
  const hasTauri = !!import.meta.env.TAURI_ENV_PLATFORM;

  if (hasTauri) {
    const projectPath = getProjectPath();

    if (projectPath) {
      // Project window: register startup listeners before React mounts so we
      // catch events that arrive during bundle evaluation.
      const bundleMs = Math.round(
        performance.now() - ((window as { __htmlLoadTime?: number }).__htmlLoadTime ?? 0),
      );
      console.log(`[startup] bundle parse+eval: ${bundleMs}ms`);
      console.time("[startup] config");
      console.time("[startup] config:react");
      console.time("[startup] tasks");
      console.time("[startup] ready");

      // DELIBERATE BYPASS: These listen() calls use raw Tauri APIs instead of
      // the transport layer. Transport initialization happens inside React
      // (TransportProvider), but these listeners must be registered before
      // React mounts to capture events emitted during bundle evaluation.
      // The module-level slots (startupData, startupError) bridge the gap.
      listen<StartupData>("startup-data", ({ payload }) => {
        startupData.value = payload;
      });
      listen<{ message: string }>("startup-error", ({ payload }) => {
        startupError.value = payload.message;
      });

      mountApp();
    } else {
      // Picker window: mount the project picker.
      console.log("[routing] Mounting project picker");
      mountPicker();
    }
  } else {
    // PWA: always mount the app. The connection gate inside AppContent handles
    // the no-credentials and connecting states.
    mountApp();
  }
}

main();
