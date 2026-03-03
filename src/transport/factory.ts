//! Transport factory — selects Tauri or WebSocket based on runtime environment.

import { STORAGE_AUTH_TOKEN, STORAGE_REMOTE_URL } from "../constants";
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
 * The remote URL override (stored in `orkestra.remote_url`) lets a user connect
 * to a remote daemon even from inside Tauri, enabling multi-machine workflows.
 */
export function createTransport(): Transport {
  const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;
  const remoteUrl =
    typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_REMOTE_URL) : null;

  if (hasTauri && !remoteUrl) {
    return new TauriTransport();
  }

  const url = remoteUrl ?? DEFAULT_WS_URL;
  const token =
    typeof localStorage !== "undefined" ? (localStorage.getItem(STORAGE_AUTH_TOKEN) ?? "") : "";
  return new WebSocketTransport(url, token);
}
