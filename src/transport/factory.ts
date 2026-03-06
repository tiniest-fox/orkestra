//! Transport factory — selects Tauri or WebSocket based on runtime environment.

import { loadActiveProject, migrateFromLegacy } from "../utils/projectStorage";
import { TauriTransport } from "./TauriTransport";
import type { Transport } from "./types";
import { WebSocketTransport } from "./WebSocketTransport";

const DEFAULT_WS_URL = "ws://localhost:3847/ws";

/**
 * Create the appropriate transport for the current runtime environment.
 *
 * Selection logic:
 * - Inside Tauri with no remote URL override → TauriTransport (IPC)
 * - Otherwise → WebSocketTransport (daemon connection or remote)
 *
 * The remote URL override (stored via the multi-project system) lets a user
 * connect to a remote daemon even from inside Tauri, enabling multi-machine
 * workflows.
 */
export function createTransport(): Transport {
  migrateFromLegacy();
  const hasTauri = !!import.meta.env.TAURI_ENV_PLATFORM;
  const currentProject = loadActiveProject();
  const remoteUrl = currentProject?.url ?? null;

  if (hasTauri && !remoteUrl) {
    return new TauriTransport();
  }

  const rawUrl = remoteUrl ?? DEFAULT_WS_URL;
  // Upgrade stale ws:// URLs when the page is served over HTTPS — prevents
  // mixed-content blocks when stored URLs pre-date a proxy reconfiguration.
  const url =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    rawUrl.startsWith("ws://")
      ? rawUrl.replace("ws://", "wss://")
      : rawUrl;
  const token = currentProject?.token ?? "";
  return new WebSocketTransport(url, token);
}
