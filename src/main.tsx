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
 */
export const startupData: { value: StartupData | null } = { value: null };

/**
 * Module-level slot for a startup error emitted before React's provider mounts.
 * WorkflowConfigProvider checks this on mount and surfaces it as a retryable error.
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
 * Main entry point: check for project query parameter and route accordingly.
 */
function main() {
  const projectPath = getProjectPath();

  if (projectPath) {
    // Project window: mount the main app
    const bundleMs = Math.round(
      performance.now() - ((window as { __htmlLoadTime?: number }).__htmlLoadTime ?? 0),
    );
    console.log(`[startup] bundle parse+eval: ${bundleMs}ms`);
    console.time("[startup] config");
    console.time("[startup] config:react");
    console.time("[startup] tasks");
    console.time("[startup] ready");

    // Register startup event listeners before React mounts so we catch events
    // that arrive during bundle evaluation.
    listen<StartupData>("startup-data", ({ payload }) => {
      startupData.value = payload;
    });
    listen<{ message: string }>("startup-error", ({ payload }) => {
      startupError.value = payload.message;
    });

    mountApp();
  } else {
    // Picker window: mount the project picker
    console.log("[routing] Mounting project picker");
    mountPicker();
  }
}

main();
