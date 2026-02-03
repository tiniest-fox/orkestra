import { invoke } from "@tauri-apps/api/core";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StartupErrorScreen } from "./components/StartupErrorScreen";
import "./index.css";
import type { StartupError, StartupStatus } from "./types/startup";

const POLL_INTERVAL = 100;

/**
 * Mount the main app with all providers.
 */
function mountApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

/**
 * Mount the error screen with a reload-based retry mechanism.
 */
function mountError(errors: StartupError[]) {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <StartupErrorScreen errors={errors} onRetry={() => window.location.reload()} />
    </React.StrictMode>,
  );
}

/**
 * Check startup status from the backend.
 */
async function checkStatus(): Promise<StartupStatus> {
  return invoke<StartupStatus>("get_startup_status");
}

/**
 * Poll for startup status until ready or failed.
 */
async function pollStartup(): Promise<StartupStatus> {
  return new Promise((resolve) => {
    const poll = async () => {
      try {
        const status = await checkStatus();
        if (status.status === "ready" || status.status === "failed") {
          resolve(status);
        } else {
          setTimeout(poll, POLL_INTERVAL);
        }
      } catch (err) {
        resolve({
          status: "failed",
          errors: [
            {
              category: "database_error",
              message: `Failed to communicate with backend: ${String(err)}`,
              details: [],
              remediation: "Try restarting the application",
            },
          ],
        });
      }
    };
    poll();
  });
}

/**
 * Main initialization flow:
 * 1. Trigger backend initialization
 * 2. Poll until ready or failed
 * 3. Mount React with appropriate view
 */
async function main() {
  console.log("[startup] Triggering backend initialization");

  // Fire and forget - the backend will update status when ready
  try {
    await invoke("begin_initialization");
  } catch (err) {
    console.error("[startup] Failed to trigger initialization:", err);
  }

  const status = await pollStartup();

  if (status.status === "ready") {
    console.log("[startup] Backend ready, mounting app");
    mountApp();
  } else if (status.status === "failed") {
    console.error("[startup] Backend failed:", status.errors);
    mountError(status.errors);
  }
}

main();
