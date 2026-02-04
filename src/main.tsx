import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ProjectPicker } from "./components/ProjectPicker/ProjectPicker";
import "./index.css";

/**
 * Mount the main app with all providers.
 * For project windows that already have an initialized project.
 */
function mountApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

/**
 * Mount the project picker UI.
 * For picker windows that need project selection.
 */
function mountPicker() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ProjectPicker />
    </React.StrictMode>,
  );
}

/**
 * Main entry point - route to picker or app based on query parameters.
 *
 * - If `?project=<path>` is present, this is a project window (mount App)
 * - Otherwise, this is a picker window (mount ProjectPicker)
 */
async function main() {
  const params = new URLSearchParams(window.location.search);
  const projectPath = params.get("project");

  if (projectPath) {
    // This is a project window — project is already initialized
    // by the time the window opens (open_project does init before creating window)
    console.log("[startup] Project window for:", projectPath);
    mountApp();
  } else {
    // This is a picker window — mount ProjectPicker
    console.log("[startup] Picker window");
    mountPicker();
  }
}

main();
