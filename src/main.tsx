import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ProjectPicker } from "./components/ProjectPicker";
import "./index.css";

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
    mountApp();
  } else {
    // Picker window: mount the project picker
    console.log("[routing] Mounting project picker");
    mountPicker();
  }
}

main();
